/* global fetch, URL, requestAnimationFrame, AbortSignal */
import { chromium, expect } from '@playwright/test'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { bridge } from './demo/browser-check.mjs'

const base = process.env.CHECK_URL || 'http://127.0.0.1:5181'
const origin = new URL(base).origin
const output = 'artifacts/amber-lounge/runtime'
const viewport = { width: 1440, height: 1000 }
const panoramaPath = '/studio/amber-lounge/v1/lounge-panorama.png'
const injectedRequests = new WeakSet()
const url = new URL('/?product=typewriter-study&renderPipeline=realtime&studioMood=dark', base)
const report = {
  passed: false,
  fixture: false,
  viewport,
  checks: [],
  captures: [],
  layouts: [],
  errors: [],
  failedRequests: [],
  expectedFailures: [],
  requests: [],
  pending: ['Owner visual review', 'Actual GPU/presentation budget', '20-minute joint acceptance'],
  method:
    'Actual Edge WebGPU and real typewriter API. Existing disposable Vue bridge reads scene identity and issues ordinary store intents. Only one panorama request is fulfilled with HTTP 503; no API/model fixture, alternate renderer, GPU readback or benchmark is installed. Mobile images test resizing the same host, not fresh mobile backend selection.',
}
await mkdir(output, { recursive: true })
let browser,
  page,
  action,
  pulse,
  manifest,
  expectedFailureActive = false

async function waitReady(environment = 'ready') {
  await page.waitForFunction(
    () =>
      ['ready', 'error', 'content'].includes(document.querySelector('.workbench')?.dataset.status),
    null,
    { timeout: 240000 },
  )
  const status = await page.locator('.workbench').getAttribute('data-status')
  if (status !== 'ready')
    throw new Error(`Real model ${status}: ${await page.locator('.wb-stage').innerText()}`)
  await expect(page.locator('.workbench')).toHaveAttribute('data-slug', 'typewriter-study')
  await expect(page.locator('canvas')).toHaveCount(1)
  await expect(page.locator('.wb-stage')).toHaveAttribute('data-render-backend', 'webgpu')
  await page.waitForFunction(
    () => ['ready', 'error'].includes(document.querySelector('.wb-stage')?.dataset.lightingPhase),
    null,
    { timeout: 120000 },
  )
  if ((await page.locator('.wb-stage').getAttribute('data-lighting-phase')) !== 'ready')
    throw new Error(`Real lighting failed: ${await page.locator('.wb-stage').innerText()}`)
  await page.waitForFunction(
    () =>
      ['ready', 'error'].includes(document.querySelector('.wb-stage')?.dataset.studioEnvironment),
    null,
    { timeout: 60000 },
  )
  const phase = await page.locator('.wb-stage').getAttribute('data-studio-environment')
  if (phase !== environment)
    throw new Error(
      `Environment ${phase}, expected ${environment}: ${await page.locator('.wb-stage').innerText()}`,
    )
  await bridge(page, true)
  await page.evaluate(() => {
    const seen = new Set()
    const visit = (vnode) => {
      if (!vnode || typeof vnode !== 'object' || seen.has(vnode)) return
      seen.add(vnode)
      const current = vnode.component
      const exposed = current?.exposed?.realLighting
      const value = exposed?.value ?? exposed
      if (value?.snapshot && value?.setSignals) return value
      const nested = visit(current?.subTree)
      if (nested) return nested
      for (const child of Array.isArray(vnode.children) ? vnode.children : []) {
        const found = visit(child)
        if (found) return found
      }
      return visit(vnode.suspense?.activeBranch)
    }
    window.__amberLighting = visit(document.querySelector('#app')._vnode)
    window.__amberRoot = window.__demo.scene.scene.value.children.find(
      (node) => node.userData.workbenchProduct,
    )
    if (!window.__amberLighting || !window.__amberRoot)
      throw new Error('Actual scene/coordinator unavailable')
  })
}

async function settle(transition = false) {
  if (transition) await page.waitForTimeout(650)
  const initial = await page.evaluate(() => window.__amberLighting.snapshot())
  if (!initial) throw new Error('Actual coordinator snapshot unavailable')
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const state = window.__amberLighting.snapshot()
          if (!state || state.error || state.phase === 'error')
            throw new Error(state?.error || 'Lighting unavailable')
          return state.frames
        }),
      { timeout: 60000 },
    )
    .toBeGreaterThan(initial.frames + 3)
}

