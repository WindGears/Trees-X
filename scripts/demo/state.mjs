import { createHash } from 'node:crypto'
import { mkdir, open, readFile, readdir, rename, rm } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { readProcess } from './processes.mjs'

export async function readState(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw new Error('本地演示状态文件损坏：' + path, { cause: error })
  }
}

export async function writeState(path, data) {
  const temporary = `${path}.${process.pid}.tmp`
  const file = await open(temporary, 'wx', 0o600)
  try {
    await file.writeFile(JSON.stringify(data, null, 2) + '\n', 'utf8')
    await file.sync()
  } finally {
    await file.close()
  }
  await rename(temporary, path)
}

export async function withControlLock(config, action) {
  await mkdir(config.artifactsDir, { recursive: true })
  const path = join(config.artifactsDir, 'control.lock')
  let file
  try {
    file = await open(path, 'wx', 0o600)
  } catch (error) {
    if (error.code !== 'EEXIST') throw error
    const previous = await readState(path)
    if (!previous?.pid || !previous.startedAt)
      throw new Error('演示控制锁尚未登记；请稍后重试。', { cause: error })
    const actual = await readProcess(previous.pid)
    if (actual?.startedAt === previous.startedAt)
      throw new Error('另一项演示准备、启动或停止命令仍在运行。', { cause: error })
    throw new Error(
      '演示控制锁的 CLI 已退出或身份已改变；本工具不自动回收锁。请确认没有演示控制命令运行后，手动移走 artifacts/demo/control.lock 再重试。',
      { cause: error },
    )
  }
  try {
    const actual = await readProcess(process.pid)
    await file.writeFile(JSON.stringify({ pid: process.pid, startedAt: actual?.startedAt }), 'utf8')
    return await action()
  } finally {
    await file.close()
    await rm(path, { force: true })
  }
}

export async function sourceFingerprint(rootDir) {
  const paths = [
    'package.json',
    'package-lock.json',
    'index.html',
    'renderlab.html',
    'vite.config.ts',
    'server/pom.xml',
    'scripts/server.mjs',
    'server/mvnw',
    'server/mvnw.cmd',
  ]
  async function collect(directory, accept = () => true) {
    for (const entry of await readdir(join(rootDir, directory), { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) await collect(path, accept)
      else if (entry.isFile() && accept(entry.name)) paths.push(path)
    }
  }
  for (const entry of await readdir(rootDir, { withFileTypes: true }))
    if (entry.isFile() && /^tsconfig.*\.json$/.test(entry.name)) paths.push(entry.name)
  for (const directory of ['src', 'server/src/main', 'server/.mvn/wrapper'])
    await collect(directory)
  for (const name of ['maven.config', 'jvm.config']) {
    const path = join('server', '.mvn', name)
    try {
      await readFile(join(rootDir, path))
      paths.push(path)
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  }
  for (const entry of await readdir(join(rootDir, 'scripts'), { withFileTypes: true }))
    if (entry.isFile() && /^demo.*\.mjs$/.test(entry.name)) paths.push(join('scripts', entry.name))
  await collect(
    'scripts/demo',
    (name) => name.endsWith('.mjs') && !name.endsWith('.test.mjs') && name !== 'browser-check.mjs',
  )
  for (const directory of ['public/draco', 'public/covers', 'public/models/denoise'])
    await collect(directory)
  const hash = createHash('sha256')
  for (const path of paths.sort()) {
    hash.update(relative(rootDir, join(rootDir, path)).replaceAll('\\', '/') + '\0')
    hash.update(await readFile(join(rootDir, path)))
  }
  return hash.digest('hex')
}
