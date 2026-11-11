/* global window, document, MutationObserver, GPUAdapter */
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { gzipSync } from 'node:zlib'
import { chromium } from '@playwright/test'
import { REVISION } from 'three'
import { bridge } from '../demo/browser-check.mjs'
import { writeState } from '../demo/state.mjs'
import { localAuditOrigin } from '../reventon-performance/audit-origin.mjs'

function captureR18Pipelines() {
  const records = new Map()
  let showroom = false,
    ready = false
  window.__r18StartupPipelines = () => [...records.values()]
  const observer = new MutationObserver(() => {
    const phase = document.querySelector('.wb-stage-status p')?.textContent
    if (phase === '正在准备摄影棚反射与阴影。') showroom = true
    if (document.querySelector('.workbench')?.dataset.status === 'ready') {
      ready = true
      observer.disconnect()
    }
  })
  observer.observe(document, { childList: true, subtree: true, attributes: true })
  const snapshot = (value) => {
    if (Array.isArray(value)) return value.map(snapshot)
    if (!value || typeof value !== 'object') return value
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .filter((key) => key !== 'label')
        .map((key) => [key, snapshot(value[key])]),
    )
  }
  const requestDevice = GPUAdapter.prototype.requestDevice
  GPUAdapter.prototype.requestDevice = function (options) {
    return requestDevice.call(this, options).then((device) => {
      const shaders = new WeakMap(),
        groups = new WeakMap(),
        layouts = new WeakMap()
      const shader = device.createShaderModule.bind(device),
        group = device.createBindGroupLayout.bind(device),
        layout = device.createPipelineLayout.bind(device),
        render = device.createRenderPipeline.bind(device)
      device.createShaderModule = (value) => {
        const result = shader(value)
        if (typeof value.code === 'string' && !value.compilationHints?.length)
          shaders.set(result, snapshot(value))
        return result
      }
      device.createBindGroupLayout = (value) => {
        const result = group(value)
        groups.set(result, snapshot(value))
        return result
      }
      device.createPipelineLayout = (value) => {
        const result = layout(value)
        const bindGroupLayouts = Array.from(value.bindGroupLayouts, (entry) =>
          entry === null ? null : groups.get(entry),
        )
        if (!bindGroupLayouts.includes(undefined))
          layouts.set(result, snapshot({ ...value, bindGroupLayouts }))
        return result
      }
      device.createRenderPipeline = (value) => {
        if (
          showroom &&
          !ready &&
          document.querySelector('.wb-stage-status p')?.textContent === '即将进入展示。'
        ) {
          const pipelineLayout = layouts.get(value.layout),
            vertex = shaders.get(value.vertex?.module),
            fragment = shaders.get(value.fragment?.module)
          if (pipelineLayout && vertex && fragment) {
            const entry = snapshot({
              ...value,
              layout: pipelineLayout,
              vertex: { ...value.vertex, module: vertex },
              fragment: { ...value.fragment, module: fragment },
            })
            records.set(JSON.stringify(entry), entry)
          }
        }
        return render(value)
      }
      return device
    })
  }
}

async function prepare() {
  assert.equal(REVISION, '185', 'Review the R18 startup capture after a Three update')
  const bundle = JSON.parse(await readFile('src/lib/workbench/reventonRuntimeBundle.json', 'utf8'))
  assert.equal(bundle.manifest, '/models/reventon-runtime-v2/workbench-manifest.json')
  assert.match(bundle.sha256, /^[a-f0-9]{64}$/)
  const base = localAuditOrigin(process.env.CHECK_URL ?? 'http://127.0.0.1:5181')
  const firstFrameShadows = process.env.TREES_R18_PSO_REFERENCE !== '1'
  const path = '/?product=reventon&renderPipeline=showcase&r18Pso=off'
  const browser = await chromium.launch({ channel: 'msedge', headless: true })
  let records
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
      deviceScaleFactor: 1,
    })
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text())
    })
    await page.addInitScript(captureR18Pipelines)
    await page.goto(base + path + (firstFrameShadows ? '&r18ShadowWarmup=capture' : ''), {
      waitUntil: 'domcontentloaded',
    })
    await page.waitForFunction(
      () => ['ready', 'error'].includes(document.querySelector('.workbench')?.dataset.status),
      null,
      { timeout: 120000 },
    )
    assert.equal(await page.locator('.workbench').getAttribute('data-status'), 'ready')
    await bridge(page)
    const actual = await page.evaluate(async () => {
      const { scene } = window.__demo,
        renderer = scene.renderer.instance
      const root = scene.scene.value.children.find(
        (node) => node.userData.workbenchProduct === 'reventon',
      )
      if (!renderer.backend.isWebGPUBackend)
        throw new Error('The real R18 WebGPU scene is required')
      await renderer.backend.device.queue.onSubmittedWorkDone()
      const seen = new Set()
      const lighting = (node) => {
        if (!node || seen.has(node)) return
        seen.add(node)
        const exposed = node.component?.exposed?.realLighting
        const status = (exposed?.value ?? exposed)?.snapshot?.()
        if (status?.keyShadow?.requested) return status
        const nested = lighting(node.component?.subTree) ?? lighting(node.suspense?.activeBranch)
        if (nested) return nested
        for (const child of Array.isArray(node.children) ? node.children : []) {
          const found = lighting(child)
          if (found) return found
        }
      }
      const status = lighting(document.querySelector('#app')?._vnode)
      return {
        sha256: root?.userData.bundleSha256,
        records: window.__r18StartupPipelines(),
        firstFrameShadows: status?.keyShadow?.details?.firstFrameShaders === true,
        shadow: status?.keyShadow?.stage,
        indirect: status?.indirectLighting?.actual,
      }
    })
    assert.deepEqual(errors, [])
    assert.equal(actual.sha256, bundle.sha256)
    assert.equal(actual.shadow, 'active')
    assert.equal(actual.indirect, 'ddgi')
    assert.equal(
      actual.firstFrameShadows,
      firstFrameShadows,
      'Use a build with the selected R18 shadow path',
    )
    records = actual.records
    assert.ok(
      records.length >= 50 && records.length <= 128,
      `Unexpected R18 pipeline count ${records.length}`,
    )
  } finally {
    await browser.close()
  }
  const order = firstFrameShadows ? { firstFrameShadows: true } : {}
  const packed = gzipSync(JSON.stringify({ version: 1, ...order, records }))
  const metadata = {
    version: 1,
    three: Number(REVISION),
    ...order,
    bundleSha256: bundle.sha256,
    count: records.length,
    bytes: packed.length,
    sha256: createHash('sha256').update(packed).digest('hex'),
  }
  const dir = resolve('public/models/reventon-runtime-v2/native-pipelines')
  await mkdir(dir, { recursive: true })
  const target = resolve(dir, metadata.sha256 + '.bin'),
    temporary = target + '.' + randomUUID() + '.tmp'
  try {
    await writeFile(temporary, packed, { flag: 'wx' })
    await rename(temporary, target)
  } finally {
    await unlink(temporary).catch((error) => {
      if (error.code !== 'ENOENT') throw error
    })
  }
  await writeState(resolve('src/lib/workbench/reventonNativePipelineCache.json'), metadata)
  console.log(JSON.stringify(metadata))
}

await prepare().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
