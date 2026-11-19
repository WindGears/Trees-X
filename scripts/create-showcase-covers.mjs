/* global document, requestAnimationFrame, window */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { URL } from 'node:url'
import { chromium, expect } from '@playwright/test'
import { format, resolveConfig } from 'prettier'
import sharp from 'sharp'
import { bridge, viewport } from './demo/browser-check.mjs'
import { localAuditOrigin } from './reventon-performance/audit-origin.mjs'

const viewportCrop = { left: 0, top: 20, width: 1440, height: 960 }
const exhibits = new Map([
  [
    'typewriter-study',
    {
      name: 'typewriter',
      view: 'structure',
      crop: { left: 112, top: 240, width: 1050, height: 700 },
    },
  ],
  [
    'piano-cfx',
    {
      name: 'piano',
      view: 'perspective',
      crop: { left: 274, top: 125, width: 1080, height: 720 },
    },
  ],
  ['reventon', { name: 'reventon', view: 'perspective' }],
])
const base = localAuditOrigin(process.env.CHECK_URL ?? 'http://127.0.0.1:5181')
const output = resolve(process.env.SHOWCASE_CAPTURE_OUTPUT ?? 'artifacts/showcase/covers')
const formatting = await resolveConfig('public/covers/showcase/typewriter.json')
const requested = process.argv.slice(2)
const slugs = requested.length ? requested : [...exhibits.keys()]
for (const slug of slugs) assert.ok(exhibits.has(slug), `Unknown exhibit: ${slug}`)
const timeout = 150000

async function attach(page, slug, view) {
  await expect(page.locator('.workbench')).toHaveAttribute('data-slug', slug, { timeout })
  await expect(page.locator('.workbench')).toHaveAttribute('data-status', 'ready', { timeout })
  await expect(page.locator('canvas')).toHaveCount(1)
  await bridge(page, true)
  await page.evaluate((view) => {
    const { store, scene } = window.__demo
    const preset = store.presentation?.views.find((entry) => entry.id === view)
    const renderer = scene.renderer.instance
    if (!preset || !renderer.backend.isWebGPUBackend)
      throw new Error('The named view and actual WebGPU backend are required')
    store.view(view)
  }, view)
  await page.waitForFunction(
    (view) => {
      const { store, scene } = window.__demo
      const preset = store.presentation.views.find((entry) => entry.id === view)
      return scene.camera.activeCamera.value.position
        .toArray()
        .every((value, axis) => Math.abs(value - preset.position[axis]) < 1e-7)
    },
    view,
    { timeout },
  )
  await page.evaluate(() => {
    const seen = new Set()
    const visit = (vnode) => {
      if (!vnode || seen.has(vnode)) return
      seen.add(vnode)
      const component = vnode.component
      const lighting = component?.exposed?.realLighting
      if (lighting?.snapshot) return lighting
      const nested = visit(component?.subTree) ?? visit(vnode.suspense?.activeBranch)
      if (nested) return nested
      for (const child of Array.isArray(vnode.children) ? vnode.children : []) {
        const found = visit(child)
        if (found) return found
      }
    }
    window.__showcaseCoverLighting = visit(document.querySelector('#app')?._vnode)
    if (!window.__showcaseCoverLighting) throw new Error('Live lighting status unavailable')
  })
  await page.waitForFunction(
    (slug) => {
      const state = window.__showcaseCoverLighting.snapshot()
      const { scene } = window.__demo
      const root = scene.scene.value.children.find((node) => node.userData.workbenchProduct)
      if (state.error) throw new Error(state.error)
      if (state.slug !== slug || state.phase !== 'ready') return false
      if (slug === 'reventon')
        return (
          root?.userData.carShowroom?.probe?.source === 'cycles-r18' &&
          root.userData.carStudioPaint === 'silver' &&
          state.keyShadow?.phase === 'ready' &&
          state.indirectLighting?.actual === 'ddgi' &&
          state.signals?.reflectionRays?.actual === 2
        )
      if (slug === 'piano-cfx') return state.mode === 'pbr'
      return state.signals?.ssr === true
    },
    slug,
    { timeout, polling: 250 },
  )
  await page.addStyleTag({
    content: 'body * { visibility: hidden !important; } canvas { visibility: visible !important; }',
  })
}

