/* global URL, document, window, btoa */
import { chromium, expect } from '@playwright/test'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ACESFilmicToneMapping, DataUtils, HalfFloatType } from 'three'
import sharp from 'sharp'
import { bridge, productEvidence, readProducts } from './demo/browser-check.mjs'

const base = process.env.CHECK_URL || 'http://127.0.0.1:5181',
  output = process.env.REFLECTION_DIAGNOSTIC_OUTPUT || 'artifacts/typewriter-reflection-diagnostic',
  timeout = Number(process.env.REFLECTION_DIAGNOSTIC_TIMEOUT || 240000),
  viewport = { width: 1440, height: 1000 }
if (!Number.isFinite(timeout) || timeout < 1000) throw new Error('Invalid diagnostic timeout')
const report = {
  passed: false,
  visualAcceptance: 'not evaluated',
  fixture: false,
  origin: new URL(base).origin,
  viewport,
  startedAt: new Date().toISOString(),
  captures: [],
  errors: [],
  failedRequests: [],
  requestOrigins: [],
  method:
    'One production realtime Canvas/renderer, published API and source assets. Three existing planar HalfFloat RT is read once per stationary variant, not from a second render or synthetic scene. Rendering continues during readback and subsequent Canvas screenshots; frame counters are recorded before/after the read, so images share fixed pose rather than claiming the same exact submitted frame. Native WebGPU rows retain 256-byte padding; raw bytes and a separately compacted RGBA16F file are preserved. PNGs use native top-to-bottom WebGPU texel rows without reflector flipX; floor sampling itself remains unchanged. CPU ACES preview mirrors Three r185 TSL ToneMappingFunctions, including its RRTAndODTFit denominator, then applies sRGB transfer. This is a diagnostic display conversion, not a new render or a visual-quality score.',
}
const origins = new Set()
let browser,
  page,
  stage = 'initialization'
const progress = (value) => {
  stage = value
  console.log(`[reflection diagnostic] ${value}`)
}
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')

// Mirrors installed Three r185 TSL, rather than the shorter ACES approximation.
function aces(r, g, b, exposure) {
  const factor = exposure / 0.6,
    x = (0.59719 * r + 0.35458 * g + 0.04823 * b) * factor,
    y = (0.076 * r + 0.90834 * g + 0.01566 * b) * factor,
    z = (0.0284 * r + 0.13383 * g + 0.83777 * b) * factor,
    fit = (v) => (v * (v + 0.0245786) - 0.000090537) / (v * ((v + 0.432951) * 0.983729) + 0.238081),
    a = fit(x),
    c = fit(y),
    d = fit(z)
  return [
    1.60475 * a - 0.53108 * c - 0.07367 * d,
    -0.10208 * a + 1.10813 * c - 0.00605 * d,
    -0.00327 * a - 0.07276 * c + 1.07602 * d,
  ]
}
const srgb = (linear) => {
  const value = Math.min(1, Math.max(0, linear))
  return Math.round((value <= 0.0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055) * 255)
}

