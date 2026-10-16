/* global fetch, URL, AbortSignal, requestAnimationFrame, MutationObserver */
import { chromium, expect } from '@playwright/test'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { bridge } from './demo/browser-check.mjs'

const base = process.env.CHECK_URL || 'http://127.0.0.1:5181'
const origin = new URL(base).origin
const output = process.env.DDGI_RECOVERY_OUTPUT || 'artifacts/realtime-ddgi/recovery'
const scope = process.env.DDGI_RECOVERY_SCOPE || 'all'
if (!['all', 'mood'].includes(scope)) throw new Error('DDGI_RECOVERY_SCOPE must be all or mood')
const asset = process.env.DDGI_RECOVERY_ASSET || 'v2'
if (!['v2', 'paint-study'].includes(asset))
  throw new Error('DDGI_RECOVERY_ASSET must be v2 or paint-study')
const viewport = { width: 1440, height: 1000 }
const url = new URL(
  '/?product=typewriter-study&renderPipeline=realtime&studioMood=light&indirectLighting=ddgi',
  base,
)
url.searchParams.set('typewriterAsset', asset)
const badge = '.wb-lighting-status [data-indirect-lighting]'
const report = {
  passed: false,
  fixture: false,
  visualAccepted: false,
  frameBudgetValidated: false,
  startedAt: new Date().toISOString(),
  viewport,
  scope,
  asset,
  cases: [],
  errors: [],
  pending: [
    'Actual hidden-page pause/resume',
    'Human visual review',
    'GPU and actual presentation budget',
    '20-minute joint acceptance',
  ],
  method: `Real API, actual audited ${asset} GLB selected by the production typewriterAsset query and native Edge WebGPU. The API, database and source bundle are unchanged. GPUDevice.destroy deliberately loses the actual device and must recover through the existing production host. A separate fresh context fulfills only the actual dynamically requested /assets/field-*.js module with HTTP503; APIs/models are never fulfilled or replaced. Native error state and badge title must expose the real failure while baseline SSR/SSGI remains operable. Submission counters are not GPU/presentation timing.`,
}
const difference = (a, b) =>
  a.length === b.length
    ? Math.max(0, ...a.map((value, index) => Math.abs(value - b[index])))
    : Infinity
const fatalCases = new WeakMap()
let browser, product, action, pulse, bundle
await mkdir(output, { recursive: true })

async function attach(page, remember = false) {
  await bridge(page, remember)
  await page.evaluate(() => {
    const seen = new Set()
    const visit = (vnode) => {
      if (!vnode || typeof vnode !== 'object' || seen.has(vnode)) return
      seen.add(vnode)
      const exposed = vnode.component?.exposed?.realLighting,
        value = exposed?.value ?? exposed
      if (value?.snapshot && value?.setSignals) return value
      const nested = visit(vnode.component?.subTree)
      if (nested) return nested
      for (const child of Array.isArray(vnode.children) ? vnode.children : []) {
        const found = visit(child)
        if (found) return found
      }
      return visit(vnode.suspense?.activeBranch)
    }
    window.__ddgiRecoveryLighting = visit(document.querySelector('#app')?._vnode)
    if (!window.__ddgiRecoveryLighting) throw new Error('Actual production coordinator unavailable')
  })
}

const lighting = (page) => page.evaluate(() => window.__ddgiRecoveryLighting.snapshot())

async function ready(page, actual, remember = true) {
  await page.waitForFunction(
    () =>
      ['ready', 'error', 'content'].includes(document.querySelector('.workbench')?.dataset.status),
    null,
    { timeout: 240000 },
  )
  await expect(page.locator('.workbench')).toHaveAttribute('data-status', 'ready')
  await expect(page.locator('.workbench')).toHaveAttribute('data-slug', 'typewriter-study')
  await expect(page.locator('.wb-stage')).toHaveAttribute('data-render-backend', 'webgpu')
  await expect(page.locator('canvas')).toHaveCount(1)
  await attach(page, remember)
  await expect
    .poll(
      async () => {
        const state = await lighting(page)
        if (state.error) throw new Error('Base realtime renderer failed: ' + state.error)
        if (actual === 'ddgi' && state.indirectLighting?.error)
          throw new Error(state.indirectLighting.error)
        return (
          state.phase === 'ready' &&
          state.indirectLighting?.actual === actual &&
          (actual === 'ddgi' || Boolean(state.indirectLighting?.error))
        )
      },
      { timeout: 240000 },
    )
    .toBe(true)
  await expect(page.locator(badge)).toHaveAttribute('data-indirect-lighting', actual, {
    timeout: 15000,
  })
  if (actual === 'ssgi')
    await expect
      .poll(() => page.locator(badge).getAttribute('title'), { timeout: 15000 })
      .toBeTruthy()
  await settle(page, actual)
}

