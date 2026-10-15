/* global fetch, URL */
import { chromium, expect } from '@playwright/test'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { bridge } from './demo/browser-check.mjs'

const base = process.env.CHECK_URL || 'http://127.0.0.1:5181',
  output = process.env.REALTIME_KERNEL_OUTPUT || 'artifacts/webgpu-rollin/kernel',
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
  fixture: false,
  viewport: { width: 1440, height: 1000 },
  inputs: [],
  checks: [],
  errors: [],
  requests: [],
  pending: [
    'Owner visual review',
    'Actual GPU/presented-frame budget',
    '20-minute joint acceptance',
  ],
  method:
    'Actual production WebGPU, automatic v2, static versus rotating eight-tap kernel. Same assets, camera, pose, lights and material inputs. Complete-frame counters are CPU command submission counts, not GPU or presentation timing. Screenshots are qualitative evidence, not proof of improvement. No extra render loop or production pixel readback.',
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
      lighting: window.__kernelLighting.snapshot(),
    }
  })
try {
  for (const mode of ['static', 'rotating']) {
    const url = new URL('/?product=typewriter-study&renderPipeline=realtime', base)
    if (mode === 'static') url.searchParams.set('reflectionKernel', 'static')
    await page.goto(url.href)
    await expect(page.locator('.workbench')).toHaveAttribute('data-status', 'ready', {
      timeout: 240000,
    })
    await expect(page.locator('canvas')).toHaveCount(1)
    await attach()
    await settle()
    const first = await lighting()
    expect(first.reflectionKernel.mode).toBe(mode)
    const firstPhase = first.reflectionKernel.phase
    await settle()
    const next = await lighting()
    expect(next.reflectionKernel.frames).toBeGreaterThan(first.reflectionKernel.frames)
    if (mode === 'static') expect(next.reflectionKernel.phase).toBe(0)
    else expect(next.reflectionKernel.phase).not.toBe(firstPhase)
    for (const pose of poses) {
      console.log(`[kernel ${mode}] ${pose.id}`)
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
      expect(input.lighting.reflectionKernel.mode).toBe(mode)
      const immutable = {
        poses: input.poses,
        materials: input.materials,
        lights: input.lights,
        exposure: input.exposure,
        environmentIntensity: input.environmentIntensity,
      }
      const inputHash = createHash('sha256').update(JSON.stringify(immutable)).digest('hex')
      if (mode === 'static') baseline.set(pose.id, { inputHash, camera: input.camera })
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
