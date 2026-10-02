import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { homedir } from 'node:os'

const cwd = resolve('server')
const env = { ...process.env }
const local = join(cwd, '.env.local')
if (existsSync(local))
  for (const line of readFileSync(local, 'utf8').split(/\r?\n/)) {
    const match = /^(TREES_[A-Z_]+)=(.*)$/.exec(line)
    if (match && env[match[1]] === undefined) env[match[1]] = match[2]
  }
const javaHome = env.TREES_JAVA_HOME || join(homedir(), '.jdks', 'ms-17.0.18')
if (existsSync(join(javaHome, 'bin', process.platform === 'win32' ? 'java.exe' : 'java'))) {
  env.JAVA_HOME = javaHome
  const key = Object.keys(env).find((k) => k.toLowerCase() === 'path') || 'PATH'
  env[key] = join(javaHome, 'bin') + (process.platform === 'win32' ? ';' : ':') + (env[key] || '')
}
const java = env.JAVA_HOME
  ? join(env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java')
  : 'java'
const version = spawnSync(java, ['-version'], { encoding: 'utf8', env })
const major = Number(/version "(\d+)/.exec(version.stderr || '')?.[1])
if (!major || major < 17) throw new Error('请通过 TREES_JAVA_HOME 指定 Java 17 或更高版本。')
const command = process.argv[2] || 'dev'
const goals = { dev: 'spring-boot:run', test: 'test', package: 'package' }
if (!(command in goals)) throw new Error('支持的命令：dev、test、package')
if (command === 'test') env.TREES_MYSQL_TEST = 'true'
if (env.TREES_DB_PASSWORD === undefined)
  throw new Error('请设置 TREES_DB_PASSWORD，或填写 server/.env.local。')
const child =
  process.platform === 'win32'
    ? spawn('cmd.exe', ['/d', '/s', '/c', 'mvnw.cmd -q ' + goals[command]], {
        cwd,
        env,
        stdio: 'inherit',
        windowsHide: true,
      })
    : spawn('./mvnw', ['-q', goals[command]], { cwd, env, stdio: 'inherit' })
child.on('error', (error) => {
  console.error(error.message)
  process.exitCode = 1
})
child.on('exit', (code) => {
  process.exitCode = code ?? 1
})
