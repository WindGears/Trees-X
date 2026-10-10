/* global URL */
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const demoProducts = [
  { slug: 'typewriter-study', manifest: '/models/bundles/kimi-typewriter/v1/manifest.json' },
  { slug: 'piano-cfx', manifest: '/models/bundles/kimi-piano/v1/manifest.json' },
  { slug: 'reventon', manifest: '/models/reventon/workbench-manifest.json' },
]

export function parseLocalEnvironment(text) {
  const values = {}
  for (const line of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const match = /^\s*(TREES_[A-Z0-9_]+)\s*=(.*)$/.exec(line)
    if (!match) continue
    let value = match[2].trim()
    if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1)
    values[match[1]] = value
  }
  return values
}

export function readDemoConfig(options = {}) {
  const rootDir = resolve(options.rootDir ?? join(dirname(fileURLToPath(import.meta.url)), '../..'))
  const env = { ...(options.env ?? process.env) }
  for (const path of [join(rootDir, 'server', '.env.local'), join(rootDir, '.env.local')]) {
    if (!existsSync(path)) continue
    const local = parseLocalEnvironment(readFileSync(path, 'utf8'))
    for (const [key, value] of Object.entries(local)) if (env[key] === undefined) env[key] = value
  }
  const javaHome = env.TREES_JAVA_HOME || join(options.homeDir ?? homedir(), '.jdks', 'ms-17.0.18')
  const platform = options.platform ?? process.platform
  env.JAVA_HOME = javaHome
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === 'path') ?? 'PATH'
  env[pathKey] = join(javaHome, 'bin') + (platform === 'win32' ? ';' : ':') + (env[pathKey] ?? '')
  const databaseUrl = env.TREES_DB_URL ?? 'jdbc:mysql://127.0.0.1:3306/trees_x'
  let database
  try {
    if (!databaseUrl.startsWith('jdbc:mysql://')) throw new Error()
    database = new URL(databaseUrl.slice(5))
    if (
      database.username ||
      database.password ||
      [...database.searchParams.keys()].some((key) => /password|user|token|secret/i.test(key))
    )
      throw new Error()
  } catch {
    throw new Error('TREES_DB_URL 必须是无内嵌凭据的 jdbc:mysql URL。')
  }
  return {
    rootDir,
    serverDir: join(rootDir, 'server'),
    artifactsDir: join(rootDir, 'artifacts', 'demo'),
    distDir: join(rootDir, 'dist'),
    jarPath: join(rootDir, 'server', 'target', 'trees-x-server-0.1.0.jar'),
    javaPath: join(javaHome, 'bin', platform === 'win32' ? 'java.exe' : 'java'),
    previewScript: join(rootDir, 'scripts', 'demo', 'preview.mjs'),
    env,
    mysql: {
      host: database.hostname,
      port: Number(database.port || 3306),
      database: decodeURIComponent(database.pathname.slice(1)),
      user: env.TREES_DB_USERNAME ?? 'root',
      password: env.TREES_DB_PASSWORD,
      binDir: env.TREES_MYSQL_BIN,
    },
    host: '127.0.0.1',
    frontendPort: 5181,
    backendPort: 8089,
    baseUrl: 'http://127.0.0.1:5181',
  }
}