async function settle(page, actual, count = 8) {
  const initial = await lighting(page)
  await expect
    .poll(
      async () => {
        const state = await lighting(page)
        if (state.error) throw new Error(state.error)
        if (state.indirectLighting?.actual !== actual) return -1
        return state.frames
      },
      { timeout: 120000 },
    )
    .toBeGreaterThan(initial.frames + count)
}

const snapshot = (page) =>
  page.evaluate(() => {
    const test = window.__demo,
      scene = test.scene.scene.value,
      renderer = test.scene.renderer.instance,
      roots = scene.children.filter((node) => node.userData.workbenchProduct),
      root = roots[0],
      camera = test.scene.camera.activeCamera.value,
      poses = [],
      instances = []
    root.updateMatrixWorld(true)
    camera.updateMatrixWorld(true)
    root.traverse((node) => {
      if (Number.isInteger(node.userData.partId))
        poses.push([
          node.name,
          ...node.position.toArray(),
          ...node.quaternion.toArray(),
          ...node.scale.toArray(),
          ...node.matrixWorld.toArray(),
        ])
      if (node.isInstancedMesh)
        instances.push([node.name, node.count, ...node.instanceMatrix.array])
    })
    const badge = document.querySelector('.wb-lighting-status [data-indirect-lighting]')
    return {
      root: root.uuid,
      roots: roots.length,
      slug: root.userData.workbenchProduct,
      version: root.userData.bundleVersion,
      bundleSha256: root.userData.bundleSha256,
      parts: poses.length,
      sameCanvas: document.querySelector('canvas') === test.canvas,
      sameRenderer: renderer === test.renderer,
      nativeWebgpu: renderer.backend?.isWebGPUBackend === true,
      canvases: document.querySelectorAll('canvas').length,
      camera: [
        ...camera.position.toArray(),
        ...camera.quaternion.toArray(),
        ...camera.matrixWorld.toArray(),
        ...camera.projectionMatrix.toArray(),
        ...camera.projectionMatrixInverse.toArray(),
      ],
      poses: poses.sort((a, b) => a[0].localeCompare(b[0])),
      instances: instances.sort((a, b) => a[0].localeCompare(b[0])),
      finish: test.store.finishId,
      selectedPart: test.store.selectedPart,
      motion: Object.fromEntries(
        Object.entries(test.motion.snapshot()).map(([id, state]) => [
          id,
          { progress: state.progress, target: state.target, playing: state.playing },
        ]),
      ),
      lighting: window.__ddgiRecoveryLighting.snapshot(),
      badge: {
        actual: badge?.getAttribute('data-indirect-lighting'),
        text: badge?.textContent?.trim(),
        reason: badge?.getAttribute('title'),
      },
    }
  })

function identity(state, actual) {
  expect(state).toMatchObject({
    roots: 1,
    slug: 'typewriter-study',
    version: bundle.version,
    bundleSha256: bundle.sha256,
    parts: 572,
    sameCanvas: true,
    sameRenderer: true,
    nativeWebgpu: true,
    canvases: 1,
  })
  expect(state.lighting).toMatchObject({
    phase: 'ready',
    error: null,
    signals: { ssr: true, ssgi: true, denoise: true },
  })
  expect(state.lighting.indirectLighting).toMatchObject({
    requested: 'ddgi',
    actual,
    preparing: false,
  })
  expect(state.badge.actual).toBe(actual)
  if (actual === 'ddgi') {
    expect(state.lighting.indirectLighting.error).toBeNull()
    expect(state.lighting.indirectLighting.details).toMatchObject({
      ready: true,
      error: null,
      resolution: [16, 9, 10],
      probes: 1440,
      actualRays: 64,
      actualBudgetRays: 98304,
      reflectionQuality: 'off',
    })
  }
}

