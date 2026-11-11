import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { open, readFile, readdir, stat } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { demoProducts } from './config.mjs'

export const supportAssetManifests = Object.freeze([
  'models/denoise/manifest.json',
  'studio/amber-lounge/v1/manifest.json',
  'studio/amber-lounge/spatial-v1/manifest.json',
  'studio/amber-lounge/layers-v1/manifest.json',
])

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
  if (typeof document.entry !== 'string') throw new Error('清单入口未登记：' + path)
  return inspectRecords(path, document.files, document.entry)
}

async function inspectRecords(path, files, entry) {
  const seen = new Set()
  let bytes = 0
  for (const file of files) {
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
  if (entry !== undefined && !seen.has(resourcePath(dirname(path), entry)))
    throw new Error('清单入口未登记：' + path)
  return { ...(await fileDigest(path)), files: files.length, assetBytes: bytes }
}

export async function inspectAssets(directory, products = demoProducts) {
  const manifests = []
  for (const product of products) {
    const path = resourcePath(directory, product.manifest.slice(1))
    manifests.push({ slug: product.slug, url: product.manifest, ...(await inspectManifest(path)) })
  }
  return manifests
}

export async function inspectShowcaseAssets(directory, rootDir) {
  const bundles = []
  for (const [reference, manifest, id] of [
    [
      'typewriterV2Bundle.json',
      'models/bundles/kimi-typewriter/v2/manifest.json',
      'kimi-typewriter',
    ],
    [
      'reventonRuntimeBundle.json',
      'models/reventon-runtime-v2/workbench-manifest.json',
      'reventon-workbench',
    ],
  ]) {
    const registration = join(rootDir, 'src/lib/workbench', reference)
    const source = JSON.parse(
      await readFile(registration, 'utf8').catch((error) => {
        if (error.code === 'ENOENT') throw new Error('缺少答辩运行包登记：' + registration)
        throw error
      }),
    )
    const url = '/' + manifest
    if (source.id !== id || source.version !== 2 || source.manifest !== url)
      throw new Error('答辩运行包登记不符：' + reference)
    const record = await inspectManifest(resourcePath(directory, manifest))
    if (record.sha256 !== source.sha256) throw new Error('答辩运行包清单摘要不符：' + url)
    bundles.push({ url, ...record })
  }
  const studio = []
  for (const [name, roles] of [
    ['concept-v2', ['floor']],
    ['cycles-r18', ['specular', 'indirect']],
  ]) {
    const manifest = `studio/cold-studio/${name}/manifest.json`
    const path = resourcePath(directory, manifest)
    const value = JSON.parse(await readFile(path, 'utf8'))
    const records = Array.isArray(value.records)
      ? value.records.filter((record) => roles.includes(record.role))
      : []
    if (
      records.length !== (name === 'concept-v2' ? 3 : 2) ||
      (name === 'cycles-r18' && value.config?.revision !== 18)
    )
      throw new Error('答辩展厅资产清单不完整：' + manifest)
    studio.push({
      url: '/' + manifest,
      ...(await inspectRecords(
        path,
        records.map((record) => ({ ...record, path: record.file })),
      )),
    })
  }
  const basis = []
  for (const name of ['basis_transcoder.js', 'basis_transcoder.wasm']) {
    const path = resourcePath(directory, 'basis/' + name)
    await rejectLfsPointer(path)
    const digest = await fileDigest(path)
    if (digest.bytes === 0) throw new Error('KTX2 解码文件为空：' + name)
    basis.push({ name, ...digest })
  }
  const nativeTextures = await inspectReventonNativeTextures(directory, rootDir, basis[1].sha256)
  return { bundles, studio, basis, ...(nativeTextures ? { nativeTextures } : {}) }
}

async function inspectReventonNativeTextures(directory, rootDir, basisSha256) {
  const registration = join(rootDir, 'src/lib/workbench/reventonNativeTextureCache.json')
  const bytes = await readFile(registration).catch((error) => {
    if (error.code !== 'ENOENT') throw error
  })
  if (!bytes) return
  const cache = JSON.parse(bytes)
  const path = resourcePath(directory, 'models/reventon-runtime-v2/workbench-manifest.json')
  const manifest = await readFile(path)
  const bundleSha256 = createHash('sha256').update(manifest).digest('hex')
  const textures = JSON.parse(manifest).files.filter(
    (file) => file.role === 'texture' && file.path.endsWith('.ktx2'),
  )
  if (
    cache.version !== 1 ||
    cache.bundleSha256 !== bundleSha256 ||
    cache.basisWasmSha256 !== basisSha256 ||
    Object.keys(cache.files ?? {}).length !== textures.length
  )
    throw new Error('汽车本地纹理缓存已过期，请重新运行 npm run asset:reventon-native-textures。')
  const files = textures.map((file) => {
    const alternate = cache.files[file.path]
    if (alternate?.sourceSha256 !== file.sha256)
      throw new Error('汽车本地纹理缓存来源不匹配：' + file.path)
    return {
      bytes: alternate.bytes,
      sha256: alternate.sha256,
      path: `native-bc7/${bundleSha256}/${file.path}`,
    }
  })
  const { assetBytes } = await inspectRecords(path, files)
  return { bundleSha256, files: files.length, assetBytes }
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
  for (const manifest of supportAssetManifests)
    await inspectManifest(resourcePath(directory, manifest))
  for (const path of ['draco', 'covers', ...supportAssetManifests.map(dirname)])
    await collect(join(directory, path))
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
