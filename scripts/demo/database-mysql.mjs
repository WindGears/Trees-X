import { spawn } from 'node:child_process'
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

export const sourceDatabase = 'trees_x'
export const restoreDatabase = 'trees_x_restore_test'

export function assertDatabaseTargets(database, target = restoreDatabase) {
  if (database !== sourceDatabase) throw new Error('备份源必须是 trees_x。')
  if (target !== restoreDatabase) throw new Error('恢复目标只能是 trees_x_restore_test。')
}

export function mysqlOption(value) {
  return (
    '"' +
    String(value)
      .replaceAll('\\', '\\\\')
      .replaceAll('"', '\\"')
      .replaceAll('\n', '\\n')
      .replaceAll('\r', '\\r')
      .replaceAll('\t', '\\t') +
    '"'
  )
}

async function runChild(executable, args, options = {}) {
  return await new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      env: options.env,
      windowsHide: true,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const chunks = []
    let stderr = ''
    child.stdout.on('data', (chunk) => chunks.push(chunk))
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    child.on('error', () => reject(new Error(`${basename(executable)} 无法启动。`)))
    child.on('close', (code) => {
      if (code !== 0) {
        const errorNumber = /ERROR (\d+)/.exec(stderr)?.[1]
        reject(
          new Error(
            `${basename(executable)} 执行失败（退出 ${code}${errorNumber ? `，MySQL ${errorNumber}` : ''}）；原始错误可能含数据，已隐藏。`,
          ),
        )
      } else resolve(Buffer.concat(chunks).toString('utf8'))
    })
    child.stdin.on('error', () => {})
    child.stdin.end(options.input ?? '')
  })
}

async function protectDirectory(directory, env) {
  if (process.platform !== 'win32') return
  const executable = join(
    env.SystemRoot ?? 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  )
  const sid = (
    await runChild(
      executable,
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        '[Console]::Write([System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value)',
      ],
      { env },
    )
  ).trim()
  if (!/^S-1-\d+(?:-\d+)+$/.test(sid)) throw new Error('无法确认当前用户的 Windows SID。')
  await runChild(
    join(env.SystemRoot ?? 'C:\\Windows', 'System32', 'icacls.exe'),
    [directory, '/inheritance:r', '/grant:r', `*${sid}:(OI)(CI)F`],
    { env },
  )
}

export async function withMysql(config, action) {
  assertDatabaseTargets(config.mysql.database)
  if (config.mysql.password === undefined) throw new Error('请填写本地 TREES_DB_PASSWORD。')
  if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(config.mysql.host)) {
    throw new Error('本机备份工具只接受 loopback MySQL 地址。')
  }
  const defaultBin =
    process.platform === 'win32' ? 'C:\\Program Files\\MySQL\\MySQL Server 8.0\\bin' : ''
  const binary = (name) =>
    join(config.mysql.binDir ?? defaultBin, name + (process.platform === 'win32' ? '.exe' : ''))
  for (const name of ['mysql', 'mysqldump']) {
    if (config.mysql.binDir || defaultBin) {
      try {
        await access(binary(name))
      } catch {
        throw new Error(`未找到 ${name}；请设置 TREES_MYSQL_BIN。`)
      }
    }
  }
  const directory = await mkdtemp(join(tmpdir(), 'trees-x-mysql-'))
  const env = { ...config.env }
  for (const key of Object.keys(env))
    if (/PASSWORD|TOKEN|SECRET|MYSQL_PWD/i.test(key)) delete env[key]
  // MySQL reads .mylogin.cnf even with defaults-file; isolate that optional source.
  env.MYSQL_TEST_LOGIN_FILE = join(directory, 'unused-login.cnf')
  try {
    await protectDirectory(directory, env)
    const optionsFile = join(directory, 'client.cnf')
    await writeFile(
      optionsFile,
      '[client]\n' +
        Object.entries({
          host: config.mysql.host,
          port: config.mysql.port,
          user: config.mysql.user,
          password: config.mysql.password,
          protocol: 'TCP',
          'default-character-set': 'utf8mb4',
        })
          .map(([key, value]) => `${key}=${mysqlOption(value)}`)
          .join('\n') +
        '\n',
      { mode: 0o600, flag: 'wx' },
    )
    const defaults = `--defaults-file=${optionsFile}`
    const client = {
      query: async (sql, database) => {
        if (database && ![sourceDatabase, restoreDatabase].includes(database))
          throw new Error('拒绝访问非白名单数据库。')
        const output = await runChild(
          binary('mysql'),
          [
            defaults,
            '--batch',
            '--raw',
            '--skip-column-names',
            '--binary-mode',
            ...(database ? [`--database=${database}`] : []),
          ],
          { env, input: `SET time_zone='+00:00';\n${sql}\n` },
        )
        return output.trimEnd() ? output.trimEnd().split(/\r?\n/) : []
      },
      dump: async (outputFile) =>
        await runChild(
          binary('mysqldump'),
          [
            defaults,
            '--single-transaction',
            '--skip-lock-tables',
            '--skip-add-locks',
            '--skip-add-drop-table',
            '--skip-disable-keys',
            '--skip-comments',
            '--skip-triggers',
            '--routines=false',
            '--events=false',
            '--hex-blob',
            '--no-tablespaces',
            '--set-gtid-purged=OFF',
            '--column-statistics=0',
            '--no-create-db',
            `--result-file=${outputFile}`,
            sourceDatabase,
          ],
          { env },
        ),
      import: async (sql) =>
        await runChild(
          binary('mysql'),
          [defaults, '--batch', '--binary-mode', `--database=${restoreDatabase}`],
          { env, input: sql },
        ),
    }
    return await action(client)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
