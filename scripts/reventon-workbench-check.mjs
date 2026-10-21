/* global fetch, URL, URLSearchParams, setTimeout, setInterval, performance, MutationObserver */
import { chromium, expect } from '@playwright/test'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { bridge as attachWorkbench } from './demo/browser-check.mjs'

const base = process.env.CHECK_URL || 'http://127.0.0.1:5181'
const lifecycle = process.env.REVENTON_LIFECYCLE === '1'
const pipeline = process.env.REVENTON_PIPELINE || 'webgl'
const indirectLighting = process.env.REVENTON_INDIRECT || 'ssgi'
const assetLoading = process.env.REVENTON_LOADING || 'legacy'
const assetVariant = process.env.REVENTON_ASSET || 'original'
if (!['webgl', 'realtime'].includes(pipeline)) throw new Error('Invalid REVENTON_PIPELINE')
if (!['ssgi', 'ddgi'].includes(indirectLighting)) throw new Error('Invalid REVENTON_INDIRECT')
if (!['legacy', 'streaming'].includes(assetLoading)) throw new Error('Invalid REVENTON_LOADING')
if (!['original', 'runtime-v2'].includes(assetVariant)) throw new Error('Invalid REVENTON_ASSET')
const output = process.env.REVENTON_CHECK_OUTPUT || 'artifacts/reventon-workbench/runtime'
const timeout = 180000
const report = {
  passed: false,
  fixture: false,
  lifecycle,
  pipeline,
  indirectLighting,
  assetLoading,
  assetVariant,
  presentedFrameBudgetValidated: false,
  checks: [],
  states: {},
  captures: [],
  requests: [],
  failedRequests: [],
  errors: [],
  errorEvents: [],
  expectedFaultErrors: [],
  anchors: [],
  memory: [],
}
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ channel: 'msedge', headless: true })
let page
try {
  const api = await fetch(base + '/api/v1/products/reventon')
  expect(api.status).toBe(200)
  const product = await api.json()
  const p = product.presentation
  expect(p.version).toBe(3)
  expect(p.source.kind).toBe('glb')
  expect(p.source.adapter).toBe('reventon-v1')
  expect(p.structureActionId).toBe('explore-parts')
  const doors = p.actions.find((action) => action.id === 'open-doors')
  const parts = p.actions.find((action) => action.id === 'explore-parts')
  expect(doors.motion.tracks).toHaveLength(2)
  expect(parts.motion.tracks).toHaveLength(7)
  expect(doors.motion.tracks.every((track) => track.type === 'rotate')).toBe(true)
  expect(parts.motion.tracks.every((track) => track.type === 'translate')).toBe(true)
  const selectedBundle =
    assetVariant === 'runtime-v2'
      ? JSON.parse(
          await readFile('public/models/reventon-runtime-v2/bundle-reference.json', 'utf8'),
        )
      : p.source.bundle
  const manifestResponse = await fetch(new URL(selectedBundle.manifest, base))
  expect(manifestResponse.status).toBe(200)
  const manifest = await manifestResponse.json()
  report.bundle = {
    id: manifest.id,
    version: manifest.version,
    bytes: manifest.files.reduce((sum, file) => sum + file.bytes, 0),
    files: manifest.files.length,
  }
  const catalogResponse = await fetch(base + '/api/v1/products')
  expect(catalogResponse.status).toBe(200)
  const catalog = await catalogResponse.json()
  expect(catalog.map((item) => item.slug).sort()).toEqual([
    'piano-cfx',
    'reventon',
    'typewriter-study',
  ])

  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  page = await context.newPage()
  if (process.env.REVENTON_COPY_DIAGNOSTICS === '1')
    await page.addInitScript(() => {
      window.__carCopyFaults = []
      const seenRenderers = new WeakSet()
      setInterval(() => {
        const seen = new Set()
        const visit = (vnode) => {
          if (!vnode || typeof vnode !== 'object' || seen.has(vnode)) return
          seen.add(vnode)
          const component = vnode.component
          if (component) {
            for (const key of Reflect.ownKeys(component.provides ?? {})) {
              const value = component.provides[key]
              const renderer = value?.scene?.value?.isScene && value?.renderer?.instance
              if (!renderer?.isWebGPURenderer || seenRenderers.has(renderer)) continue
              seenRenderers.add(renderer)
              const backend = renderer.backend,
                copy = backend.copyFramebufferToTexture
              backend.copyFramebufferToTexture = function (texture, context, rectangle) {
                const source = context.renderTarget
                    ? backend.get(context.textures[0])?.texture
                    : null,
                  destination = backend.get(texture)?.texture
                if (source && destination && source.format !== destination.format)
                  window.__carCopyFaults.push({
                    atMs: performance.now(),
                    slug: document.querySelector('.workbench')?.dataset.slug,
                    status: document.querySelector('.workbench')?.dataset.status,
                    source: source.format,
                    destination: destination.format,
                    texture: texture.id,
                    type: texture.type,
                    version: texture.version,
                    contextTarget: context.renderTarget?.texture?.id,
                    activeTarget: renderer.getRenderTarget()?.texture?.id,
                    compiling: renderer._compilationPromises !== null,
                    stack: new Error('Framebuffer format diagnostic').stack,
                  })
                return copy.call(this, texture, context, rectangle)
              }
            }
            visit(component.subTree)
          }
          if (Array.isArray(vnode.children)) vnode.children.forEach(visit)
          visit(vnode.suspense?.activeBranch)
        }
        visit(document.querySelector('#app')?._vnode)
      }, 50)
    })
  let injectingFault = false
  let destroyingDevice = false
  let phase = 'initial-load'
  const unexpected = (message, location) => {
    report.errors.push(message)
    report.errorEvents.push({ message, phase, atMs: performance.now(), url: page.url(), location })
  }
  page.on('pageerror', (error) => unexpected(error.message))
  page.on('console', (message) => {
    if (message.type() !== 'error') return
    if (injectingFault && /Failed to load resource|net::ERR_FAILED/.test(message.text()))
      report.expectedFaultErrors.push(message.text())
    else if (
      destroyingDevice &&
      /GPU.*device.*lost|device.*lost|WebGPU.*destroyed/i.test(message.text())
    )
      report.expectedFaultErrors.push(message.text())
    else unexpected(message.text(), message.location())
  })
  page.on('request', (request) => report.requests.push(request.url()))
  page.on('requestfailed', (request) =>
    report.failedRequests.push({ url: request.url(), reason: request.failure()?.errorText }),
  )
  const bridge = async () => {
    await attachWorkbench(page)
    await page.evaluate(() => {
      window.__carScene = window.__demo.scene
      window.__carMotion = window.__demo.motion
      window.__carStore = window.__demo.store
      const seen = new Set()
      const lighting = (vnode) => {
        if (!vnode || typeof vnode !== 'object' || seen.has(vnode)) return
        seen.add(vnode)
        const current = vnode.component
        if (current) {
          const exposed = current.exposed?.realLighting
          const value = exposed?.value ?? exposed
          if (value?.snapshot && value?.setSignals) return value
          const child = lighting(current.subTree)
          if (child) return child
        }
        if (Array.isArray(vnode.children))
          for (const child of vnode.children) {
            const value = lighting(child)
            if (value) return value
          }
        return lighting(vnode.suspense?.activeBranch)
      }
      window.__carLighting = lighting(document.querySelector('#app')?._vnode)
    })
  }
  const ready = async (slug) => {
    await expect(page.locator('.workbench')).toHaveAttribute('data-slug', slug)
    await page.waitForFunction(
      () =>
        ['ready', 'error', 'content'].includes(
          document.querySelector('.workbench')?.dataset.status,
        ),
      null,
      { timeout },
    )
    if ((await page.locator('.workbench').getAttribute('data-status')) !== 'ready')
      throw new Error(await page.locator('.wb-stage-status').innerText())
    await expect(page.locator('.workbench')).toHaveAttribute('data-status', 'ready', { timeout })
    await expect(page.locator('canvas')).toHaveCount(1)
    await bridge()
    expect(
      await page.evaluate(() =>
        window.__carScene.scene.value.children
          .filter((node) => node.userData.workbenchProduct)
          .map((node) => node.userData.workbenchProduct),
      ),
    ).toEqual([slug])
  }
  const state = () =>
    page.evaluate(() => {
      const scene = window.__carScene
      const root = scene.scene.value.children.find((node) => node.userData.workbenchProduct)
      const nodes = {},
        motionNodes = {},
        modelTextures = new Set()
      let triangles = 0,
        sourceObjects = 0,
        meshes = 0
      root.updateMatrixWorld(true)
      root.traverse((node) => {
        const value = {
          position: node.position.toArray(),
          quaternion: node.quaternion.toArray(),
          scale: node.scale.toArray(),
          world: node.matrixWorld.toArray(),
        }
        if (node.name) nodes[node.name] = value
        if (typeof node.userData.reventon_motion_id === 'string')
          motionNodes[node.userData.reventon_motion_id] = { name: node.name, ...value }
        if (node.isMesh) {
          for (const material of Array.isArray(node.material) ? node.material : [node.material])
            for (const value of Object.values(material))
              if (value?.isTexture) modelTextures.add(value)
          meshes++
          triangles +=
            ((node.geometry.index?.count ?? node.geometry.attributes.position?.count ?? 0) / 3) *
            (node.isInstancedMesh ? node.count : 1)
          sourceObjects += node.userData.source_object_count ?? 0
        }
      })
      const camera = scene.camera.activeCamera.value
      const adapterInfo = scene.renderer.instance.backend?.device?.adapterInfo
      return {
        slug: root.userData.workbenchProduct,
        source: root.userData.sourceKind,
        adapter: root.userData.adapter,
        bundleVersion: root.userData.bundleVersion,
        bundleSha256: root.userData.bundleSha256,
        modelTextures: [...modelTextures].map((value) => {
          const native = scene.renderer.instance.backend?.get(value)?.texture
          return {
            name: value.name,
            width: value.image?.width ?? value.source?.data?.width,
            height: value.image?.height ?? value.source?.data?.height,
            compressed: value.isCompressedTexture === true,
            mipCount: value.mipmaps?.length ?? 0,
            gpuFormat: native?.format ?? null,
          }
        }),
        triangles,
        sourceObjects,
        meshes,
        nodes,
        motionNodes,
        motion: { ...window.__carMotion.states.value },
        camera: [...camera.position.toArray(), ...camera.quaternion.toArray()],
        finishId: window.__carStore.finishId,
        selectedPart: window.__carStore.selectedPart,
        sameCanvas: document.querySelector('canvas') === window.__carCanvas,
        sameRenderer: scene.renderer.instance === window.__carRenderer,
        rendererBackend: scene.renderer.instance.isWebGPURenderer ? 'webgpu' : 'webgl',
        gpuAdapter: adapterInfo
          ? {
              vendor: adapterInfo.vendor,
              architecture: adapterInfo.architecture,
              device: adapterInfo.device,
              description: adapterInfo.description,
            }
          : null,
        output: {
          width: document.querySelector('canvas').width,
          height: document.querySelector('canvas').height,
        },
        memory: { ...scene.renderer.instance.info.memory },
        lighting: window.__carLighting?.snapshot() ?? null,
      }
    })
  const saved = async (name) => {
    const value = await state()
    // Persist relevant nodes only; the full mesh hierarchy is deliberately not duplicated in reports.
    const valueForReport = {
      ...value,
      nodes: Object.fromEntries(
        [
          ...new Set([...doors.motion.tracks, ...parts.motion.tracks].map((track) => track.node)),
        ].map((node) => [node, value.nodes[node]]),
      ),
    }
    report.states[name] = valueForReport
    await writeFile(`${output}/${name}.json`, JSON.stringify(valueForReport, null, 2) + '\n')
    return value
  }
  const controls = () => page.locator('.wb-car-motion')
  const control = (id) => controls().locator(`[data-motion-id="${id}"]`)
  const settled = async (id, value) => {
    await expect
      .poll(async () => (await state()).motion[id]?.progress, { timeout: 20000 })
      .toBeCloseTo(value, 8)
    await expect.poll(async () => (await state()).motion[id]?.playing).toBe(false)
    return state()
  }
  const stable = async () => {
    await expect
      .poll(async () => Object.values((await state()).motion).some((m) => m.playing))
      .toBe(false)
    const paused = await state()
    await page.waitForTimeout(250)
    expect((await state()).motionNodes).toEqual(paused.motionNodes)
    expect((await state()).motion).toEqual(paused.motion)
    return paused
  }
  const seek = async (id, value) => {
    await page.evaluate(({ id, value }) => window.__carStore.motion('seek', id, value), {
      id,
      value,
    })
    return settled(id, value)
  }
  const play = async (action, value) => {
    await control(action.id)
      .getByRole('button', {
        name: value ? action.motion.openLabel : action.motion.closeLabel,
        exact: true,
      })
      .click()
    return settled(action.id, value)
  }
  const start = async (action) => {
    await seek(action.id, 0)
    await control(action.id)
      .getByRole('button', { name: action.motion.openLabel, exact: true })
      .click()
    await expect.poll(async () => (await state()).motion[action.id]?.playing).toBe(true)
  }
  const cameraNear = (a, b, tolerance = 1e-6) => {
    expect(Math.max(...a.map((value, index) => Math.abs(value - b[index])))).toBeLessThan(tolerance)
  }
  const poseNear = (a, b) => {
    for (const id of Object.keys(a))
      for (const channel of ['position', 'quaternion', 'scale', 'world'])
        cameraNear(a[id][channel], b[id][channel], 1e-8)
  }
  const assertTracks = (value, baseline, action, progress) => {
    for (const track of action.motion.tracks) {
      const current = value.nodes[track.node],
        initial = baseline.nodes[track.node]
      expect(current, 'actual track node ' + track.node).toBeDefined()
      const local = Math.min(
        1,
        Math.max(0, (progress - track.range[0]) / (track.range[1] - track.range[0])),
      )
      if (track.type === 'translate') {
        cameraNear(
          current.position,
          initial.position.map((v, i) => v + track.offset[i] * local),
        )
      } else {
        const dot = Math.abs(
          current.quaternion.reduce((sum, v, i) => sum + v * initial.quaternion[i], 0),
        )
        const angle = 2 * Math.acos(Math.min(1, dot))
        expect(angle).toBeCloseTo(Math.abs(track.angle) * local, 6)
      }
    }
  }
  const capture = async (name) => {
    await page.screenshot({ path: `${output}/${name}.png` })
    report.captures.push(name)
  }
  const openActions = async () => {
    const trigger = page.getByRole('button', { name: '结构与动作', exact: true })
    // A leaving panel is still visible during GSAP's transition. Its visibility
    // cannot decide whether the store considers it open.
    if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click()
    await expect(trigger).toHaveAttribute('aria-expanded', 'true')
    await expect(controls()).toBeVisible()
  }
  const choose = async (slug, wait = true) => {
    const item = catalog.find((entry) => entry.slug === slug)
    await page.getByRole('button', { name: '商品目录', exact: true }).click()
    await page
      .locator('.wb-catalog-list')
      .getByRole('button', { name: new RegExp(item.name) })
      .click()
    if (wait) await ready(slug)
  }
  const rememberHost = () =>
    page.evaluate(() => {
      window.__carCanvas = document.querySelector('canvas')
      window.__carRenderer = window.__carScene.renderer.instance
    })

  const query = new URLSearchParams({ product: 'reventon', renderPipeline: pipeline })
  if (pipeline === 'realtime') query.set('indirectLighting', indirectLighting)
  if (assetLoading === 'streaming') query.set('assetLoading', 'streaming')
  if (assetVariant === 'runtime-v2') query.set('reventonAsset', 'runtime-v2')
  const navigationStarted = Date.now()
  await page.goto(base + '/?' + query, { waitUntil: 'domcontentloaded', timeout: 90000 })
  await ready('reventon')
  report.initialLoading = {
    firstInteractiveReadyObservedMs: Date.now() - navigationStarted,
    method:
      'One fresh browser context; observed DOM ready after the real raster and read-only scene bridge. Not screen presentation timing or five-run loading acceptance. OS and driver caches were not cleared. Network durations overlap and do not isolate hashing, decoding, upload or compilation.',
    resources: await page.evaluate(() =>
      performance
        .getEntriesByType('resource')
        .filter((entry) => entry.name.includes('/models/reventon/'))
        .map((entry) => ({
          name: entry.name,
          startTimeMs: entry.startTime,
          responseEndMs: entry.responseEnd,
          durationMs: entry.duration,
          transferBytes: entry.transferSize,
          encodedBodyBytes: entry.encodedBodySize,
        })),
    ),
  }
  console.log('Reventon actual GLB first frame ready')
  await rememberHost()
  const initial = await saved('initial')
  expect(initial.source).toBe('glb')
  expect(initial.adapter).toBe('reventon-v1')
  expect(initial.bundleVersion).toBe(selectedBundle.version)
  expect(initial.bundleSha256).toBe(selectedBundle.sha256)
  if (assetVariant === 'runtime-v2') {
    expect(initial.modelTextures.length).toBeGreaterThan(0)
    for (const image of initial.modelTextures) {
      expect(image.width).toBeLessThanOrEqual(4096)
      expect(image.height).toBeLessThanOrEqual(4096)
    }
    expect(report.requests.some((url) => url.includes('texture-32c687a38bb17750f1ae.png'))).toBe(
      false,
    )
    report.checks.push(
      'The real candidate bundle is active; all loaded model textures are at most 4K and the original 8K AO is never requested',
    )
  }
  expect(initial.rendererBackend).toBe(pipeline === 'realtime' ? 'webgpu' : 'webgl')
  expect(initial.output).toEqual({ width: 1440, height: 1000 })
  if (pipeline === 'realtime') {
    expect(initial.lighting?.productProfile).toBe('reventon-v1')
    expect(initial.lighting?.signals).toEqual({ ssr: true, ssgi: true, denoise: true })
    if (indirectLighting === 'ddgi') {
      await page.waitForFunction(
        () => {
          const status = window.__carLighting.snapshot()
          return (
            status.error ||
            status.indirectLighting.error ||
            status.indirectLighting.actual === 'ddgi'
          )
        },
        null,
        { timeout },
      )
      const enhanced = await state()
      expect(enhanced.lighting.error).toBeNull()
      expect(enhanced.lighting.indirectLighting.error).toBeNull()
      expect(enhanced.lighting.indirectLighting.actual).toBe('ddgi')
      await expect
        .poll(async () => (await state()).lighting.frames, { timeout: 60000 })
        .toBeGreaterThan(enhanced.lighting.frames)
      report.fullLightingReadyObservedMs = Date.now() - navigationStarted
      await saved('lighting-ready')
      report.checks.push(
        'Car DDGI becomes active and completes a subsequent real raster; SSGI fallback is not counted as enhancement success',
      )
    }
  }
  expect(initial.triangles).toBe(1500363)
  expect(initial.sourceObjects).toBe(2998)
  expect(Object.keys(initial.motionNodes).sort()).toEqual([
    'door_-1',
    'door_1',
    'rear_cover_assembly',
    'wheel_-1_-1',
    'wheel_-1_1',
    'wheel_1_-1',
    'wheel_1_1',
  ])
  await stable()
  expect((await state()).motionNodes).toEqual(initial.motionNodes)
  await capture('whole-1440')
  report.checks.push(
    'Real API serves the complete GLB: 1,500,363 triangles, 2,998 source objects, seven authored motion groups; no automatic director playback',
  )

  await openActions()
  await expect(controls().locator('input[type=range]')).toHaveCount(0)
  await expect(controls().locator('[data-motion-id]')).toHaveCount(2)
  await start(doors)
  await page.waitForTimeout(120)
  await control(doors.id).locator('.wb-car-pause').click()
  const paused = await saved('doors-paused')
  expect(paused.motion[doors.id].progress).toBeGreaterThan(0)
  expect(paused.motion[doors.id].progress).toBeLessThan(1)
  await stable()
  cameraNear(paused.camera, initial.camera)
  await control(doors.id).locator('.wb-car-pause').click()
  const opened = await settled(doors.id, 1)
  assertTracks(opened, initial, doors, 1)
  cameraNear(opened.camera, initial.camera)
  await saved('doors-open')
  await capture('doors-1440')
  await play(doors, 0)
  poseNear((await state()).motionNodes, initial.motionNodes)
  report.checks.push(
    'Named door controls pause/resume/reverse actual hinge transforms, restore exactly, and never move the camera; no visitor slider',
  )

  const forward = await seek(parts.id, 0.437)
  assertTracks(forward, initial, parts, 0.437)
  await seek(parts.id, 1)
  const backward = await seek(parts.id, 0.437)
  poseNear(forward.motionNodes, backward.motionNodes)
  await play(doors, 1)
  const combined = await saved('combined-middle')
  assertTracks(combined, initial, parts, 0.437)
  assertTracks(combined, initial, doors, 1)
  cameraNear(combined.camera, initial.camera)
  await play(parts, 1)
  const separated = await saved('separated')
  assertTracks(separated, initial, parts, 1)
  assertTracks(separated, initial, doors, 1)
  await capture('separated-panel-1440')
  report.checks.push(
    'Same registered progress core supports deterministic forward/reverse seek and rotation + seven-group translation composition from baseline poses',
  )

  await expect(page.locator('.wb-callouts')).toHaveAttribute('data-expanded', 'true')
  await expect
    .poll(() => page.locator('.wb-hotspot[data-layout-visible=true]').count())
    .toBeGreaterThan(0)
  await page.waitForTimeout(600)
  const anchors = await page.evaluate((hotspots) => {
    const camera = window.__carScene.camera.activeCamera.value
    const root = window.__carScene.scene.value.children.find(
      (node) => node.userData.workbenchProduct,
    )
    const canvas = document.querySelector('canvas')
    return hotspots.flatMap((hotspot) => {
      const button = [...document.querySelectorAll('.wb-hotspot')].find(
        (el) => el.dataset.part === hotspot.id,
      )
      if (button?.dataset.layoutVisible !== 'true') return []
      const node = root.getObjectByName(hotspot.node)
      if (!node) throw new Error('Missing actual hotspot node ' + hotspot.node)
      const world = node.localToWorld(
        camera.position.clone().fromArray(hotspot.anchor ?? [0, 0, 0]),
      )
      const screen = world.clone().project(camera)
      const line = [...document.querySelectorAll('.wb-callout-lines path')].find(
        (el) => el.dataset.part === hotspot.id,
      )
      const coordinates = line?.getAttribute('d')?.match(/[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/gi)
      if (!coordinates?.length) throw new Error('Missing leader for visible hotspot ' + hotspot.id)
      const expected = [
        (screen.x * 0.5 + 0.5) * canvas.clientWidth,
        (-screen.y * 0.5 + 0.5) * canvas.clientHeight,
      ]
      const actual = coordinates.slice(0, 2).map(Number)
      return [
        {
          id: hotspot.id,
          node: hotspot.node,
          world: world.toArray(),
          expected,
          actual,
          error: Math.max(...actual.map((v, i) => Math.abs(v - expected[i]))),
        },
      ]
    })
  }, p.hotspots)
  expect(anchors.length).toBeGreaterThan(0)
  for (const anchor of anchors) expect(anchor.error).toBeLessThanOrEqual(1)
  report.anchors.push(...anchors)
  const movingAnchor = anchors.find((anchor) =>
    parts.motion.tracks.some((track) => track.node === anchor.node),
  )
  expect(movingAnchor, 'A visible annotation must belong to a real moving component').toBeDefined()
  const chosenHotspot = p.hotspots.find((hotspot) => hotspot.id === movingAnchor.id)
  await page.locator(`.wb-hotspot[data-part="${chosenHotspot.id}"]`).click()
  await expect(page.locator('.wb-part-copy h3')).toHaveText(chosenHotspot.name)
  const readFocus = () =>
    page.evaluate((hotspot) => {
      const root = window.__carScene.scene.value.children.find(
        (node) => node.userData.workbenchProduct,
      )
      const camera = window.__carScene.camera.activeCamera.value
      const node = root.getObjectByName(hotspot.node)
      const world = node.localToWorld(
        camera.position.clone().fromArray(hotspot.anchor ?? [0, 0, 0]),
      )
      return {
        actual: camera.position.toArray(),
        expected: world.toArray().map((v, i) => v + hotspot.cameraOffset[i]),
      }
    }, chosenHotspot)
  // Wait for the actual camera result. A wall-time sleep can sample halfway
  // through a valid tween when a heavy GPU preparation frame delayed its clock.
  await expect
    .poll(
      async () => {
        const value = await readFocus()
        report.focus = value
        return Math.max(...value.actual.map((v, i) => Math.abs(v - value.expected[i])))
      },
      { timeout: 15000 },
    )
    .toBeLessThan(1e-6)
  const focusCheck = await readFocus()
  cameraNear(focusCheck.actual, focusCheck.expected)
  report.checks.push(
    'Expanded thin leader anchors match actual transformed node world positions within one pixel; selecting a label focuses the current pose',
  )

  await openActions()
  const beforeViewReset = await state()
  await page.getByRole('button', { name: '复位视角', exact: true }).click()
  await expect
    .poll(
      async () => {
        const value = await state()
        return Math.max(...value.camera.map((v, i) => Math.abs(v - initial.camera[i])))
      },
      { timeout: 15000 },
    )
    .toBeLessThan(1e-6)
  poseNear((await state()).motionNodes, beforeViewReset.motionNodes)
  cameraNear((await state()).camera, initial.camera)
  await controls().getByRole('button', { name: '复原动作', exact: true }).click()
  poseNear((await state()).motionNodes, initial.motionNodes)
  cameraNear((await state()).camera, initial.camera)
  await play(doors, 1)
  await page.getByLabel('观察视角', { exact: true }).selectOption('car-cabin')
  await page.waitForTimeout(750)
  assertTracks(await state(), initial, doors, 1)
  await capture('cabin-1440')
  const cabin = await state()
  expect(cabin.camera).not.toEqual(initial.camera)
  await controls().getByRole('button', { name: '复原动作', exact: true }).click()
  cameraNear((await state()).camera, cabin.camera)
  poseNear((await state()).motionNodes, initial.motionNodes)
  report.checks.push(
    'Reset view changes only the camera; action restore resets both motion channels while retaining the current camera; explicit cabin framing preserves open doors',
  )

  await page.getByRole('button', { name: '还原商品', exact: true }).click()
  await page.waitForTimeout(750)
  for (const input of ['wheel', 'drag', 'keyboard', 'view', 'focus']) {
    await openActions()
    await start(parts)
    if (input === 'wheel' || input === 'drag') {
      const point = await page.evaluate(() => {
        const canvas = document.querySelector('canvas'),
          bounds = canvas.getBoundingClientRect()
        for (const y of [0.2, 0.35, 0.5])
          for (const x of [0.7, 0.85, 0.5]) {
            const px = bounds.x + bounds.width * x,
              py = bounds.y + bounds.height * y
            if (document.elementFromPoint(px, py) === canvas) return { x: px, y: py }
          }
        throw new Error('No unobscured real Canvas input point')
      })
      await page.mouse.move(point.x, point.y)
      if (input === 'wheel') await page.mouse.wheel(0, 100)
      else {
        await page.mouse.down()
        await page.mouse.move(point.x - 90, point.y + 35, {
          steps: 5,
        })
        await page.mouse.up()
      }
    } else if (input === 'keyboard') {
      await page.getByRole('group', { name: '商品展示区', exact: true }).focus()
      await page.keyboard.press('ArrowLeft')
    } else if (input === 'view')
      await page.getByLabel('观察视角', { exact: true }).selectOption('perspective')
    else {
      await page.getByRole('button', { name: '细节', exact: true }).click()
      await page.locator('.wb-part-list button').first().click()
    }
    const held = await stable()
    report.states['takeover-' + input] = { motion: held.motion, motionNodes: held.motionNodes }
    expect(held.motion[parts.id].progress).toBeGreaterThan(0)
    expect(held.motion[parts.id].progress).toBeLessThan(1)
  }
  report.checks.push(
    'Real wheel, drag, keyboard, named view and part selection pause structural progress at its current pose; no automatic resume',
  )

  await openActions()
  await start(parts)
  await page.waitForTimeout(150)
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  const hidden = await stable()
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  poseNear((await stable()).motionNodes, hidden.motionNodes)
  report.states.hidden = { motion: hidden.motion, motionNodes: hidden.motionNodes }
  report.checks.push(
    'Synthetic visibilitychange exercises the real hidden-page subscriber; returning to visible retains a paused checkpoint',
  )

  await page.getByRole('button', { name: '收起面板', exact: true }).click()
  await expect(controls()).toBeHidden()
  poseNear((await state()).motionNodes, hidden.motionNodes)
  await openActions()
  poseNear((await state()).motionNodes, hidden.motionNodes)
  report.checks.push('Closing and reopening the action panel keeps the paused structural pose')

  await controls().getByRole('button', { name: '复原动作', exact: true }).click()
  await page.getByRole('button', { name: '导览', exact: true }).click()
  await page.getByRole('button', { name: '开始导览', exact: true }).click()
  for (let index = 0; index < p.guide.length; index++) {
    await expect(page.locator('.wb-guide-count')).toHaveText(`${index + 1} / ${p.guide.length}`)
    const step = p.guide[index]
    if (step.progress) await settled(step.progress.actionId, step.progress.value)
    if (step.actionId) await settled(step.actionId, 1)
    if (step.explode != null) await settled(parts.id, step.explode ? 1 : 0)
    if (step.overview) {
      await settled(doors.id, 0)
      await settled(parts.id, 0)
    }
    if (index < p.guide.length - 1)
      await page.getByRole('button', { name: '下一步', exact: true }).click()
  }
  await page.getByRole('button', { name: '完成导览', exact: true }).click()
  await page.getByRole('button', { name: '开始导览', exact: true }).click()
  await page.getByRole('group', { name: '商品展示区', exact: true }).focus()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('button', { name: '开始导览', exact: true })).toBeVisible()
  report.checks.push(
    'Real configured guide checkpoints are reachable; keyboard observation immediately leaves guide control',
  )

  await page.emulateMedia({ reducedMotion: 'reduce' })
  await openActions()
  await play(doors, 1)
  await play(parts, 1)
  assertTracks(await state(), initial, doors, 1)
  assertTracks(await state(), initial, parts, 1)
  await controls().getByRole('button', { name: '复原动作', exact: true }).click()
  poseNear((await state()).motionNodes, initial.motionNodes)
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  report.checks.push(
    'Reduced-motion operations reach actual endpoints without disabling manual observation or reset',
  )

  if (lifecycle) {
    phase = 'device-recovery'
    await openActions()
    await seek(doors.id, 0.61)
    await seek(parts.id, 0.437)
    const beforeLoss = await saved('before-context-loss')
    if (pipeline === 'realtime') {
      destroyingDevice = true
      await page.evaluate(() => {
        const device = window.__carRenderer.backend?.device
        if (!device?.destroy) throw new Error('Actual WebGPU device unavailable')
        window.__carDeviceLoss = { reason: null, maxCanvases: 1 }
        const observer = new MutationObserver(() => {
          window.__carDeviceLoss.maxCanvases = Math.max(
            window.__carDeviceLoss.maxCanvases,
            document.querySelectorAll('canvas').length,
          )
        })
        observer.observe(document.querySelector('#app'), { subtree: true, childList: true })
        window.__carDeviceLoss.observer = observer
        void device.lost.then((value) => {
          window.__carDeviceLoss.reason = value.reason
        })
        device.destroy()
      })
      await page.waitForFunction(() => window.__carDeviceLoss.reason !== null)
      await page.waitForFunction(() => document.querySelector('canvas') !== window.__carCanvas)
    } else {
      await page.evaluate(() => {
        window.__carLoss = window.__carRenderer.getContext().getExtension('WEBGL_lose_context')
        if (!window.__carLoss) throw new Error('Actual context-loss extension unavailable')
        window.__carLoss.loseContext()
      })
      await expect(page.locator('.workbench')).toHaveAttribute('data-status', 'error')
      await page.waitForTimeout(250)
      await page.evaluate(() => window.__carLoss.restoreContext())
    }
    await ready('reventon')
    const recovered = await stable()
    poseNear(recovered.motionNodes, beforeLoss.motionNodes)
    expect(recovered.motion).toEqual(beforeLoss.motion)
    if (pipeline === 'realtime') {
      expect(recovered.sameCanvas || recovered.sameRenderer).toBe(false)
      expect(recovered.rendererBackend).toBe('webgpu')
      const loss = await page.evaluate(() => {
        const value = window.__carDeviceLoss
        value.observer.disconnect()
        return { reason: value.reason, maxCanvases: value.maxCanvases }
      })
      expect(loss.reason).toBe('destroyed')
      expect(loss.maxCanvases).toBeLessThanOrEqual(1)
      report.deviceRecovery = loss
      destroyingDevice = false
      await rememberHost()
    } else expect(recovered.sameCanvas && recovered.sameRenderer).toBe(true)
    report.checks.push(
      pipeline === 'realtime'
        ? 'Actual GPUDevice.destroy rebuilds the retired host without concurrent Canvases and restores both car progress channels paused'
        : 'Real WebGL context loss/recovery retains both progress channels paused on the same Canvas and renderer',
    )

    let previousBackend = recovered.rendererBackend
    for (const slug of ['typewriter-study', 'piano-cfx']) {
      phase = 'switch-to-' + slug
      await choose(slug)
      const value = await state()
      const expectedBackend =
        pipeline === 'realtime' && slug === 'typewriter-study' ? 'webgpu' : 'webgl'
      expect(value.rendererBackend).toBe(expectedBackend)
      expect(value.sameCanvas).toBe(previousBackend === expectedBackend)
      expect(value.sameRenderer).toBe(previousBackend === expectedBackend)
      expect(value.adapter).toBe(slug === 'piano-cfx' ? 'piano-v1' : 'typewriter-v1')
      expect(Object.keys(value.motionNodes)).toHaveLength(0)
      report.memory.push({ slug, ...value.memory })
      previousBackend = expectedBackend
      await rememberHost()
    }
    let started, finished
    const pending = new Promise((resolve) => {
      started = resolve
    })
    const completed = new Promise((resolve) => {
      finished = resolve
    })
    await page.route('**/api/v1/products/reventon', async (route) => {
      started()
      try {
        const response = await route.fetch()
        await new Promise((resolve) => setTimeout(resolve, 1200))
        await route.fulfill({ response }).catch(() => {})
      } finally {
        finished()
      }
    })
    phase = 'late-response-car'
    await choose('reventon', false)
    await pending
    phase = 'late-response-typewriter'
    await choose('typewriter-study')
    await completed
    await page.waitForTimeout(250)
    await ready('typewriter-study')
    await page.unroute('**/api/v1/products/reventon')
    await rememberHost()
    report.checks.push(
      'Compatible backends reuse their host; crossing to piano replaces it after teardown; a real delayed car response cannot replace the newer typewriter selection',
    )

    injectingFault = true
    phase = 'manifest-failure'
    await page.route('**' + selectedBundle.manifest, (route) => route.abort('failed'))
    await choose('reventon', false)
    await expect(page.locator('.workbench')).toHaveAttribute('data-status', 'error', {
      timeout: 30000,
    })
    await expect(page.getByRole('button', { name: '重新加载', exact: true })).toBeVisible()
    expect(
      await page.evaluate(
        () =>
          window.__carScene.scene.value.children.filter((node) => node.userData.workbenchProduct)
            .length,
      ),
    ).toBe(0)
    await page.unroute('**' + selectedBundle.manifest)
    phase = 'manifest-retry'
    await page.getByRole('button', { name: '重新加载', exact: true }).click()
    await ready('reventon')
    injectingFault = false
    const retried = await saved('retry')
    poseNear(retried.motionNodes, initial.motionNodes)
    expect(retried.sameCanvas && retried.sameRenderer).toBe(true)
    report.memory.push({ slug: 'reventon', ...retried.memory })
    report.checks.push(
      'Actual manifest network failure clears the old model; explicit retry restores the full car at baseline; heavy car resources are only reloaded for recovery and final return',
    )
  } else
    report.lifecycleDeferred =
      'Set REVENTON_LIFECYCLE=1 for context recovery and three-case late-response / asset-failure retry; default run loads the 1.7GB car only once.'

  const final = await state()
  expect(final.sameCanvas && final.sameRenderer).toBe(true)
  expect(
    report.requests
      .filter((url) => /^https?:/.test(url))
      .every((url) => new URL(url).origin === new URL(base).origin),
  ).toBe(true)
  expect(report.requests.some((url) => url === new URL(selectedBundle.manifest, base).href)).toBe(
    true,
  )
  expect(report.requests.some((url) => /\.glb$/.test(url))).toBe(true)
  expect(report.errors).toEqual([])
  report.checks.push(
    'All requests stay same-origin; no unexpected browser errors; compatible operations reuse one host and required device/backend replacements tear it down first',
  )
  report.passed = true
} catch (error) {
  report.failure = String(error)
  if (page) {
    report.failurePage = await page
      .evaluate(() => ({
        status: document.querySelector('.workbench')?.dataset.status,
        slug: document.querySelector('.workbench')?.dataset.slug,
        text: document.body.innerText,
        canvases: document.querySelectorAll('canvas').length,
      }))
      .catch((cause) => ({ unavailable: String(cause) }))
    await page.screenshot({ path: output + '/failure.png', timeout: 5000 }).catch(() => {})
  }
  throw error
} finally {
  if (process.env.REVENTON_COPY_DIAGNOSTICS === '1' && page)
    report.copyFaults = await page.evaluate(() => window.__carCopyFaults ?? []).catch(() => [])
  await browser.close()
  await writeFile(output + '/report.json', JSON.stringify(report, null, 2) + '\n')
}
console.log(
  JSON.stringify({
    passed: report.passed,
    lifecycle,
    checks: report.checks,
    errors: report.errors,
  }),
)