const snapshot = () =>
  page.evaluate(() => {
    const test = window.__demo
    const renderer = test.scene.renderer.instance
    const scene = test.scene.scene.value
    const roots = scene.children.filter((node) => node.userData.workbenchProduct)
    const root = roots[0]
    const studio = scene.children.find((node) => node.userData.studio && !node.userData.capture)
    const pedestal = studio?.getObjectByName('Trees X / studio pedestal')
    const sky = studio?.getObjectByName('Trees X / studio skybox')
    const camera = test.scene.camera.activeCamera.value
    const poses = [],
      geometry = new Set(),
      materials = new Map(),
      textureRecords = new Map()
    let parts = 0
    const recordTexture = (texture) => {
      const info = texture?.userData?.loungeAsset
      if (!info) return
      textureRecords.set(info.file, {
        ...info,
        uuid: texture.uuid,
        width: texture.image?.width,
        height: texture.image?.height,
        colorSpace: texture.colorSpace,
        flipY: texture.flipY,
        repeat: texture.repeat.toArray(),
      })
    }
    sky?.material?.colorNode?.traverse((node) => recordTexture(node.value))
    for (const slot of ['map', 'roughnessMap', 'normalMap'])
      recordTexture(pedestal?.material?.[slot])
    root?.traverse((node) => {
      if (node.geometry) geometry.add(node.geometry.uuid)
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
        : [])
        materials.set(material.uuid, [
          material.uuid,
          material.name,
          material.color?.getHexString(),
          material.roughness,
          material.metalness,
        ])
    })
    return {
      slug: root?.userData.workbenchProduct,
      root: root?.uuid,
      sameRoot: root === window.__amberRoot,
      roots: roots.length,
      parts,
      sameCanvas: document.querySelector('canvas') === test.canvas,
      sameRenderer: renderer === test.renderer,
      nativeWebgpu: renderer.backend?.isWebGPUBackend === true,
      canvas: { width: renderer.domElement.width, height: renderer.domElement.height },
      geometry: [...geometry].sort(),
      camera: [
        ...camera.position.toArray(),
        ...camera.quaternion.toArray(),
        ...camera.projectionMatrix.elements,
        ...camera.projectionMatrixInverse.elements,
      ],
      finish: test.store.finishId,
      finishMaterials: [...materials.values()].sort((a, b) => a[0].localeCompare(b[0])),
      poses,
      motion: Object.fromEntries(
        Object.entries(test.motion.snapshot()).map(([id, value]) => [
          id,
          { progress: value.progress, target: value.target, playing: value.playing },
        ]),
      ),
      actions: { ...test.store.actions },
      studio: { mood: studio?.userData.studioMood, lounge: studio?.userData.lounge },
      textures: [...textureRecords.values()].sort((a, b) => a.file.localeCompare(b.file)),
      lights: scene.children
        .filter((node) => node.isRectAreaLight)
        .map((light) => [light.name, light.color.getHexString(), light.intensity]),
    }
  })

function assertIdentity(state) {
  expect(state).toMatchObject({
    slug: 'typewriter-study',
    roots: 1,
    parts: 572,
    sameRoot: true,
    sameCanvas: true,
    sameRenderer: true,
    nativeWebgpu: true,
  })
  expect(state.geometry.length).toBeGreaterThan(0)
}

function assertTextures(state) {
  expect(state.studio.lounge.status).toBe('ready')
  expect(state.textures).toHaveLength(4)
  for (const file of manifest.files) {
    const texture = state.textures.find((entry) => entry.file === file.file)
    expect(texture, file.file).toMatchObject({
      packId: manifest.id,
      sha256: file.sha256,
      bytes: file.bytes,
      width: file.width,
      height: file.height,
      colorSpace: file.colorSpace === 'SRGBColorSpace' ? 'srgb' : '',
      flipY: false,
    })
  }
}

function unchanged(before, after, label) {
  assertIdentity(after)
  for (const key of ['root', 'geometry', 'finish', 'finishMaterials', 'poses', 'motion', 'actions'])
    expect(after[key], `${label}: ${key}`).toEqual(before[key])
  const cameraError = Math.max(
    ...after.camera.map((value, index) => Math.abs(value - before.camera[index])),
  )
  expect(cameraError, `${label}: camera pose/projection`).toBeLessThanOrEqual(1e-6)
  report.checks.push({
    label,
    cameraError,
    root: after.root,
    geometryCount: after.geometry.length,
    motion: after.motion,
  })
}

async function changeMood(mood) {
  await page
    .getByRole('button', { name: mood === 'light' ? '切换明亮环境' : '切换暖夜环境', exact: true })
    .click()
  await expect(page.locator('.wb-stage')).toHaveAttribute('data-studio-mood', mood)
  await settle(true)
  await expect(
    page.getByRole('button', {
      name: mood === 'light' ? '切换明亮环境' : '切换暖夜环境',
      exact: true,
    }),
  ).toHaveAttribute('aria-pressed', 'true')
}

async function capture(file) {
  await page.mouse.move(1, 1)
  await page.screenshot({ path: `${output}/${file}` })
  report.captures.push(file)
  console.log(`[amber lounge] captured ${file}`)
}