async function savePixels(name, value) {
  const raw = Buffer.from(value.base64, 'base64'),
    { width, height, exposure, bytesPerRow } = value.metadata,
    compact = Buffer.alloc(width * height * 8),
    linear = Buffer.alloc(width * height * 4),
    mapped = Buffer.alloc(width * height * 4)
  expect(raw.length).toBe((height - 1) * bytesPerRow + width * 8)
  let minimum = Infinity,
    maximum = -Infinity,
    invalidComponents = 0,
    hdrComponents = 0
  for (let y = 0; y < height; y++)
    raw.copy(compact, y * width * 8, y * bytesPerRow, y * bytesPerRow + width * 8)
  for (let index = 0; index < width * height; index++) {
    const rgba = Array.from({ length: 4 }, (_, c) =>
      DataUtils.fromHalfFloat(compact.readUInt16LE(index * 8 + c * 2)),
    )
    for (const v of rgba) {
      if (!Number.isFinite(v)) invalidComponents++
      else {
        minimum = Math.min(minimum, v)
        maximum = Math.max(maximum, v)
        if (v > 1) hdrComponents++
      }
    }
    const rgb = rgba.slice(0, 3).map((v) => (Number.isFinite(v) ? Math.max(0, v) : 0)),
      transformed = aces(...rgb, exposure)
    for (let channel = 0; channel < 3; channel++) {
      linear[index * 4 + channel] = srgb(rgb[channel])
      mapped[index * 4 + channel] = srgb(transformed[channel])
    }
    // Opaque diagnostic previews show RT RGB, not alpha-composited checkerboards.
    linear[index * 4 + 3] = mapped[index * 4 + 3] = 255
  }
  const files = {
    rawPadded: `${name}.readback.rgba16f.bin`,
    rawCompact: `${name}.compact.rgba16f.bin`,
    linearSrgb: `${name}.rt-linear-srgb.png`,
    acesSrgb: `${name}.rt-aces-srgb.png`,
    canvas: `${name}.canvas.png`,
    page: `${name}.page.png`,
  }
  await Promise.all([
    writeFile(join(output, files.rawPadded), raw),
    writeFile(join(output, files.rawCompact), compact),
    sharp(linear, { raw: { width, height, channels: 4 } })
      .png()
      .toFile(join(output, files.linearSrgb)),
    sharp(mapped, { raw: { width, height, channels: 4 } })
      .png()
      .toFile(join(output, files.acesSrgb)),
  ])
  await page.locator('canvas').screenshot({ path: join(output, files.canvas) })
  await page.screenshot({ path: join(output, files.page) })
  const metadata = {
    ...value.metadata,
    files,
    rawSha256: digest(raw),
    compactSha256: digest(compact),
    minimum,
    maximum,
    invalidComponents,
    hdrComponents,
  }
  await writeFile(join(output, `${name}.json`), `${JSON.stringify(metadata, null, 2)}\n`)
  expect(invalidComponents).toBe(0)
  return metadata
}