async function capture(page, slug, file, crop, progress) {
  if (progress !== undefined) {
    const id = await page.evaluate((progress) => {
      const { store } = window.__demo
      const action = store.presentation.actions.find(
        (entry) => entry.motion?.program?.type === 'typewriter-layout-v1',
      )
      if (!action) throw new Error('Typewriter structure action unavailable')
      store.motion('seek', action.id, progress)
      return action.id
    }, progress)
    await page.waitForFunction(
      ({ id, progress }) =>
        Math.abs((window.__demo.motion.snapshot()[id]?.progress ?? -1) - progress) < 1e-7,
      { id, progress },
      { timeout },
    )
  }
  const scene = await page.evaluate(async () => {
    const { scene, store } = window.__demo
    const world = scene.scene.value
    const renderer = scene.renderer.instance
    const camera = scene.camera.activeCamera.value
    const root = world.children.find((node) => node.userData.workbenchProduct)
    const render = window.__showcaseCoverLighting.snapshot()
    for (let frame = 0; frame < 12; frame++) {
      await new Promise((done) => requestAnimationFrame(done))
    }
    await renderer.backend.device.queue.onSubmittedWorkDone()
    const lights = []
    world.traverseVisible((node) => {
      if (node.isLight)
        lights.push({
          name: node.name,
          type: node.type,
          intensity: node.intensity,
          matrix: node.matrixWorld.toArray(),
          rgb: node.color.toArray(),
        })
    })
    return {
      slug: root?.userData.workbenchProduct,
      root: root?.uuid,
      bundle: root?.userData.bundleVersion,
      sha256: root?.userData.bundleSha256,
      camera: {
        world: camera.matrixWorld.toArray(),
        projection: camera.projectionMatrix.toArray(),
      },
      lights,
      bay: world.children.find((child) => child.userData.showcaseBay)?.userData.showcaseBay,
      render: {
        mode: render.mode,
        showroom: root?.userData.carShowroom?.probe?.source,
        exposure: renderer.toneMappingExposure,
      },
      finish: store.finishId,
      resolution: [renderer.domElement.width, renderer.domElement.height],
    }
  })
  assert.equal(scene.slug, slug)
  assert.ok(scene.sha256)
  assert.deepEqual(scene.resolution, [viewport.width, viewport.height])
  assert.equal(scene.bundle, slug === 'piano-cfx' ? 1 : 2)
  if (slug !== 'reventon') assert.equal(scene.bay, exhibits.get(slug).name)
  const raw = await page.locator('canvas').screenshot({ timeout })
  const data = await sharp(raw).extract(crop).webp({ quality: 90 }).toBuffer()
  assert.ok(data.byteLength > 10000, 'Captured image appears empty')
  return {
    scene,
    data,
    metadata: {
      file,
      progress,
      bytes: data.byteLength,
      sha256: createHash('sha256').update(data).digest('hex'),
    },
  }
}

await mkdir(output, { recursive: true })
const browser = await chromium.launch({ channel: 'msedge', headless: true })
try {
  for (const slug of slugs) {
    const { name, view, crop = viewportCrop } = exhibits.get(slug)
    const page = await browser.newPage({
      viewport,
      deviceScaleFactor: 1,
      reducedMotion: 'reduce',
      serviceWorkers: 'block',
    })
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    const url = new URL('/', base)
    url.searchParams.set('product', slug)
    url.searchParams.set('renderPipeline', 'showcase')
    try {
      await page.goto(url.href, { waitUntil: 'domcontentloaded' })
      await attach(page, slug, view)
      const whole = await capture(
        page,
        slug,
        `${name}-whole.webp`,
        crop,
        name === 'typewriter' ? 0 : undefined,
      )
      const captures = [whole]
      if (name === 'typewriter') {
        const layers = await capture(page, slug, 'typewriter-layers.webp', crop, 0.6)
        assert.deepEqual(layers.scene, whole.scene, 'Typewriter capture inputs diverged')
        assert.notEqual(layers.metadata.sha256, whole.metadata.sha256)
        captures.push(layers)
      }
      assert.deepEqual(errors, [])
      const { root, ...scene } = whole.scene
      assert.ok(root)
      const record = {
        source: 'Live Trees X showcase WebGPU canvas, with page controls hidden for capture',
        generator: 'scripts/create-showcase-covers.mjs',
        view,
        crop,
        ...scene,
        images: captures.map(({ metadata }) => metadata),
      }
      await Promise.all([
        ...captures.map(({ data, metadata }) => writeFile(resolve(output, metadata.file), data)),
        writeFile(
          resolve(output, `${name}.json`),
          await format(JSON.stringify(record), { ...formatting, parser: 'json' }),
        ),
      ])
      console.log(name, record.images)
    } finally {
      await page.close()
    }
  }
} finally {
  await browser.close()
}
