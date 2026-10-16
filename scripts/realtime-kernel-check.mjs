/* global fetch, URL, getComputedStyle, innerHeight */
import { chromium, expect } from '@playwright/test'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { bridge } from './demo/browser-check.mjs'

const comparison = process.env.REALTIME_COMPARISON || 'kernel'
if (!['kernel', 'studio', 'reflection'].includes(comparison))
  throw new Error('Unknown realtime comparison')
const modes =
    comparison === 'studio'
      ? ['light', 'dark']
      : comparison === 'reflection'
        ? ['scene', 'product', 'off']
        : ['static', 'rotating'],
  base = process.env.CHECK_URL || 'http://127.0.0.1:5181',
  output =
    process.env.REALTIME_COMPARISON_OUTPUT ||
    process.env.REALTIME_KERNEL_OUTPUT ||
    (comparison === 'studio'
      ? 'artifacts/typewriter-dark-studio/comparison'
      : comparison === 'reflection'
        ? 'artifacts/typewriter-realtime-complete/reflection'
        : 'artifacts/webgpu-rollin/kernel'),
  bundle = JSON.parse(await readFile('src/lib/workbench/typewriterV2Bundle.json', 'utf8')),
  response = await fetch(new URL('/api/v1/products/typewriter-study', base))
if (!response.ok) throw new Error('Real typewriter API unavailable')
const product = await response.json(),
  action = product.presentation.actions.find((item) => item.motion?.program)
if (!action) throw new Error('Real structure program unavailable')
const poses = [
  { id: 'whole', progress: 0, view: 'perspective' },
  { id: 'paint', progress: 0, part: 'part-095' },
  { id: 'metal', progress: 0, part: 'part-000' },
  { id: 'key', progress: 0, part: 'part-070' },
  { id: 'layers', progress: 0.6, view: 'structure' },
  { id: 'flat', progress: 1, view: 'knoll' },
]
const report = {
  passed: false,
  comparison,
  fixture: false,
  viewport: { width: 1440, height: 1000 },
  inputs: [],
  layouts: [],
  checks: [],
  errors: [],
  requests: [],
  pending: [
    'Owner visual review',
    'Actual GPU/presented-frame budget',
    '20-minute joint acceptance',
  ],
  method: `Actual production WebGPU, automatic v2, ${
    comparison === 'studio'
      ? 'light versus dark visible studio palette, same rotating reflection kernel and reference HDR'
      : comparison === 'reflection'
        ? 'whole-scene planar capture versus product-only coverage-weighted capture versus planar layer disabled, fixed light studio, rotating eight-tap reflection kernel and no spatial-background experiment'
        : 'static versus rotating eight-tap kernel'
  }. Same assets, camera, pose, lights and product material inputs. The reflection comparison changes what the planar layer captures and blends; it does not isolate the stochastic SSR algorithm. Complete-frame counters are CPU command submission counts, not GPU or presentation timing. Screenshots are qualitative evidence, not proof of improvement. No extra render loop or production pixel readback.`,
}
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ channel: 'msedge', headless: true }),
  page = await browser.newPage({ viewport: report.viewport, deviceScaleFactor: 1 }),
  baseline = new Map()
page.on('pageerror', (error) => report.errors.push(error.message))
page.on('console', (message) => {
  if (message.type() === 'error') report.errors.push(message.text())
})
page.on('request', (request) => report.requests.push(request.url()))