async function pose(progress, view) {
  await page.evaluate(
    ({ id, progress, view }) => {
      window.__demo.store.panel = null
      window.__demo.store.motion('seek', id, progress)
      window.__demo.store.view(view)
    },
    { id: action.id, progress, view },
  )
  await expect
    .poll(() => page.evaluate((id) => window.__demo.motion.snapshot()[id]?.progress, action.id))
    .toBe(progress)
  await page.waitForTimeout(1200)
  await settle()
}

try {
  const response = await fetch(new URL('/api/v1/products/typewriter-study', base), {
    signal: AbortSignal.timeout(60000),
  })
  if (!response.ok) throw new Error(`Real typewriter API unavailable: ${response.status}`)
  const product = await response.json()
  if (product.slug !== 'typewriter-study' || product.presentation.source?.kind !== 'glb')
    throw new Error('Real typewriter GLB configuration unavailable')
  action = product.presentation.actions.find((entry) => entry.motion?.program)
  pulse = product.presentation.actions.find((entry) => entry.kind === 'pulse')
  if (!action || !pulse)
    throw new Error('Real typewriter structure/strike configuration unavailable')
  manifest = JSON.parse(await readFile('public/studio/amber-lounge/v1/manifest.json', 'utf8'))
  browser = await chromium.launch({ channel: 'msedge', headless: true })
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 })
  page = await context.newPage()
  page.setDefaultTimeout(30000)
  page.on('pageerror', (error) => report.errors.push({ kind: 'pageerror', message: error.message }))
  page.on('console', (message) => {
    if (message.type() !== 'error') return
    const location = message.location().url
    if (
      expectedFailureActive &&
      /503/.test(message.text()) &&
      location &&
      new URL(location).pathname === panoramaPath
    )
      report.expectedFailures.push({ kind: 'console', url: location, message: message.text() })
    else report.errors.push({ kind: 'console', url: location, message: message.text() })
  })
  page.on('request', (request) => {
    if (/^https?:/.test(request.url())) report.requests.push(request.url())
  })
  page.on('requestfailed', (request) => {
    const failure = { url: request.url(), reason: request.failure()?.errorText }
    if (
      expectedFailureActive &&
      injectedRequests.has(request) &&
      failure.reason === 'net::ERR_ABORTED'
    )
      report.expectedFailures.push({ kind: 'injected-request-cancelled-after-503', ...failure })
    else report.failedRequests.push(failure)
  })
  console.log('[amber lounge] loading actual realtime typewriter')
  await page.goto(url.href, { waitUntil: 'domcontentloaded' })
  await waitReady()
  await settle(true)
  const wholeDark = await snapshot()
  assertIdentity(wholeDark)
  assertTextures(wholeDark)
  expect(wholeDark.studio.mood).toBe('dark')
  await capture('whole-dark.png')
  await changeMood('light')
  const wholeLight = await snapshot()
  unchanged(wholeDark, wholeLight, 'whole dark to light')
  expect(wholeLight.lights).not.toEqual(wholeDark.lights)
  await capture('whole-light.png')
  await changeMood('dark')
  unchanged(wholeDark, await snapshot(), 'whole light to dark')

  const alternateFinish = product.presentation.finishes[1]?.id
  if (alternateFinish) await page.evaluate((id) => window.__demo.store.finish(id), alternateFinish)
  await pose(0.6, 'structure')
  const layersDark = await snapshot()
  expect(layersDark.motion[action.id]).toMatchObject({ progress: 0.6, playing: false })
  assertTextures(layersDark)
  await capture('layers-dark.png')
  await changeMood('light')
  const layersLight = await snapshot()
  unchanged(layersDark, layersLight, 'intermediate structure dark to light')
  await capture('layers-light.png')
  await changeMood('dark')
  unchanged(layersDark, await snapshot(), 'intermediate structure light to dark')
  for (let index = 0; index < 10; index++)
    await page
      .getByRole('button', { name: index % 2 === 0 ? '切换明亮环境' : '切换暖夜环境', exact: true })
      .click()
  await settle(true)
  const rapid = await snapshot()
  unchanged(layersDark, rapid, 'ten rapid toggles preserve camera, finish and intermediate motion')
  expect(rapid.studio.mood).toBe('dark')
  assertTextures(rapid)

  await pose(0, 'perspective')
  const strike = await page.evaluate(
    async ({ id, node }) => {
      const root = window.__amberRoot
      const key = root.getObjectByName(node)
      if (!key) throw new Error('Actual strike node missing')
      const initial = [...key.position.toArray(), ...key.quaternion.toArray()]
      window.__demo.store.action(id)
      for (let frame = 0; frame < 60; frame++) {
        await new Promise((resolve) => requestAnimationFrame(resolve))
        const current = [...key.position.toArray(), ...key.quaternion.toArray()]
        const difference = Math.max(
          ...current.map((value, index) => Math.abs(value - initial[index])),
        )
        if (difference > 1e-6) return { node, initial, current, difference, observed: true }
      }
      throw new Error('Real A-key action produced no observed node movement')
    },
    { id: pulse.id, node: pulse.node },
  )
  report.checks.push({ label: 'actual key strike under warm environment', ...strike })
  await capture('key-action-dark.png')
  await page.waitForTimeout(1000)
  assertIdentity(await snapshot())

  for (const [width, height] of [
    [1280, 720],
    [1440, 1000],
    [1920, 1080],
    [390, 844],
    [320, 740],
  ]) {
    await page.setViewportSize({ width, height })
    await page.waitForTimeout(850)
    await settle()
    const state = await snapshot()
    assertIdentity(state)
    const layout = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth > innerWidth,
      mood: document.querySelector('.wb-stage')?.getAttribute('data-studio-mood'),
      environment: document.querySelector('.wb-stage')?.getAttribute('data-studio-environment'),
      backend: document.querySelector('.wb-stage')?.getAttribute('data-render-backend'),
      canvases: document.querySelectorAll('canvas').length,
    }))
    expect(layout.overflow).toBe(false)
    expect(layout.canvases).toBe(1)
    await capture(`layout-${width}x${height}.png`)
    report.layouts.push({ width, height, ...layout, canvas: state.canvas })
  }

  // Complete peer downloads before the injected 503: cancellation must not hide unrelated network errors.
  await page.setViewportSize(viewport)
  const peers = Promise.all(
    ['stone-basecolor.png', 'stone-roughness.png', 'stone-normal.png'].map(async (file) => {
      const response = await page.waitForResponse(
        (response) => new URL(response.url()).pathname === `/studio/amber-lounge/v1/${file}`,
        { timeout: 60000 },
      )
      if (!response.ok()) throw new Error(`Failure-test peer unexpectedly failed: ${file}`)
      const failure = await response.finished()
      if (failure) throw failure
    }),
  )
  void peers.catch(() => {})
  let injected = false
  await page.route(new URL(panoramaPath, base).href, async (route) => {
    if (injected) return route.continue()
    injected = true
    await peers
    injectedRequests.add(route.request())
    report.expectedFailures.push({
      kind: 'injected-response',
      url: route.request().url(),
      status: 503,
    })
    await route.fulfill({
      status: 503,
      contentType: 'text/plain',
      body: 'Intentional panorama-only failure',
    })
  })
  expectedFailureActive = true
  await page.reload({ waitUntil: 'domcontentloaded' })
  await waitReady('error')
  expect(injected).toBe(true)
  await expect(page.getByRole('button', { name: '环境加载失败，重试', exact: true })).toBeVisible()
  const failed = await snapshot()
  assertIdentity(failed)
  const stage = await page.locator('.wb-stage').boundingBox()
  if (!stage) throw new Error('Actual stage missing during fallback')
  await page.mouse.move(stage.x + stage.width * 0.5, stage.y + stage.height * 0.5)
  await page.mouse.wheel(0, -180)
  await settle(true)
  const operated = await snapshot()
  assertIdentity(operated)
  expect(operated.camera).not.toEqual(failed.camera)
  report.checks.push({
    label: 'panorama failure preserves actual operable model',
    root: operated.root,
    parts: operated.parts,
  })
  await capture('environment-error-operable.png')
  await page.getByRole('button', { name: '环境加载失败，重试', exact: true }).click()
  await expect(page.locator('.wb-stage')).toHaveAttribute('data-studio-environment', 'ready', {
    timeout: 60000,
  })
  await settle(true)
  const retried = await snapshot()
  unchanged(operated, retried, 'environment retry preserves model and current observation')
  assertTextures(retried)
  await capture('environment-retry.png')
  expectedFailureActive = false
  expect(report.errors).toEqual([])
  expect(report.failedRequests).toEqual([])
  expect(report.requests.every((request) => new URL(request).origin === origin)).toBe(true)
  report.initial = wholeDark
  report.final = retried
  report.passed = true
} catch (error) {
  report.errors.push({ kind: 'test', message: error.stack || String(error) })
  process.exitCode = 1
} finally {
  if (page && !page.isClosed() && !report.passed) {
    try {
      await page.screenshot({ path: `${output}/failure.png` })
    } catch {
      /* Context may already be unavailable. */
    }
  }
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2))
  await browser?.close()
  console.log(
    JSON.stringify({
      passed: report.passed,
      fixture: report.fixture,
      checks: report.checks.length,
      output,
    }),
  )
}
