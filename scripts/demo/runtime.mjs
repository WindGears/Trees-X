import { spawn, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import {
  fileDigest,
  inspectAssets,
  inspectFrontend,
  inspectJar,
  inspectSupportAssets,
} from './assets.mjs'
import { demoProducts } from './config.mjs'
import {
  listeningPids,
  ownsProcess,
  portAvailable,
  readProcess,
  spawnOwned,
  stopOwned,
  tcpReachable,
} from './processes.mjs'
import { waitForReady } from './readiness.mjs'
import { readState, sourceFingerprint, withControlLock, writeState } from './state.mjs'

export function inspectNode(version = process.versions.node) {
  const [major, minor] = version.split('.').map(Number)
  if (!((major === 20 && minor >= 19) || (major === 22 && minor >= 13) || major >= 24))
    throw new Error('Node 需要 ^20.19、^22.13 或 >=24。')
  return version
}

export function inspectJava(config) {
  const result = spawnSync(config.javaPath, ['-version'], {
    env: config.env,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 15000,
  })
  const version = /version "([^"]+)"/.exec((result.stderr ?? '') + (result.stdout ?? ''))?.[1]
  if (result.error || result.status !== 0 || Number(version?.split('.')[0]) !== 17)
    throw new Error('请通过 TREES_JAVA_HOME 指定可运行的 Java 17；演示运行固定使用该可执行文件。')
  return version
}

export function expectedProcess(config, record) {
  return record.kind === 'server'
    ? { kind: 'server', executable: config.javaPath, script: config.jarPath }
    : { kind: 'preview', executable: process.execPath, script: config.previewScript }
}

export async function doctor(config) {
  const checks = []
  async function check(name, task) {
    try {
      checks.push({ name, ok: true, result: await task() })
    } catch (error) {
      checks.push({ name, ok: false, message: error.message })
    }
  }
  await check('Node', () => inspectNode())
  await check('Java 17', () => inspectJava(config))
  await check('MySQL 配置与本机连接', async () => {
    if (config.mysql.password === undefined)
      throw new Error('请在 server/.env.local 或环境变量中设置 TREES_DB_PASSWORD。')
    if (!(await tcpReachable(config.mysql.host, config.mysql.port)))
      throw new Error('MySQL TCP 服务不可达；这一步只检查连接，不改变数据库。')
    return 'TCP 可达；认证与数据库内容由实际 API 启动核验。'
  })
  await check('本地 Vite', () =>
    fileDigest(join(config.rootDir, 'node_modules', 'vite', 'package.json')),
  )
  await check('public 三件清单与 LFS', () => inspectAssets(join(config.rootDir, 'public')))
  await check('dist 三件清单与 LFS', () => inspectAssets(config.distDir))
  await check('public 本地解码器与封面摘要', () =>
    inspectSupportAssets(join(config.rootDir, 'public')),
  )
  await check('dist 本地解码器与封面摘要', () => inspectSupportAssets(config.distDir))
  await check('后端可执行 JAR', () => inspectJar(config.jarPath))
  await check('已准备产物', () => verifyPrepared(config))
  const ports = []
  for (const port of [config.frontendPort, config.backendPort])
    ports.push({
      port,
      free: await portAvailable(config.host, port),
      pids: await listeningPids(port),
    })
  return { ok: checks.every((item) => item.ok), checks, ports }
}

async function runNpm(config, script) {
  const child = spawn(
    process.platform === 'win32' ? 'cmd.exe' : 'npm',
    process.platform === 'win32' ? ['/d', '/s', '/c', `npm run ${script}`] : ['run', script],
    {
      cwd: config.rootDir,
      env: config.env,
      stdio: 'inherit',
      windowsHide: true,
    },
  )
  await new Promise((resolve, reject) => {
    child.once('error', () => reject(new Error('无法执行 npm 构建。')))
    child.once('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`${script} 构建失败；保留现有本地产物。`)),
    )
  })
}

export async function prepare(config) {
  return withControlLock(config, async () => {
    inspectNode()
    const javaVersion = inspectJava(config)
    const current = await readState(join(config.artifactsDir, 'state.json'))
    if (current?.processes)
      for (const record of current.processes)
        if (ownsProcess(record, await readProcess(record.pid), expectedProcess(config, record)))
          throw new Error('已登记演示仍在运行；请先执行 demo:stop 再准备产物。')
    return prepareArtifacts(config, javaVersion)
  })
}

// The build callback is the existing npm build/server:build runner. Keeping this
// artifact transaction separate allows disk-mutation tests without Maven or Java.
export async function prepareArtifacts(config, javaVersion, build = runNpm) {
  const before = await sourceFingerprint(config.rootDir)
  const source = await inspectAssets(join(config.rootDir, 'public'))
  const sourceSupport = await inspectSupportAssets(join(config.rootDir, 'public'))
  await build(config, 'build')
  await build(config, 'server:build')
  const manifests = await inspectAssets(config.distDir)
  const support = await inspectSupportAssets(config.distDir)
  if (JSON.stringify(source) !== JSON.stringify(manifests))
    throw new Error('public 与 dist 的三件清单不一致。')
  if (JSON.stringify(sourceSupport) !== JSON.stringify(support))
    throw new Error('public 与 dist 的本地解码器或封面摘要不一致。')
  const prepared = {
    schemaVersion: 1,
    preparedAt: new Date().toISOString(),
    sourceFingerprint: before,
    javaVersion,
    jar: await inspectJar(config.jarPath),
    frontend: await inspectFrontend(config.distDir),
    manifests,
    support,
  }
  if (before !== (await sourceFingerprint(config.rootDir)))
    throw new Error(
      '准备期间构建输入已改变；未写入新的准备记录，请停止编辑后重新执行 demo:prepare。',
    )
  await writeState(join(config.artifactsDir, 'prepared.json'), prepared)
  return prepared
}

