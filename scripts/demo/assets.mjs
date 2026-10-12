import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { open, readFile, readdir, stat } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { demoProducts } from './config.mjs'

export async function fileDigest(path) {
  const hash = createHash('sha256')
  let bytes = 0
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk)
    bytes += chunk.length
  }
  return { bytes, sha256: hash.digest('hex') }
}

export function resourcePath(directory, resource) {
  if (
    typeof resource !== 'string' ||
    !resource ||
    resource.includes('\\') ||
    resource.includes('%') ||
    resource.includes(':') ||
    resource.includes('?') ||
    resource.includes('#') ||
    isAbsolute(resource)
  )
    throw new Error('清单含不安全的相对资源路径。')
  const path = resolve(directory, resource)
  const location = relative(directory, path)
  if (!location || location.startsWith('..') || isAbsolute(location))
    throw new Error('清单资源越过资产目录。')
  return path
}

export async function rejectLfsPointer(path) {
  const file = await open(path, 'r')
  try {
    const prefix = Buffer.alloc(200)
    const { bytesRead } = await file.read(prefix, 0, prefix.length, 0)
    if (
      prefix
        .subarray(0, bytesRead)
        .toString('utf8')
        .startsWith('version https://git-lfs.github.com/spec/v1')
    )
      throw new Error('尚未拉取 Git LFS 运行文件：' + path)
  } finally {
    await file.close()
  }
}

export async function inspectManifest(path) {
  await rejectLfsPointer(path)
  const document = JSON.parse(await readFile(path, 'utf8'))
  if (document.schemaVersion !== 1 || !Array.isArray(document.files) || !document.files.length)
    throw new Error('运行清单格式错误：' + path)
  const seen = new Set()
  let bytes = 0
  for (const file of document.files) {
    const resource = resourcePath(dirname(path), file.path)
    if (
      seen.has(resource) ||
      !Number.isSafeInteger(file.bytes) ||
      file.bytes < 1 ||
      !/^[a-f0-9]{64}$/.test(file.sha256)
    )
      throw new Error('清单含重复路径或无效字节摘要：' + path)
    seen.add(resource)
    await rejectLfsPointer(resource)
    const actual = await fileDigest(resource)
    if (actual.bytes !== file.bytes || actual.sha256 !== file.sha256)
      throw new Error('运行资产字节或 SHA-256 不匹配：' + resource)
    bytes += actual.bytes
  }
  if (!seen.has(resourcePath(dirname(path), document.entry)))
    throw new Error('清单入口未登记：' + path)
  return { ...(await fileDigest(path)), files: document.files.length, assetBytes: bytes }
}

export async function inspectAssets(directory, products = demoProducts) {
  const manifests = []
  for (const product of products) {
    const path = resourcePath(directory, product.manifest.slice(1))
    manifests.push({ slug: product.slug, url: product.manifest, ...(await inspectManifest(path)) })
  }
  return manifests
}

export async function inspectJar(path) {
  const metadata = await stat(path)
  const file = await open(path, 'r')
  try {
    const prefix = Buffer.alloc(4)
    await file.read(prefix, 0, 4, 0)
    if (!metadata.isFile() || prefix.toString('hex') !== '504b0304')
      throw new Error('后端运行产物不是有效的 JAR：' + path)
  } finally {
    await file.close()
  }
  return fileDigest(path)
}

export async function inspectFrontend(directory) {
  const indexPath = join(directory, 'index.html')
  const html = await readFile(indexPath, 'utf8')
  if (!html.includes('/assets/') || html.includes('/src/main.ts'))
    throw new Error('dist 缺少生产构建入口。')
  const assets = []
  async function collect(path) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const file = join(path, entry.name)
      if (entry.isDirectory()) await collect(file)
      else if (entry.isFile()) {
        await rejectLfsPointer(file)
        assets.push({
          path: relative(directory, file).replaceAll('\\', '/'),
          ...(await fileDigest(file)),
        })
      }
    }
  }
  await collect(join(directory, 'assets'))
  assets.sort((a, b) => a.path.localeCompare(b.path))
  if (!assets.length) throw new Error('dist 缺少生产 JavaScript/CSS 资产。')
  return { index: await fileDigest(indexPath), assets }
}

export async function inspectSupportAssets(directory) {
  const files = []
  async function collect(path) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const file = join(path, entry.name)
      if (entry.isDirectory()) await collect(file)
      else if (entry.isFile()) {
        await rejectLfsPointer(file)
        files.push({
          path: relative(directory, file).replaceAll('\\', '/'),
          ...(await fileDigest(file)),
        })
      }
    }
  }
  await inspectManifest(join(directory, 'models', 'denoise', 'manifest.json'))
  for (const path of ['draco', 'covers', 'models/denoise']) await collect(join(directory, path))
  for (const required of ['draco/draco_wasm_wrapper.js', 'draco/draco_decoder.wasm'])
    if (!files.some((file) => file.path === required))
      throw new Error('缺少必要的本地解码器：' + required)
  if (
    !files.some(
      (file) => file.path.startsWith('covers/') && /\.(png|jpe?g|webp|avif|svg)$/i.test(file.path),
    )
  )
    throw new Error('缺少本地商品封面。')
  return files.sort((a, b) => a.path.localeCompare(b.path))
}