async function attach() {
  await bridge(page, true)
  await page.evaluate(() => {
    const seen = new Set()
    const visit = (vnode) => {
      if (!vnode || typeof vnode !== 'object' || seen.has(vnode)) return
      seen.add(vnode)
      const component = vnode.component,
        exposed = component?.exposed?.realLighting,
        value = exposed?.value ?? exposed
      if (value?.snapshot && value?.setSignals) return value
      const nested = visit(component?.subTree)
      if (nested) return nested
      for (const child of Array.isArray(vnode.children) ? vnode.children : []) {
        const found = visit(child)
        if (found) return found
      }
      return visit(vnode.suspense?.activeBranch)
    }
    window.__kernelLighting = visit(document.querySelector('#app')._vnode)
    if (!window.__kernelLighting) throw new Error('Production coordinator unavailable')
  })
}
const lighting = () => page.evaluate(() => window.__kernelLighting.snapshot())
async function settle() {
  const first = await lighting()
  await expect
    .poll(
      async () => {
        const current = await lighting()
        if (current.error) throw new Error(current.error)
        return current.frames
      },
      { timeout: 120000 },
    )
    .toBeGreaterThan(first.frames + 48)
}
const snapshot = () =>
  page.evaluate(() => {
    const test = window.__demo,
      renderer = test.scene.renderer.instance,
      scene = test.scene.scene.value,
      root = scene.children.find((node) => node.userData.workbenchProduct),
      studio = scene.children.find((node) => node.userData.studio && !node.userData.capture),
      pedestal = studio?.getObjectByName('Trees X / studio pedestal'),
      floor = studio?.getObjectByName('Trees X / studio floor'),
      planar = scene.getObjectByName('Trees X / studio reflection'),
      camera = test.scene.camera.activeCamera.value,
      poses = [],
      materials = new Map(),
      lights = []
    let parts = 0
    root.traverse((node) => {
      if (Number.isInteger(node.userData.partId)) {
        parts++
        poses.push([
          node.name,
          ...node.position.toArray(),
          ...node.quaternion.toArray(),
          ...node.scale.toArray(),
        ])
      }
      for (const material of node.material
        ? Array.isArray(node.material)
          ? node.material
          : [node.material]
        : []) {
        const textures = ['map', 'normalMap', 'roughnessMap', 'anisotropyMap'].map((slot) => {
          const t = material[slot]
          return t
            ? [slot, t.name, t.channel, t.image?.width, t.image?.height, t.colorSpace]
            : [slot]
        })
        materials.set(material.name, [
          material.name,
          material.color?.getHexString(),
          material.roughness,
          material.metalness,
          material.clearcoat,
          material.clearcoatRoughness,
          material.anisotropy,
          material.anisotropyRotation,
          material.envMapIntensity,
          textures,
        ])
      }
    })
    scene.traverse((node) => {
      if (node.isLight)
        lights.push([
          node.type,
          node.name,
          node.color.getHexString(),
          node.intensity,
          ...node.position.toArray(),
          ...node.quaternion.toArray(),
          node.width,
          node.height,
        ])
    })
    return {
      slug: root.userData.workbenchProduct,
      version: root.userData.bundleVersion,
      hash: root.userData.bundleSha256,
      parts,
      nativeWebgpu: !!renderer.backend?.isWebGPUBackend,
      sameCanvas: document.querySelector('canvas') === test.canvas,
      sameRenderer: renderer === test.renderer,
      camera: [
        ...camera.position.toArray(),
        ...camera.quaternion.toArray(),
        ...camera.projectionMatrix.elements,
      ],
      poses,
      materials: [...materials.values()].sort((a, b) => a[0].localeCompare(b[0])),
      lights,
      exposure: renderer.toneMappingExposure,
      environmentIntensity: scene.environmentIntensity,
      environmentTextureName: scene.environment?.name ?? null,
      planarReflection: {
        present: !!planar,
        visible: planar?.visible ?? false,
        capture: planar?.userData.reflectionCapture ?? null,
      },
      visibleStudio: {
        mood: studio?.userData.studioMood ?? null,
        pedestalColor: pedestal?.material?.color?.getHexString() ?? null,
        floorColor: floor?.material?.color?.getHexString() ?? null,
        background: scene.background?.isColor ? scene.background.getHexString() : null,
        fog: scene.fog?.color.getHexString() ?? null,
      },
      lighting: window.__kernelLighting.snapshot(),
    }
  })
const layoutSnapshot = () =>
  page.evaluate(() => {
    const stage = document.querySelector('.wb-stage'),
      title = document.querySelector('#wb-product-title')
    return {
      width: innerWidth,
      height: innerHeight,
      backend: stage?.getAttribute('data-render-backend'),
      mood: stage?.getAttribute('data-studio-mood'),
      title: title?.textContent,
      titleColor: title ? getComputedStyle(title).color : null,
      canvases: document.querySelectorAll('canvas').length,
    }
  })