export async function verifyPrepared(config) {
  const prepared = await readState(join(config.artifactsDir, 'prepared.json'))
  if (prepared?.schemaVersion !== 1)
    throw new Error('尚未准备演示产物；请先执行 npm run demo:prepare。')
  if (prepared.sourceFingerprint !== (await sourceFingerprint(config.rootDir)))
    throw new Error('源码已改变；请重新执行 npm run demo:prepare。')
  const actual = {
    jar: await inspectJar(config.jarPath),
    frontend: await inspectFrontend(config.distDir),
    manifests: await inspectAssets(config.distDir),
    support: await inspectSupportAssets(config.distDir),
  }
  for (const key of ['jar', 'frontend', 'manifests', 'support'])
    if (JSON.stringify(actual[key]) !== JSON.stringify(prepared[key]))
      throw new Error('生产产物已改变；请重新执行 npm run demo:prepare。')
  const source = await inspectAssets(join(config.rootDir, 'public'))
  if (JSON.stringify(source) !== JSON.stringify(actual.manifests))
    throw new Error('生产资源与 public 不一致；请重新准备。')
  const sourceSupport = await inspectSupportAssets(join(config.rootDir, 'public'))
  if (JSON.stringify(sourceSupport) !== JSON.stringify(actual.support))
    throw new Error('生产解码器或封面与 public 摘要不一致；请重新准备。')
  return { preparedAt: prepared.preparedAt, products: demoProducts.map((item) => item.slug) }
}

async function cleanup(config, state) {
  const remaining = []
  for (const record of [...state.processes].reverse()) {
    try {
      const result = await stopOwned(record, expectedProcess(config, record))
      if (result === 'foreign') remaining.push(record)
    } catch {
      remaining.push(record)
    }
  }
  if (remaining.length) {
    await writeState(join(config.artifactsDir, 'state.json'), {
      ...state,
      status: 'ownership-mismatch',
      processes: remaining,
    })
    throw new Error('登记 PID 的启动时间或命令归属已改变；拒绝停止该进程，已保留本地状态。')
  }
  await rm(join(config.artifactsDir, 'state.json'), { force: true })
}

export async function start(config, signal) {
  return withControlLock(config, async () => {
    inspectNode()
    inspectJava(config)
    if (config.mysql.password === undefined)
      throw new Error('请设置 TREES_DB_PASSWORD，或填写 server/.env.local。')
    await verifyPrepared(config)
    const previous = await readState(join(config.artifactsDir, 'state.json'))
    if (previous?.processes?.length) {
      const owned = []
      for (const record of previous.processes) {
        const actual = await readProcess(record.pid)
        if (actual && !ownsProcess(record, actual, expectedProcess(config, record)))
          throw new Error('已有登记 PID 归属不匹配；拒绝启动，请检查本地状态。')
        if (actual) owned.push(record)
      }
      if (owned.length) {
        if (previous.status === 'ready' && owned.length === 2)
          return {
            ...previous,
            readiness: await waitForReady(
              config,
              owned,
              (record) => expectedProcess(config, record),
              signal,
              10000,
            ),
            alreadyRunning: true,
          }
        throw new Error('上次登记演示未完整退出；请先执行 demo:stop。')
      }
      await rm(join(config.artifactsDir, 'state.json'))
    }
    for (const port of [config.frontendPort, config.backendPort])
      if (!(await portAvailable(config.host, port)))
        throw new Error(`端口 ${port} 已被其他进程占用；演示不会结束它，请手动关闭对应服务。`)
    if (!(await tcpReachable(config.mysql.host, config.mysql.port)))
      throw new Error('MySQL TCP 服务不可达。')
    const runId = randomUUID()
    const directory = join(config.artifactsDir, runId)
    await mkdir(directory, { recursive: true })
    const state = {
      schemaVersion: 1,
      runId,
      status: 'starting',
      startedAt: new Date().toISOString(),
      baseUrl: config.baseUrl,
      processes: [],
    }
    try {
      const runtimeEnv = {
        ...config.env,
        TREES_PORT: String(config.backendPort),
        TREES_BIND_ADDRESS: config.host,
        TREES_ADMIN_RESET: 'false',
      }
      const specifications = [
        {
          kind: 'server',
          executable: config.javaPath,
          args: ['-jar', config.jarPath, `--spring.application.name=trees-x-demo-${runId}`],
          cwd: config.serverDir,
        },
        {
          kind: 'preview',
          executable: process.execPath,
          args: [config.previewScript, `--run-id=${runId}`],
          cwd: config.rootDir,
        },
      ]
      for (const spec of specifications) {
        const record = await spawnOwned({
          ...spec,
          env: runtimeEnv,
          logPath: join(directory, spec.kind + '.log'),
          runId,
          signal,
        })
        state.processes.push(record)
        await writeState(join(config.artifactsDir, 'state.json'), state)
      }
      state.readiness = await waitForReady(
        config,
        state.processes,
        (record) => expectedProcess(config, record),
        signal,
      )
      state.status = 'ready'
      await writeState(join(config.artifactsDir, 'state.json'), state)
      return state
    } catch (error) {
      await cleanup(config, state)
      throw error
    }
  })
}

export async function stop(config) {
  return withControlLock(config, async () => {
    const state = await readState(join(config.artifactsDir, 'state.json'))
    if (!state) return { stopped: false, message: '没有本工具登记的演示进程。' }
    if (state.schemaVersion !== 1 || !Array.isArray(state.processes))
      throw new Error('演示状态格式错误；拒绝停止进程。')
    await cleanup(config, state)
    return { stopped: true, message: '已停止本工具登记且身份匹配的演示进程。' }
  })
}
