/* global fetch, URL, requestAnimationFrame */
import { chromium, expect } from '@playwright/test'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { bridge, trackLifecycle } from './demo/browser-check.mjs'

const base = process.env.CHECK_URL ?? 'http://127.0.0.1:5181'
const output = process.env.TYPEWRITER_V2_OUTPUT ?? 'artifacts/typewriter-v2/browser'
const backend = process.env.TYPEWRITER_V2_BACKEND ?? 'webgl'
if (!['webgl', 'realtime'].includes(backend)) throw new Error('Invalid backend')
const bundle = JSON.parse(await readFile('src/lib/workbench/typewriterV2Bundle.json', 'utf8'))
const response = await fetch(base + '/api/v1/products/typewriter-study')
if (!response.ok) throw new Error('Real product API unavailable')
const product = await response.json()
const action = product.presentation.actions.find((entry) => entry.motion?.program)
if (!action) throw new Error('Real structure program unavailable')
const cases = [
  { id: 'whole', progress: 0, view: 'perspective' },
  { id: 'paint', progress: 0, part: 'part-095' },
  { id: 'metal', progress: 0, part: 'part-000' },
  { id: 'key', progress: 0, part: 'part-070' },
  { id: 'layers', progress: 0.6, view: 'structure' },
  { id: 'flat', progress: 1, view: 'knoll' },
]
await mkdir(output, { recursive: true })
const report = {
  passed: false,
  backend,
  fixture: false,
  captures: [],
  checks: [],
  errors: [],
  pairs: [],
  lifecycle: [],
  pending: [
    'Overall visual promotion, presented-frame budget, 30 reloads, 20 minute joint acceptance and owner walkthrough',
  ],
}
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
const page = await context.newPage()
page.on('pageerror', (error) => report.errors.push(error.message))
page.on('console', (message) => {
  if (message.type() === 'error') report.errors.push(message.text())
})
const requests = []
page.on('request', (request) => requests.push(request.url()))
const ready = async (remember = false) => {
  await expect(page.locator('.workbench')).toHaveAttribute('data-status', 'ready', {
    timeout: 240000,
  })
  await expect(page.locator('canvas')).toHaveCount(1)
  await bridge(page, remember)
}
const snapshot = () =>
  page.evaluate(() => {
    const test = window.__demo
    const root = test.scene.scene.value.children.find((node) => node.userData.workbenchProduct)
    const materials = new Map(),
      textures = new Set(),
      geometry = new Set(),
      parts = []
    root.traverse((node) => {
      if (Number.isInteger(node.userData.partId)) parts.push(node)
      if (node.geometry) geometry.add(node.geometry.uuid)
      for (const material of node.material
        ? Array.isArray(node.material)
          ? node.material
          : [node.material]
        : []) {
        materials.set(material.name, material)
        for (const value of Object.values(material)) if (value?.isTexture) textures.add(value.uuid)
      }
    })
    const camera = test.scene.camera.activeCamera.value
    return {
      slug: root.userData.workbenchProduct,
      bundle: root.userData.assetBundle,
      version: root.userData.bundleVersion,
      hash: root.userData.bundleSha256,
      parts: parts.length,
      geometries: geometry.size,
      textures: textures.size,
      sameCanvas: document.querySelector('canvas') === test.canvas,
      sameRenderer: test.scene.renderer.instance === test.renderer,
      backend: test.renderer.backend?.isWebGPUBackend ? 'realtime' : 'webgl',
      camera: [
        ...camera.position.toArray(),
        ...camera.quaternion.toArray(),
        ...camera.projectionMatrix.elements,
      ],
      finishes: [...materials.values()]
        .filter((m) => m.userData.treesFinishVersion === 2)
        .map((m) => ({
          name: m.name,
          normal: !!m.normalMap,
          roughness: !!m.roughnessMap,
          channel: m.normalMap?.channel,
          colorSpace: m.normalMap?.colorSpace,
          width: m.normalMap?.image?.width,
          height: m.normalMap?.image?.height,
          anisotropy: m.anisotropy,
          direction: !!m.anisotropyMap,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    }
  })
try {
  const captures = new Map()
  for (const version of [1, 2]) {
    await page.goto(
      base +
        '/?product=typewriter-study&renderPipeline=' +
        backend +
        '&typewriterAsset=v' +
        version,
    )
    await ready(true)
    const identity = await snapshot()
    expect(identity.backend).toBe(backend)
    expect(identity.version).toBe(version)
    expect(identity.parts).toBe(572)
    if (version === 2) {
      expect(identity.hash).toBe(bundle.sha256)
      expect(identity.finishes).toHaveLength(9)
      for (const finish of identity.finishes) {
        expect([finish.normal, finish.roughness]).toEqual([true, true])
        expect([finish.width, finish.height]).toEqual([2048, 2048])
        expect(finish.channel).toBe(1)
        expect(finish.colorSpace).toBe('')
        if (finish.anisotropy > 0) expect(finish.direction).toBe(true)
      }
    }
    report.checks.push({ version, identity })
    for (const item of cases) {
      await page.evaluate(() => {
        window.__demo.store.panel = null
        window.__demo.store.restore()
      })
      await page.waitForTimeout(1000)
      await page.evaluate(({ id, value }) => window.__demo.store.motion('seek', id, value), {
        id: action.id,
        value: item.progress,
      })
      await expect
        .poll(() =>
          page.evaluate((id) => window.__demo.motion.states.value[id]?.progress, action.id),
        )
        .toBe(item.progress)
      if (item.part) {
        const hotspot = product.presentation.hotspots.find(
          (entry) => entry.id === item.part || entry.node === item.part,
        )
        if (!hotspot) throw new Error('Unbound comparison part ' + item.part)
        await page.evaluate((id) => window.__demo.store.focus(id), hotspot.id)
      } else await page.evaluate((id) => window.__demo.store.view(id), item.view)
      await page.waitForTimeout(1200)
      await page.mouse.move(1, 1)
      const filename = `${backend}-v${version}-${item.id}.png`
      await page.screenshot({ path: output + '/' + filename })
      const evidence = await snapshot()
      report.captures.push(filename)
      if (version === 1) captures.set(item.id, evidence.camera)
      else {
        const original = captures.get(item.id)
        const error = Math.max(...original.map((n, i) => Math.abs(n - evidence.camera[i])))
        expect(error).toBeLessThanOrEqual(1e-6)
        report.pairs.push({
          id: item.id,
          cameraError: error,
          sameBackend: backend,
          progress: item.progress,
        })
      }
    }
  }
  if (backend === 'realtime') {
    await page.goto(base + '/?product=typewriter-study&renderPipeline=realtime')
    await ready(true)
    const identity = await snapshot()
    expect(identity.backend).toBe('realtime')
    expect(identity.slug).toBe('typewriter-study')
    expect(identity.version).toBe(2)
    expect(identity.hash).toBe(bundle.sha256)
    expect(identity.parts).toBe(572)
    expect(identity.finishes).toHaveLength(9)
    report.checks.push({ entry: 'realtime-automatic-v2', identity })
  }
  // Run real production command watchers, not a duplicated pose implementation.
  report.determinism = await page.evaluate(async (id) => {
    const test = window.__demo
    const wait = () =>
      new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    const pose = () => {
      const values = []
      test.scene.scene.value.children
        .find((n) => n.userData.workbenchProduct)
        .traverse((n) => {
          if (Number.isInteger(n.userData.partId))
            values.push(...n.position.toArray(), ...n.quaternion.toArray())
        })
      return values
    }
    const seek = async (value) => {
      test.store.motion('seek', id, value)
      await wait()
      return pose()
    }
    const difference = (a, b) => Math.max(0, ...a.map((n, i) => Math.abs(n - b[i])))
    const samples = [],
      initial = await seek(0)
    for (let i = 0; i <= 100; i++) samples.push(await seek(i / 100))
    let reverseError = 0,
      resetError = 0
    for (let i = 100; i >= 0; i--)
      reverseError = Math.max(reverseError, difference(samples[i], await seek(i / 100)))
    for (let i = 0; i < 50; i++) {
      await seek(1)
      resetError = Math.max(resetError, difference(initial, await seek(0)))
    }
    return { points: 101, resetCycles: 50, reverseError, resetError }
  }, action.id)
  expect(report.determinism.reverseError).toBeLessThanOrEqual(1e-6)
  expect(report.determinism.resetError).toBeLessThanOrEqual(1e-6)
  await trackLifecycle(page)
  const initial = await snapshot()
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => window.__demo.store.select('typewriter-study'))
    await ready()
    const current = await snapshot()
    expect(current.sameCanvas && current.sameRenderer).toBe(true)
    expect(current.hash).toBe(bundle.sha256)
    expect([current.geometries, current.textures]).toEqual([initial.geometries, initial.textures])
    const old = await trackLifecycle(page)
    for (const entry of old) {
      expect(entry.detached).toBe(true)
      expect(entry.disposed).toEqual(entry.resources)
    }
    report.lifecycle.push({ iteration: i + 1, current, old })
  }
  expect(
    requests
      .filter((url) => /^https?:/.test(url))
      .every((url) => new URL(url).origin === new URL(base).origin),
  ).toBe(true)
  expect(report.errors).toEqual([])
  report.passed = true
} finally {
  await browser.close()
  await writeFile(output + '/report.json', JSON.stringify(report, null, 2) + '\n')
}
console.log(
  JSON.stringify({
    passed: report.passed,
    backend,
    pairs: report.pairs,
    determinism: report.determinism,
    errors: report.errors,
  }),
)