async function save(page, result, name, state) {
  await page.mouse.move(1, 1)
  await page.screenshot({ path: `${output}/${name}.png` })
  const current = state ?? (await snapshot(page))
  await writeFile(`${output}/${name}.json`, JSON.stringify(current, null, 2) + '\n')
  result.captures.push(name)
  console.log('[DDGI recovery] ' + name)
}

function events(page, result, injected = new Set()) {
  const fail = (record) => {
    result.errors.push(record)
    console.error('[DDGI recovery ' + result.name + '] ' + record.kind + ': ' + record.message)
    fatalCases.get(page)?.(new Error(record.kind + ': ' + record.message))
  }
  page.on('pageerror', (error) => fail({ kind: 'pageerror', message: error.message }))
  page.on('console', (message) => {
    const record = { kind: 'console', message: message.text(), url: message.location().url }
    if (message.type() === 'error') {
      if (injected.has(record.url) && /Failed to load resource.*503/.test(record.message))
        result.expectedFaults.push(record)
      else fail(record)
    } else if (message.type() === 'warning') {
      result.warnings.push(record)
      if (
        /SPEEDBALL.*failed|GPUValidationError|validation.*(?:error|failed)|(?:WGSL|shader|pipeline|binding).*(?:error|invalid|failed)/i.test(
          record.message,
        )
      )
        fail({ ...record, kind: 'gpu-warning' })
    }
  })
  page.on('request', (request) => {
    if (/^https?:/.test(request.url())) result.requests.push(request.url())
  })
  page.on('requestfailed', (request) => {
    const failure = {
      kind: 'requestfailed',
      url: request.url(),
      reason: request.failure()?.errorText,
    }
    if (injected.has(request.url())) result.expectedFaults.push(failure)
    else {
      result.failedRequests.push(failure)
      fail({ kind: 'requestfailed', message: request.url() + ': ' + failure.reason })
    }
  })
  page.on('response', (response) => {
    if (response.status() < 400) return
    const record = { kind: 'http', url: response.url(), status: response.status() }
    if (injected.has(response.url()) && response.status() === 503)
      result.expectedFaults.push(record)
    else fail({ ...record, message: response.url() + ': HTTP ' + response.status() })
  })
}

async function runCase(name, operation) {
  if (scope === 'mood' && name !== 'studio-mood') return
  const result = {
    name,
    passed: false,
    captures: [],
    errors: [],
    warnings: [],
    failedRequests: [],
    expectedFaults: [],
    requests: [],
  }
  report.cases.push(result)
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 }),
    page = await context.newPage()
  page.setDefaultTimeout(30000)
  try {
    const fatal = new Promise((_, reject) => fatalCases.set(page, reject))
    await Promise.race([operation(context, page, result), fatal])
    expect(result.requests.every((request) => new URL(request).origin === origin)).toBe(true)
    expect(result.errors).toEqual([])
    expect(result.failedRequests).toEqual([])
    result.passed = true
  } catch (error) {
    result.errors.push({ kind: 'test', message: error.stack || String(error) })
    process.exitCode = 1
    try {
      result.failedLighting = await lighting(page)
      await page.screenshot({ path: `${output}/${name}-failure.png` })
    } catch {
      /* Actual failed host may be absent. */
    }
  } finally {
    try {
      await page.evaluate(() => window.__nativeDeviceRecovery?.observer?.disconnect())
    } catch {
      /* Host may be absent. */
    }
    await context.close()
    fatalCases.delete(page)
    if (result.errors.length || result.failedRequests.length) result.passed = false
    await writeFile(`${output}/${name}-report.json`, JSON.stringify(result, null, 2) + '\n')
  }
}