await mkdir(output, { recursive: true })
try {
  const { products } = await readProducts(base),
    metadata = products.find((item) => item.product.slug === 'typewriter-study')
  if (!metadata) throw new Error('Published typewriter absent')
  report.published = productEvidence(metadata)
  browser = await chromium.launch({
    channel: 'msedge',
    headless: process.env.REFLECTION_DIAGNOSTIC_HEADED !== '1',
  })
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 })
  page = await context.newPage()
  page.on('pageerror', (error) => report.errors.push({ stage, message: error.message }))
  page.on('console', (message) => {
    if (message.type() === 'error') report.errors.push({ stage, message: message.text() })
  })
  page.on('requestfailed', (request) =>
    report.failedRequests.push({ stage, url: request.url(), reason: request.failure()?.errorText }),
  )
  page.on('request', (request) => {
    if (/^https?:/.test(request.url())) origins.add(new URL(request.url()).origin)
  })
  page.on('response', (response) => {
    if (response.status() >= 400)
      report.errors.push({ stage, message: `${response.status()} ${response.url()}` })
  })
  progress('Load published default whole view in realtime workbench')
  await page.goto(new URL('/?product=typewriter-study&renderPipeline=realtime', base).href, {
    waitUntil: 'domcontentloaded',
  })
  await expect(page.locator('.workbench')).toHaveAttribute('data-slug', metadata.product.slug, {
    timeout,
  })
  await expect
    .poll(
      async () => {
        const status = await page.locator('.workbench').getAttribute('data-status')
        if (status === 'error' || status === 'content')
          throw new Error(`Actual realtime workbench failed: ${status}`)
        return status
      },
      { timeout, intervals: [250, 500, 1000] },
    )
    .toBe('ready')
  await expect(page.locator('canvas')).toHaveCount(1)
  await expect(page.locator('.wb-stage')).toHaveAttribute('data-render-backend', 'webgpu')
  await bridge(page, true)
  const identity = await page.evaluate(() => {
    const context = window.__demo.scene,
      renderer = context.renderer.instance,
      roots = context.scene.value.children.filter((node) => node.userData.workbenchProduct)
    if (roots.length !== 1) throw new Error('Actual unique product root absent')
    const root = roots[0]
    let parts = 0,
      instances = 0
    root.traverse((node) => {
      if (Number.isInteger(node.userData.partId)) parts++
      if (node.isInstancedMesh) instances += node.count
    })
    return {
      slug: root.userData.workbenchProduct,
      source: root.userData.sourceKind,
      adapter: root.userData.adapter,
      bundle: root.userData.assetBundle,
      semanticParts: parts,
      instances,
      nativeWebgpu: Boolean(
        renderer.isWebGPURenderer &&
        renderer.backend?.isWebGPUBackend &&
        renderer.backend.device?.queue,
      ),
    }
  })
  expect(identity).toMatchObject({
    slug: metadata.product.slug,
    source: 'glb',
    adapter: metadata.product.presentation.source.adapter,
    bundle: `${metadata.manifest.id}@${metadata.manifest.version}`,
    semanticParts: 572,
    instances: 2257,
    nativeWebgpu: true,
  })
  report.identity = identity
  await page.evaluate(() => {
    const seen = new Set()
    const visit = (vnode) => {
      if (!vnode || typeof vnode !== 'object' || seen.has(vnode)) return
      seen.add(vnode)
      const current = vnode.component
      if (current) {
        const exposed = current.exposed?.realLighting,
          value = exposed?.value ?? exposed
        if (value?.snapshot && value?.setSignals) return value
        const found = visit(current.subTree)
        if (found) return found
      }
      for (const child of Array.isArray(vnode.children) ? vnode.children : []) {
        const found = visit(child)
        if (found) return found
      }
      return visit(vnode.suspense?.activeBranch)
    }
    const lighting = visit(document.querySelector('#app')?._vnode),
      scene = window.__demo.scene.scene.value,
      mesh = scene.getObjectByName('Trees X / studio reflection'),
      bases = new Set(),
      nodes = new Set(),
      stack = [mesh?.material.colorNode]
    while (stack.length) {
      const node = stack.pop()
      if (!node || nodes.has(node)) continue
      nodes.add(node)
      if (node.reflector?.renderTargets instanceof Map) bases.add(node.reflector)
      for (const child of node.getChildren?.() ?? []) stack.push(child)
    }
    if (!lighting || bases.size !== 1) throw new Error('Actual lighting/unique reflector absent')
    const base = [...bases][0],
      contact = scene.getObjectByName('Trees X / studio contact shadow'),
      decals = new Set(),
      lights = []
    scene.traverse((node) => {
      if (node.isLight) lights.push(node)
      for (const material of node.material
        ? Array.isArray(node.material)
          ? node.material
          : [node.material]
        : [])
        if (
          material.transparent &&
          material.map &&
          /^decal-(?:[6-9]|[1-4]\d|5[0-5]|62)$/.test(material.name)
        )
          decals.add(material)
    })
    if (!contact || !decals.size || !lights.some((light) => light.isDirectionalLight))
      throw new Error('Actual contact plane/known character decals/directional fill absent')
    window.__reflectionDiagnostic = {
      lighting,
      base,
      mesh,
      contact,
      decals: [...decals],
      initialContact: contact.visible,
      initialDecals: [...decals].map((material) => material.visible),
      lights,
      initialLightIntensities: lights.map((light) => light.intensity),
      initialSignals: lighting.snapshot().signals,
      drawObservations: [],
      originalBefore: scene.onBeforeRender,
    }
    scene.onBeforeRender = function (...args) {
      const diagnostic = window.__reflectionDiagnostic,
        renderer = args[0],
        camera = args[2]
      if (scene.name.includes('[ Reflector ]'))
        diagnostic.drawObservations.push({
          target: renderer.getRenderTarget()?.texture.uuid,
          mrt: renderer.getMRT() === null ? null : 'present',
          camera: camera.uuid,
        })
      return diagnostic.originalBefore.apply(this, args)
    }
  })
  for (const variant of ['baseline', 'hide-contact', 'hide-known-decals', 'hide-directional']) {
    progress(`Capture ${variant}`)
    try {
      const previous = await page.evaluate((variant) => {
        const d = window.__reflectionDiagnostic
        d.contact.visible = variant === 'hide-contact' ? false : d.initialContact
        d.decals.forEach((material, index) => {
          material.visible = variant === 'hide-known-decals' ? false : d.initialDecals[index]
        })
        d.lights.forEach((light, index) => {
          light.intensity =
            variant === 'hide-directional' && light.isDirectionalLight
              ? 0
              : d.initialLightIntensities[index]
        })
        d.drawObservations.length = 0
        const s = d.initialSignals
        d.lighting.setSignals(!s.ssr, !s.ssgi, !s.denoise)
        d.lighting.setSignals(s.ssr, s.ssgi, s.denoise)
        return d.lighting.snapshot().frames
      }, variant)
      await expect
        .poll(() => page.evaluate(() => window.__reflectionDiagnostic.lighting.snapshot().frames), {
          timeout,
          intervals: [100, 250],
        })
        .toBeGreaterThanOrEqual(previous + 48)
      const value = await page.evaluate(async () => {
        const d = window.__reflectionDiagnostic,
          context = window.__demo.scene,
          renderer = context.renderer.instance,
          scene = context.scene.value,
          camera = context.camera.activeCamera.value,
          targets = [...d.base.renderTargets.entries()].filter(
            ([, target]) => target.texture === d.base.textureNode.value,
          )
        if (targets.length !== 1) throw new Error('Unique existing current reflection RT absent')
        const readStartFrame = d.lighting.snapshot().frames
        const [virtualCamera, target] = targets[0],
          width = target.width,
          height = target.height,
          pixels = await renderer.readRenderTargetPixelsAsync(target, 0, 0, width, height),
          bytes = new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength)
        let binary = ''
        for (let i = 0; i < bytes.length; i += 32768)
          binary += String.fromCharCode(...bytes.subarray(i, i + 32768))
        const root = scene.children.find((node) => node.userData.workbenchProduct)
        let parts = 0,
          instances = 0
        root.traverse((node) => {
          if (Number.isInteger(node.userData.partId)) parts++
          if (node.isInstancedMesh) instances += node.count
        })
        return {
          base64: btoa(binary),
          metadata: {
            width,
            height,
            bytesPerRow: Math.ceil((width * 8) / 256) * 256,
            componentType: pixels.constructor.name,
            textureType: target.texture.type,
            textureColorSpace: target.texture.colorSpace,
            textureUuid: target.texture.uuid,
            samples: target.samples,
            resolutionScale: d.base.resolutionScale,
            rowOrigin: 'top-left WebGPU native',
            reflectorFlipXAppliedToPreview: false,
            exposure: renderer.toneMappingExposure,
            toneMapping: renderer.toneMapping,
            outputColorSpace: renderer.outputColorSpace,
            readStartFrame,
            readCompleteFrame: d.lighting.snapshot().frames,
            semanticParts: parts,
            instances,
            rootUuid: root.uuid,
            rootTransform: {
              position: root.position.toArray(),
              quaternion: root.quaternion.toArray(),
              scale: root.scale.toArray(),
              world: root.matrixWorld.toArray(),
            },
            bundle: root.userData.assetBundle,
            sameCanvas: document.querySelector('canvas') === window.__demo.canvas,
            sameRenderer: renderer === window.__demo.renderer,
            camera: {
              position: camera.position.toArray(),
              world: camera.matrixWorld.toArray(),
              projection: camera.projectionMatrix.toArray(),
              view: camera.view,
            },
            reflectionCamera: {
              position: virtualCamera.position.toArray(),
              world: virtualCamera.matrixWorld.toArray(),
              projection: virtualCamera.projectionMatrix.toArray(),
              coordinateSystem: virtualCamera.coordinateSystem,
            },
            reflectionPlaneWorld: d.base.target.matrixWorld.toArray(),
            lights: d.lights.map((light, index) => ({
              type: light.type,
              name: light.name,
              uuid: light.uuid,
              intensity: light.intensity,
              originalIntensity: d.initialLightIntensities[index],
              color: light.color.toArray(),
              position: light.position.toArray(),
              world: light.matrixWorld.toArray(),
              targetWorld: light.target?.matrixWorld.toArray() ?? null,
              width: light.width ?? null,
              height: light.height ?? null,
            })),
            contactVisible: d.contact.visible,
            decals: d.decals.map((material) => ({
              name: material.name,
              visible: material.visible,
              alphaTest: material.alphaTest,
              opacity: material.opacity,
              depthWrite: material.depthWrite,
            })),
            drawObservations: d.drawObservations.slice(-4),
            lighting: d.lighting.snapshot(),
            memory: { ...renderer.info.memory },
          },
        }
      })
      expect(value.metadata.textureType).toBe(HalfFloatType)
      expect(value.metadata.componentType).toBe('Uint16Array')
      expect(value.metadata.toneMapping).toBe(ACESFilmicToneMapping)
      expect(value.metadata.semanticParts).toBe(572)
      expect(value.metadata.instances).toBe(2257)
      expect(value.metadata.sameCanvas && value.metadata.sameRenderer).toBe(true)
      expect(
        value.metadata.lights
          .filter((light) => light.type === 'DirectionalLight')
          .every(
            (light) =>
              light.intensity === (variant === 'hide-directional' ? 0 : light.originalIntensity),
          ),
      ).toBe(true)
      expect(value.metadata.drawObservations.length).toBeGreaterThan(0)
      expect(value.metadata.drawObservations.every((draw) => draw.mrt === null)).toBe(true)
      report.captures.push(await savePixels(variant, value))
    } finally {
      await page.evaluate(() => {
        const d = window.__reflectionDiagnostic
        d.contact.visible = d.initialContact
        d.decals.forEach((material, index) => {
          material.visible = d.initialDecals[index]
        })
        d.lights.forEach((light, index) => {
          light.intensity = d.initialLightIntensities[index]
        })
        const s = d.initialSignals
        d.lighting.setSignals(!s.ssr, !s.ssgi, !s.denoise)
        d.lighting.setSignals(s.ssr, s.ssgi, s.denoise)
      })
    }
  }
  report.restored = await page.evaluate(() => {
    const d = window.__reflectionDiagnostic,
      scene = window.__demo.scene.scene.value
    scene.onBeforeRender = d.originalBefore
    return (
      d.contact.visible === d.initialContact &&
      d.decals.every((material, index) => material.visible === d.initialDecals[index]) &&
      d.lights.every((light, index) => light.intensity === d.initialLightIntensities[index])
    )
  })
  expect(report.restored).toBe(true)
  expect(report.captures.map((capture) => capture.camera)).toEqual(
    Array(report.captures.length).fill(report.captures[0].camera),
  )
  expect(report.errors).toEqual([])
  expect(report.failedRequests).toEqual([])
  expect([...origins]).toEqual([new URL(base).origin])
  report.passed = true
} catch (error) {
  report.failure = { stage, message: error.message }
  process.exitCode = 1
} finally {
  if (page && !page.isClosed())
    await page
      .evaluate(() => {
        const d = window.__reflectionDiagnostic
        if (!d) return
        d.contact.visible = d.initialContact
        d.decals.forEach((material, index) => {
          material.visible = d.initialDecals[index]
        })
        d.lights.forEach((light, index) => {
          light.intensity = d.initialLightIntensities[index]
        })
        window.__demo.scene.scene.value.onBeforeRender = d.originalBefore
        const s = d.initialSignals
        d.lighting.setSignals(s.ssr, s.ssgi, s.denoise)
        delete window.__reflectionDiagnostic
      })
      .catch(() => {})
  await browser?.close()
  report.requestOrigins = [...origins]
  report.completedAt = new Date().toISOString()
  await writeFile(join(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
  console.log(
    JSON.stringify({
      passed: report.passed,
      captures: report.captures.length,
      report: join(output, 'report.json'),
      failure: report.failure,
    }),
  )
}
