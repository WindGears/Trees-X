/* global fetch, URL, AbortSignal */
import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { demoProducts } from './config.mjs'
import { resourcePath } from './assets.mjs'
import { listeningPids, ownsProcess, readProcess } from './processes.mjs'

export function staticPath(value, baseUrl) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//'))
    throw new Error('商品运行资源必须使用同源绝对路径。')
  const url = new URL(value, baseUrl)
  if (url.origin !== baseUrl || url.search || url.hash || url.pathname !== value)
    throw new Error('商品运行资源路径无效。')
  return value
}

async function request(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(5000),
    redirect: 'error',
  })
  if (!response.ok) throw new Error('演示 HTTP 检查未通过：' + new URL(url).pathname)
  return response
}

async function checkStatic(config, url, checked) {
  const path = staticPath(url, config.baseUrl)
  if (checked.has(path)) return
  const expected = await stat(resourcePath(config.distDir, path.slice(1)))
  if (!expected.isFile() || expected.size < 1) throw new Error('缺少生产静态资源：' + path)
  const response = await request(config.baseUrl + path, { method: 'HEAD' })
  if (
    Number(response.headers.get('content-length')) !== expected.size ||
    response.headers.get('content-type')?.includes('text/html')
  )
    throw new Error('静态资源未由生产 dist 提供：' + path)
  checked.add(path)
}

export async function inspectApi(config, products = demoProducts) {
  const catalog = await (await request(config.baseUrl + '/api/v1/products')).json()
  if (!Array.isArray(catalog)) throw new Error('真实商品 API 返回格式错误。')
  const required = products.map((item) => item.slug)
  if (!required.every((slug) => catalog.some((item) => item.slug === slug)))
    throw new Error('真实 API 未上架打字机、钢琴与汽车三件商品。')
  const checked = new Set()
  for (const product of products) {
    const detail = await (await request(config.baseUrl + '/api/v1/products/' + product.slug)).json()
    const source = detail.presentation?.source
    if (
      detail.slug !== product.slug ||
      source?.kind !== 'glb' ||
      source.bundle?.manifest !== product.manifest
    )
      throw new Error('真实 API 商品未绑定正式运行清单：' + product.slug)
    await checkStatic(config, detail.cover, checked)
    const response = await request(config.baseUrl + staticPath(product.manifest, config.baseUrl))
    const bytes = Buffer.from(await response.arrayBuffer())
    const local = await readFile(resourcePath(config.distDir, product.manifest.slice(1)))
    const digest = createHash('sha256').update(bytes).digest('hex')
    if (!bytes.equals(local) || digest !== source.bundle.sha256)
      throw new Error('API 配置的清单 SHA-256 与生产资源不符：' + product.slug)
    checked.add(product.manifest)
    const manifest = JSON.parse(bytes.toString('utf8'))
    const directory = product.manifest.slice(0, product.manifest.lastIndexOf('/') + 1)
    for (const file of manifest.files) await checkStatic(config, directory + file.path, checked)
    if (source.environment) await checkStatic(config, source.environment, checked)
  }
  // All formal adapters use the locally shipped Draco decoder; no CDN is needed.
  for (const path of ['/draco/draco_wasm_wrapper.js', '/draco/draco_decoder.wasm'])
    await checkStatic(config, path, checked)
  const denoiseManifest = '/models/denoise/manifest.json'
  const denoiseResponse = await request(config.baseUrl + denoiseManifest)
  const denoiseBytes = Buffer.from(await denoiseResponse.arrayBuffer())
  const denoiseLocal = await readFile(resourcePath(config.distDir, denoiseManifest.slice(1)))
  if (!denoiseBytes.equals(denoiseLocal)) throw new Error('降噪资源清单与生产 dist 不一致。')
  checked.add(denoiseManifest)
  for (const file of JSON.parse(denoiseBytes.toString('utf8')).files)
    await checkStatic(config, '/models/denoise/' + file.path, checked)
  const index = await request(config.baseUrl + '/')
  const html = await index.text()
  if (!html.includes('/assets/') || html.includes('/src/main.ts'))
    throw new Error('前端未提供生产构建入口。')
  return { products: required, staticUrls: [...checked].sort() }
}

export async function waitForReady(config, records, expected, signal, timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs
  let reason = 'HTTP 服务尚未就绪。'
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new Error('演示启动已取消。')
    for (const record of records) {
      if (!ownsProcess(record, await readProcess(record.pid), expected(record)))
        throw new Error(record.kind + ' 演示进程在就绪前已退出或身份改变；请检查本地日志。')
    }
    try {
      if (process.platform === 'win32')
        for (const record of records) {
          const port = record.kind === 'server' ? config.backendPort : config.frontendPort
          const pids = await listeningPids(port)
          if (pids.length !== 1 || pids[0] !== record.pid)
            throw new Error('端口尚未由已登记的演示进程监听。')
        }
      return await inspectApi(config)
    } catch (error) {
      reason = error.message
    }
    await delay(750, undefined, { signal })
  }
  throw new Error('演示启动超时：' + reason)
}