try {
  const response = await fetch(new URL('/api/v1/products/typewriter-study', base), {
    signal: AbortSignal.timeout(60000),
  })
  if (!response.ok) throw new Error('Actual typewriter API unavailable: ' + response.status)
  product = await response.json()
  if (product.slug !== 'typewriter-study' || product.presentation.source?.kind !== 'glb')
    throw new Error('Actual GLB presentation unavailable')
  action = product.presentation.actions.find((entry) => entry.motion?.program)
  if (!action) throw new Error('Actual structure program unavailable')
  pulse = product.presentation.actions.find((entry) => entry.kind === 'pulse')
  if (!pulse) throw new Error('Actual strike definition unavailable')
  bundle = JSON.parse(
    await readFile(
      asset === 'paint-study'
        ? 'src/lib/workbench/typewriterPaintBundle.json'
        : 'src/lib/workbench/typewriterV2Bundle.json',
      'utf8',
    ),
  )
  report.bundle = bundle
  report.url = url.href
  browser = await chromium.launch({ channel: 'msedge', headless: true })

  await runCase('studio-mood', async (_context, page, result) => {
    events(page, result)
    await page.goto(url.href, { waitUntil: 'domcontentloaded' })
    await ready(page, 'ddgi')
    const before = await snapshot(page)
    identity(before, 'ddgi')
    const studioGeneration = await page.evaluate(
      () =>
        window.__demo.scene.scene.value.children.find((node) => node.userData.studio === true)
          ?.uuid,
    )
    result.moods = []
    await save(page, result, 'mood-initial-light', before)
    for (const mood of ['dark', 'light', 'dark', 'light']) {
      await page
        .getByRole('button', {
          name: mood === 'dark' ? '切换暖夜环境' : '切换明亮环境',
          exact: true,
        })
        .click()
      await expect(page.locator('.wb-stage')).toHaveAttribute('data-studio-mood', mood)
      if (mood === 'dark')
        await expect
          .poll(
            () =>
              page.evaluate(
                () =>
                  window.__demo.scene.scene.value.children.find(
                    (node) => node.userData.studio === true,
                  )?.userData.lounge?.status,
              ),
            { timeout: 120000 },
          )
          .toBe('ready')
      await page.waitForTimeout(700)
      await settle(page, 'ddgi', 24)
      const after = await snapshot(page)
      identity(after, 'ddgi')
      expect(after.root).toBe(before.root)
      expect(after.poses).toEqual(before.poses)
      expect(after.instances).toEqual(before.instances)
      expect(after.finish).toBe(before.finish)
      expect(after.motion).toEqual(before.motion)
      expect(difference(before.camera, after.camera)).toBeLessThanOrEqual(1e-6)
      expect(
        await page.evaluate(
          () =>
            window.__demo.scene.scene.value.children.find((node) => node.userData.studio === true)
              ?.uuid,
        ),
      ).toBe(studioGeneration)
      const evidence = {
        mood,
        generation: after.lighting.indirectLighting.details.generation,
        kernelRebuilds: after.lighting.indirectLighting.details.state.kernelRebuilds,
        kernelResidentReuses: after.lighting.indirectLighting.details.state.kernelResidentReuses,
        ready: after.lighting.indirectLighting.details.ready,
        actual: after.lighting.indirectLighting.actual,
        error: after.lighting.indirectLighting.error,
        sameCanvas: after.sameCanvas,
        sameRenderer: after.sameRenderer,
      }
      result.moods.push(evidence)
      await save(page, result, `mood-${result.moods.length}-${mood}`, after)
    }
    // Source map binding legitimately caused a rebuild; merely suppressing the
    // failure without completing the new tracing field must not pass.
    // r185/0.8.0 can rebuild tracing inputs in a resident kernel when arena
    // capacities remain sufficient; a shader recompile is not required.
    expect(result.moods[0].kernelRebuilds + result.moods[0].kernelResidentReuses).toBeGreaterThan(
      before.lighting.indirectLighting.details.state.kernelRebuilds +
        before.lighting.indirectLighting.details.state.kernelResidentReuses,
    )
    expect(result.moods[0].generation).toBeGreaterThan(
      before.lighting.indirectLighting.details.generation,
    )
    result.strike = await page.evaluate(
      async ({ id, node }) => {
        const root = window.__demo.scene.scene.value.children.find(
            (entry) => entry.userData.workbenchProduct,
          ),
          key = root?.getObjectByName(node)
        if (!key) throw new Error('Actual strike key missing')
        const initial = [...key.position.toArray(), ...key.quaternion.toArray()]
        window.__demo.store.action(id)
        for (let frame = 0; frame < 120; frame++) {
          await new Promise((resolve) => requestAnimationFrame(resolve))
          const current = [...key.position.toArray(), ...key.quaternion.toArray()],
            delta = Math.max(0, ...current.map((value, index) => Math.abs(value - initial[index])))
          if (delta > 1e-6) return { node, observedRaf: frame, delta }
        }
        throw new Error('Actual strike key did not move')
      },
      { id: pulse.id, node: pulse.node },
    )
    await page.waitForTimeout(1500)
    await settle(page, 'ddgi')
    const afterStrike = await snapshot(page)
    identity(afterStrike, 'ddgi')
    expect(afterStrike.root).toBe(before.root)
    const poseError = difference(
      before.poses.flatMap((entry) => entry.slice(1)),
      afterStrike.poses.flatMap((entry) => entry.slice(1)),
    )
    expect(poseError).toBeLessThanOrEqual(1e-6)
    expect(difference(before.camera, afterStrike.camera)).toBeLessThanOrEqual(1e-6)
    result.strike.restoredPoseError = poseError
    result.strike.completed = true
    await save(page, result, 'mood-strike-restored', afterStrike)
  })

  await runCase('native-device', async (_context, page, result) => {
    events(page, result)
    await page.goto(url.href, { waitUntil: 'domcontentloaded' })
    await ready(page, 'ddgi')
    await page.evaluate(
      ({ id }) => {
        window.__demo.store.panel = null
        window.__demo.store.motion('seek', id, 0.6)
        window.__demo.store.view('structure')
      },
      { id: action.id },
    )
    await expect
      .poll(() => page.evaluate((id) => window.__demo.motion.snapshot()[id]?.progress, action.id))
      .toBe(0.6)
    await page.waitForTimeout(1200)
    await page.evaluate(async () => {
      for (let index = 0; index < 3; index++) {
        window.__demo.store.orbit('horizontal', 1)
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      }
    })
    await settle(page, 'ddgi')
    const before = await snapshot(page)
    identity(before, 'ddgi')
    expect(before.motion[action.id]).toMatchObject({ progress: 0.6, playing: false })
    await save(page, result, 'native-device-before', before)
    await page.evaluate(() => {
      const renderer = window.__demo.scene.renderer.instance,
        device = renderer.backend?.device
      if (!device?.destroy) throw new Error('Actual GPUDevice.destroy is unavailable')
      const state = {
        renderer,
        canvas: document.querySelector('canvas'),
        reason: null,
        maxCanvas: document.querySelectorAll('canvas').length,
        disposeCount: 0,
        oldRoot: window.__demo.scene.scene.value.children.find(
          (node) => node.userData.workbenchProduct,
        ),
      }
      const dispose = renderer.dispose.bind(renderer)
      renderer.dispose = () => {
        state.disposeCount++
        return dispose()
      }
      const observer = new MutationObserver(() => {
        state.maxCanvas = Math.max(state.maxCanvas, document.querySelectorAll('canvas').length)
      })
      observer.observe(document.querySelector('#app'), { subtree: true, childList: true })
      window.__nativeDeviceRecovery = state
      window.__nativeDeviceRecovery.observer = observer
      void device.lost.then((info) => {
        window.__nativeDeviceRecovery.reason = info.reason
      })
      device.destroy()
    })
    await page.waitForFunction(() => window.__nativeDeviceRecovery.reason !== null, null, {
      timeout: 30000,
    })
    await page.waitForFunction(
      () => document.querySelector('canvas') !== window.__nativeDeviceRecovery.canvas,
      null,
      { timeout: 30000 },
    )
    await ready(page, 'ddgi', true)
    const after = await snapshot(page)
    identity(after, 'ddgi')
    const native = await page.evaluate(() => {
      const state = window.__nativeDeviceRecovery
      state.observer.disconnect()
      return {
        reason: state.reason,
        maxCanvas: state.maxCanvas,
        rendererReplaced: state.renderer !== window.__demo.scene.renderer.instance,
        oldRendererDisposeCalls: state.disposeCount,
        oldRootDetached: !state.oldRoot.parent && state.oldRoot.children.length === 0,
      }
    })
    expect(native).toMatchObject({
      reason: 'destroyed',
      maxCanvas: 1,
      rendererReplaced: true,
      oldRootDetached: true,
    })
    expect(native.oldRendererDisposeCalls).toBeGreaterThan(0)
    expect(after.root).not.toBe(before.root)
    expect(after.poses).toEqual(before.poses)
    expect(after.instances).toEqual(before.instances)
    expect(after.motion).toEqual(before.motion)
    expect(after.finish).toBe(before.finish)
    expect(after.selectedPart).toBe(before.selectedPart)
    const cameraError = difference(before.camera, after.camera)
    expect(cameraError).toBeLessThanOrEqual(1e-6)
    result.recovery = {
      ...native,
      cameraError,
      beforeRoot: before.root,
      afterRoot: after.root,
      motion: after.motion,
    }
    await save(page, result, 'native-device-recovered', after)
  })

  await runCase('module-failure', async (_context, page, result) => {
    const injected = new Set()
    events(page, result, injected)
    await page.route('**/assets/field-*.js', async (route) => {
      const request = route.request(),
        target = new URL(request.url())
      if (target.origin !== origin || !/^\/assets\/field-[A-Za-z0-9_-]+\.js$/.test(target.pathname))
        return route.continue()
      injected.add(request.url())
      result.expectedFaults.push({ kind: 'injected-response', url: request.url(), status: 503 })
      await route.fulfill({
        status: 503,
        contentType: 'text/javascript',
        body: 'Intentional isolated DDGI module outage',
      })
    })
    await page.goto(url.href, { waitUntil: 'domcontentloaded' })
    await ready(page, 'ssgi')
    expect(injected.size, 'actual production field module was intercepted').toBeGreaterThan(0)
    const fallback = await snapshot(page)
    identity(fallback, 'ssgi')
    expect(fallback.lighting.indirectLighting.error).toMatch(/fetch|import|load/i)
    expect(fallback.lighting.indirectLighting.details).toBeNull()
    expect(fallback.badge.reason).toBe(fallback.lighting.indirectLighting.error)
    expect(fallback.badge.reason).toContain('/assets/field-')
    expect(fallback.badge.text).toContain('空间增强不可用')
    expect(fallback.badge.text).toContain('基础光照')
    await save(page, result, 'module-failure-fallback', fallback)
    await page.getByRole('button', { name: '放大', exact: true }).click()
    await settle(page, 'ssgi')
    const operated = await snapshot(page)
    identity(operated, 'ssgi')
    expect(difference(fallback.camera, operated.camera)).toBeGreaterThan(1e-6)
    expect(operated.poses).toEqual(fallback.poses)
    result.fallback = {
      injected: [...injected],
      actual: operated.lighting.indirectLighting.actual,
      error: operated.lighting.indirectLighting.error,
      badge: operated.badge,
      completeFrameDelta: operated.lighting.frames - fallback.lighting.frames,
      baselineOperable: true,
    }
    await save(page, result, 'module-failure-operable', operated)
  })
  report.passed =
    report.cases.length === (scope === 'all' ? 3 : 1) &&
    report.cases.every((result) => result.passed)
  if (!report.passed) process.exitCode = 1
} catch (error) {
  report.errors.push({ kind: 'test', message: error.stack || String(error) })
  process.exitCode = 1
} finally {
  await browser?.close()
  await writeFile(output + '/report.json', JSON.stringify(report, null, 2) + '\n')
  console.log(
    JSON.stringify({
      passed: report.passed,
      asset,
      cases: report.cases.map((result) => ({
        name: result.name,
        passed: result.passed,
        errors: result.errors.length,
      })),
      output,
      pending: report.pending,
    }),
  )
}
