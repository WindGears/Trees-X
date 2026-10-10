import { execFile, spawn } from 'node:child_process'
import { open, readFile, readlink } from 'node:fs/promises'
import { createConnection, createServer } from 'node:net'
import { normalize } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { promisify } from 'node:util'

const execute = promisify(execFile)

async function powershell(script) {
  try {
    const { stdout } = await execute(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 15000,
        maxBuffer: 1024 * 1024,
      },
    )
    return stdout.trim() ? JSON.parse(stdout) : null
  } catch {
    throw new Error('无法核验 Windows 进程身份；未停止任何未经核验的进程。')
  }
}

export async function readProcess(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) throw new Error('无效的进程编号。')
  if (process.platform === 'win32')
    return powershell(`$ErrorActionPreference='Stop'
$native=Get-Process -Id ${pid} -ErrorAction SilentlyContinue
if ($null -eq $native) { exit 0 }
$item=Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}'
if ($null -eq $item) { exit 0 }
[pscustomobject]@{pid=${pid};startedAt=$native.StartTime.ToUniversalTime().ToString('o');executable=$item.ExecutablePath;commandLine=$item.CommandLine} | ConvertTo-Json -Compress`)
  try {
    const [status, boot, executable, args] = await Promise.all([
      readFile(`/proc/${pid}/stat`, 'utf8'),
      readFile('/proc/sys/kernel/random/boot_id', 'utf8'),
      readlink(`/proc/${pid}/exe`),
      readFile(`/proc/${pid}/cmdline`, 'utf8'),
    ])
    return {
      pid,
      startedAt: `${boot.trim()}:${status.slice(status.lastIndexOf(')') + 2).split(' ')[19]}`,
      executable,
      commandLine: args.replace(/\0/g, ' ').trim(),
    }
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ESRCH') return null
    throw new Error('无法核验进程身份。', { cause: error })
  }
}

function normalizedExecutable(path, platform) {
  if (typeof path !== 'string') return ''
  const value = normalize(path)
  return platform === 'win32' ? value.toLowerCase() : value
}

export function ownsProcess(record, actual, expected, platform = process.platform) {
  if (!record || !actual || !expected || !/^[a-f0-9-]{36}$/.test(record.runId ?? '')) return false
  const executable = normalizedExecutable(expected.executable, platform)
  const marker =
    expected.kind === 'server'
      ? `--spring.application.name=trees-x-demo-${record.runId}`
      : `--run-id=${record.runId}`
  return (
    record.kind === expected.kind &&
    record.pid === actual.pid &&
    record.startedAt === actual.startedAt &&
    normalizedExecutable(record.executable, platform) === executable &&
    normalizedExecutable(actual.executable, platform) === executable &&
    typeof actual.commandLine === 'string' &&
    record.commandLine === actual.commandLine &&
    actual.commandLine.includes(marker) &&
    actual.commandLine.includes(expected.script)
  )
}

export async function portAvailable(host, port) {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', (error) => {
      if (error.code === 'EADDRINUSE' || error.code === 'EACCES') resolve(false)
      else reject(error)
    })
    server.listen({ host, port, exclusive: true }, () => server.close(() => resolve(true)))
  })
}

export async function tcpReachable(host, port) {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port })
    const finish = (reachable) => {
      socket.destroy()
      resolve(reachable)
    }
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
    socket.setTimeout(2000, () => finish(false))
  })
}

export async function listeningPids(port) {
  if (process.platform !== 'win32') return []
  const result = await powershell(`$ErrorActionPreference='Stop'
$items=@(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object LocalPort -eq ${port} | Select-Object -ExpandProperty OwningProcess -Unique)
ConvertTo-Json -InputObject $items -Compress`)
  return result ?? []
}

export async function spawnOwned({ executable, args, cwd, env, logPath, kind, runId, signal }) {
  if (signal?.aborted) throw new Error('演示启动已取消。')
  const log = await open(logPath, 'a')
  let child
  try {
    child = spawn(executable, args, {
      cwd,
      env,
      stdio: ['ignore', log.fd, log.fd],
      detached: true,
      windowsHide: true,
    })
    await new Promise((resolve, reject) => {
      child.once('spawn', resolve)
      child.once('error', () => reject(new Error(`无法启动 ${kind} 进程。`)))
    })
    // Keep the owned ChildProcess handle until its OS identity has been captured.
    for (let attempt = 0; attempt < 30; attempt++) {
      const actual = await readProcess(child.pid)
      if (actual?.executable && actual.commandLine) {
        child.unref()
        return { kind, runId, ...actual }
      }
      if (child.exitCode !== null || signal?.aborted) break
      await delay(100)
    }
    throw new Error(`无法登记 ${kind} 进程身份。`)
  } catch (error) {
    // Only this newly spawned process is cleaned up through its original handle.
    if (child?.pid && child.exitCode === null) child.kill()
    throw error
  } finally {
    await log.close()
  }
}

export async function stopOwned(record, expected) {
  const actual = await readProcess(record.pid)
  if (!actual) return 'exited'
  if (!ownsProcess(record, actual, expected)) return 'foreign'
  if (process.platform === 'win32') {
    // Re-read identity and hold the corresponding Process object while killing it.
    const result = await powershell(`$ErrorActionPreference='Stop'
$native=Get-Process -Id ${record.pid} -ErrorAction SilentlyContinue
if ($null -eq $native) { '"exited"'; exit 0 }
$item=Get-CimInstance Win32_Process -Filter 'ProcessId=${record.pid}'
$expected=[System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(JSON.stringify(record)).toString('base64')}')) | ConvertFrom-Json
if ($native.StartTime.ToUniversalTime().ToString('o') -ne $expected.startedAt -or $item.ExecutablePath -ne $expected.executable -or $item.CommandLine -cne $expected.commandLine) { '"foreign"'; exit 0 }
Stop-Process -InputObject $native -Force
'"stopped"'`)
    return result
  }
  process.kill(record.pid, 'SIGTERM')
  for (let attempt = 0; attempt < 50; attempt++) {
    const current = await readProcess(record.pid)
    if (!current) return 'stopped'
    if (!ownsProcess(record, current, expected)) return 'foreign'
    await delay(100)
  }
  if (ownsProcess(record, await readProcess(record.pid), expected))
    process.kill(record.pid, 'SIGKILL')
  return 'stopped'
}
