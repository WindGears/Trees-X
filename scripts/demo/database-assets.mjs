import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile, realpath, stat } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { URL } from 'node:url'
import { digest } from './database-guard.mjs'

export async function hashFile(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

export function resourcePath(value, base = '/') {
  if (
    typeof value !== 'string' ||
    value.startsWith('//') ||
    /^[a-z]+:/i.test(value) ||
    value.includes('\\')
  )
    throw new Error('资源引用必须是同源静态路径。')
  let decoded
  try {
    decoded = decodeURIComponent(value.split(/[?#]/)[0])
  } catch {
    throw new Error('资源引用编码无效。')
  }
  if (
    decoded.split('/').includes('..') ||
    decoded.startsWith('//') ||
    decoded.includes('\\') ||
    [...decoded].some((character) => character.charCodeAt(0) <= 0x20)
  )
    throw new Error('资源引用不能越过静态目录。')
  const url = new URL(decoded, 'http://trees-x.local' + base)
  if (url.origin !== 'http://trees-x.local') throw new Error('资源引用必须是同源静态路径。')
  return url.pathname
}

export async function inventoryResources(config, db) {
  const references = new Set()
  const manifests = new Set()
  const configs = (
    await db.query('SELECT config_json FROM presentations ORDER BY slug', 'trees_x')
  ).map((row) => JSON.parse(row))
  const walk = (value, base = '/') => {
    if (!value || typeof value !== 'object') return
    for (const [key, item] of Object.entries(value)) {
      if (
        typeof item === 'string' &&
        (item.startsWith('/') || ['file', 'environmentFile'].includes(key))
      )
        references.add(resourcePath(item, base))
      else if (item && typeof item === 'object') walk(item, base)
    }
  }
  for (const presentation of configs) {
    const manifest = presentation.source?.bundle?.manifest
    const base = manifest ? dirname(resourcePath(manifest)).replaceAll('\\', '/') + '/' : '/'
    if (manifest) manifests.add(resourcePath(manifest))
    walk(presentation, base)
  }
  for (const row of await db.query(
    'SELECT JSON_ARRAY(cover) FROM products WHERE cover IS NOT NULL ORDER BY slug',
    'trees_x',
  )) {
    const [cover] = JSON.parse(row)
    if (cover) references.add(resourcePath(cover))
  }
  const publicDir = await realpath(join(config.rootDir, 'public'))
  const locate = async (url) => {
    const path = resolve(publicDir, '.' + url)
    const actual = await realpath(path)
    const local = relative(publicDir, actual)
    if (local.startsWith('..') || isAbsolute(local)) throw new Error('文件资源越过 public 目录。')
    return actual
  }
  for (const manifestUrl of manifests) {
    references.add(manifestUrl)
    const manifest = JSON.parse(await readFile(await locate(manifestUrl), 'utf8'))
    const base = dirname(manifestUrl).replaceAll('\\', '/') + '/'
    for (const file of manifest.files ?? []) references.add(resourcePath(file.path, base))
    if (manifest.entry) references.add(resourcePath(manifest.entry, base))
  }
  const files = []
  for (const url of [...references].sort()) {
    try {
      const path = await locate(url)
      const info = await stat(path)
      if (!info.isFile()) throw new Error()
      files.push({ url, bytes: info.size, sha256: await hashFile(path) })
    } catch {
      throw new Error(`数据库引用的静态资源不可读取：${url}`)
    }
  }
  return {
    format: 'trees-x-database-resources-v1',
    scope:
      'Database same-origin references and all declared bundle files; SQL backup does not copy static files.',
    files,
    totalBytes: files.reduce((total, file) => total + file.bytes, 0),
    inventorySha256: digest(JSON.stringify(files)),
  }
}