try {
  for (const mode of modes) {
    const url = new URL('/?product=typewriter-study&renderPipeline=realtime', base)
    if (comparison === 'studio') url.searchParams.set('studioMood', mode)
    else if (comparison === 'reflection') {
      url.searchParams.set('studioMood', 'light')
      url.searchParams.set('planarReflection', mode)
    } else if (mode === 'static') url.searchParams.set('reflectionKernel', 'static')
    await page.goto(url.href)
    await expect(page.locator('.workbench')).toHaveAttribute('data-status', 'ready', {
      timeout: 240000,
    })
    await expect(page.locator('canvas')).toHaveCount(1)
    await attach()
    await settle()
    const first = await lighting()
    const kernel = comparison === 'kernel' ? mode : 'rotating'
    expect(first.reflectionKernel.mode).toBe(kernel)
    const firstPhase = first.reflectionKernel.phase
    await settle()
    const next = await lighting()
    expect(next.reflectionKernel.frames).toBeGreaterThan(first.reflectionKernel.frames)
    if (kernel === 'static') expect(next.reflectionKernel.phase).toBe(0)
    else expect(next.reflectionKernel.phase).not.toBe(firstPhase)
    for (const pose of poses) {
      console.log(`[${comparison} ${mode}] ${pose.id}`)
      await page.evaluate(() => {
        window.__demo.store.panel = null
        window.__demo.store.restore()
      })
      await page.waitForTimeout(1000)
      await page.evaluate(({ id, progress }) => window.__demo.store.motion('seek', id, progress), {
        id: action.id,
        progress: pose.progress,
      })
      if (pose.part) {
        const hotspot = product.presentation.hotspots.find(
          (item) => item.id === pose.part || item.node === pose.part,
        )
        if (!hotspot) throw new Error('Unbound part ' + pose.part)
        await page.evaluate((id) => window.__demo.store.focus(id), hotspot.id)
      } else await page.evaluate((id) => window.__demo.store.view(id), pose.view)
      await page.waitForTimeout(1200)
      await settle()
      const input = await snapshot()
      expect(input).toMatchObject({
        slug: 'typewriter-study',
        version: 2,
        hash: bundle.sha256,
        parts: 572,
        nativeWebgpu: true,
        sameCanvas: true,
        sameRenderer: true,
      })
      expect(input.lighting.reflectionKernel.mode).toBe(kernel)
      if (comparison === 'reflection') {
        expect(input.visibleStudio.mood).toBe('light')
        expect(input.environmentTextureName).toBe('Trees X / Studio Small 05 reference HDR')
        expect(input.planarReflection.visible).toBe(mode !== 'off')
        expect(input.planarReflection.capture).toBe(
          mode === 'scene' ? 'scene-rgb' : 'product-premultiplied-coverage',
        )
        expect(new URL(page.url()).searchParams.has('loungeSpatial')).toBe(false)
        expect(new URL(page.url()).searchParams.has('loungeLayers')).toBe(false)
      }
      if (comparison === 'studio') {
        expect(input.visibleStudio).toEqual(
          mode === 'dark'
            ? {
                mood: 'dark',
                pedestalColor: '3f4944',
                floorColor: '2e3832',
                background: '333f39',
                fog: '333f39',
              }
            : {
                mood: 'light',
                pedestalColor: 'd7dcd5',
                floorColor: 'bfc8bd',
                background: 'e7e9e5',
                fog: 'e7e9e5',
              },
        )
        expect(input.environmentTextureName).toBe('Trees X / Studio Small 05 reference HDR')
      }
      const immutable = {
        poses: input.poses,
        materials: input.materials,
        lights: input.lights,
        exposure: input.exposure,
        environmentIntensity: input.environmentIntensity,
        environmentTextureName: input.environmentTextureName,
      }
      const inputHash = createHash('sha256').update(JSON.stringify(immutable)).digest('hex')
      if (mode === modes[0]) baseline.set(pose.id, { inputHash, camera: input.camera })
      else {
        const previous = baseline.get(pose.id)
        expect(inputHash, pose.id + ' matched inputs').toBe(previous.inputHash)
        const cameraError = Math.max(
          ...input.camera.map((n, i) => Math.abs(n - previous.camera[i])),
        )
        expect(cameraError, pose.id + ' camera').toBeLessThanOrEqual(1e-6)
        report.checks.push({ pose: pose.id, inputHash, cameraError })
      }
      await page.mouse.move(1, 1)
      const file = `${mode}-${pose.id}.png`
      await page.screenshot({ path: output + '/' + file })
      report.inputs.push({ mode, pose, file, inputHash, ...input })
    }
  }
  if (comparison === 'studio' || comparison === 'reflection') {
    for (const [width, height] of [
      [1280, 720],
      [1440, 1000],
      [1920, 1080],
    ]) {
      await page.setViewportSize({ width, height })
      await page.evaluate(() => {
        window.__demo.store.panel = null
        window.__demo.store.restore()
        window.__demo.store.view('perspective')
      })
      await page.waitForTimeout(1200)
      await settle()
      const before = await snapshot(),
        overview = await layoutSnapshot(),
        overviewFile = `layout-${width}-overview.png`
      expect(overview).toMatchObject({
        width,
        height,
        backend: 'webgpu',
        mood: comparison === 'reflection' ? 'light' : 'dark',
        canvases: 1,
      })
      if (comparison === 'studio') expect(overview.titleColor).toBe('rgb(241, 243, 238)')
      else {
        expect(overview.titleColor).toBeTruthy()
        expect(overview.titleColor).not.toBe('rgb(241, 243, 238)')
      }
      expect(before.sameCanvas && before.sameRenderer).toBe(true)
      await page.mouse.move(1, 1)
      await page.screenshot({ path: output + '/' + overviewFile })
      report.layouts.push({ ...overview, panel: null, file: overviewFile })
      await page.getByRole('button', { name: '结构与动作', exact: true }).click()
      await expect(page.locator('#wb-inspector')).toBeVisible()
      await page.waitForTimeout(350)
      await settle()
      const opened = await snapshot(),
        panel = await layoutSnapshot(),
        panelFile = `layout-${width}-actions.png`
      expect(opened.poses).toEqual(before.poses)
      expect(opened.sameCanvas && opened.sameRenderer).toBe(true)
      expect(panel).toEqual(overview)
      await page.mouse.move(1, 1)
      await page.screenshot({ path: output + '/' + panelFile })
      await page.getByRole('button', { name: '收起面板', exact: true }).click()
      await expect(page.locator('#wb-inspector')).toHaveCount(0)
      await settle()
      const closed = await snapshot()
      expect(closed.poses).toEqual(before.poses)
      expect(closed.sameCanvas && closed.sameRenderer).toBe(true)
      report.layouts.push({ ...panel, panel: 'actions', file: panelFile, posesPreserved: true })
    }
    const fallbackUrl = new URL('/?product=typewriter-study&renderPipeline=realtime', base)
    fallbackUrl.searchParams.set('studioMood', comparison === 'reflection' ? 'light' : 'dark')
    if (comparison === 'reflection') fallbackUrl.searchParams.set('planarReflection', 'off')
    for (const [width, height] of [
      [390, 844],
      [320, 740],
    ]) {
      await page.setViewportSize({ width, height })
      await page.goto(fallbackUrl.href)
      await expect(page.locator('.workbench')).toHaveAttribute('data-status', 'ready', {
        timeout: 240000,
      })
      const fallback = await layoutSnapshot(),
        file = `layout-${width}-fallback.png`
      expect(fallback).toMatchObject({ width, height, backend: 'webgl', mood: null, canvases: 1 })
      expect(fallback.title).toBeTruthy()
      expect(fallback.titleColor).toBeTruthy()
      expect(fallback.titleColor).not.toBe('rgb(241, 243, 238)')
      await page.mouse.move(1, 1)
      await page.screenshot({ path: output + '/' + file })
      report.layouts.push({ ...fallback, panel: null, file })
    }
  }
  expect(report.errors).toEqual([])
  expect(
    report.requests
      .filter((url) => /^https?:/.test(url))
      .every((url) => new URL(url).origin === new URL(base).origin),
  ).toBe(true)
  report.passed = true
} catch (error) {
  report.errors.push(error.stack || String(error))
  process.exitCode = 1
} finally {
  await writeFile(output + '/report.json', JSON.stringify(report, null, 2))
  await browser.close()
  console.log(JSON.stringify({ passed: report.passed, checks: report.checks.length, output }))
}
