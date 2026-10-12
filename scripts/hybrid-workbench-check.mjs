/* global URL, MutationObserver */
import { chromium, expect } from '@playwright/test'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { readProducts, bridge, inputPoint, openPanel } from './demo/browser-check.mjs'

const base = process.env.CHECK_URL || 'http://127.0.0.1:5183'
const output = process.env.HYBRID_CHECK_OUTPUT || 'artifacts/hybrid-workbench/check'
const timeout = Number(process.env.HYBRID_CHECK_TIMEOUT || 480000)
if (!Number.isFinite(timeout) || timeout < 1000) throw new Error('Invalid HYBRID_CHECK_TIMEOUT')
const scope = process.env.HYBRID_CHECK_SCOPE || 'core'
if (!['core', 'faults', 'admin', 'all'].includes(scope))
  throw new Error('Invalid HYBRID_CHECK_SCOPE')
const started = Date.now()
let stage = 'initialization',
  expectedWeightFailure = false
const progress = (next, detail) => {
  stage = next
  console.log(`[hybrid ${Math.round((Date.now() - started) / 1000)}s] ${next}`, detail ?? '')
}
await mkdir(output, { recursive: true })
const { products } = await readProducts(base)
const product = products.find((item) => item.product.slug === 'typewriter-study')
if (!product) throw new Error('Published typewriter absent')
const report = {
  passed: false,
  scope,
  checks: [],
  snapshots: {},
  captures: [],
  errors: [],
  expectedErrors: [],
  failedRequests: [],
  requests: [],
}
const browser = await chromium.launch({ channel: 'msedge', headless: true })
let page
try {
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  page.on('pageerror', (error) => report.errors.push(error.message))
  page.on('console', (entry) => {
    if (entry.type() !== 'error') return
    const message = entry.text()
    if (expectedWeightFailure && /Failed to load resource.*503/.test(message))
      report.expectedErrors.push({ stage, message })
    else if (
      stage === 'Authenticated real admin preview; no product writes' &&
      /Failed to load resource.*401/.test(message)
    )
      report.expectedErrors.push({ stage, message })
    else report.errors.push(message)
  })
  page.on('request', (request) => {
    if (/^https?:/.test(request.url())) report.requests.push(request.url())
  })
  page.on('requestfailed', (request) => {
    report.failedRequests.push({ url: request.url(), reason: request.failure()?.errorText })
  })

  const ready = async (remember = false) => {
    await expect(page.locator('.workbench')).toHaveAttribute('data-slug', product.product.slug)
    let lastLog = 0
    await expect
      .poll(
        async () => {
          const state = await page.evaluate(() => ({
            status: document.querySelector('.workbench')?.dataset.status,
            backend: document.querySelector('.wb-stage')?.dataset.renderBackend,
            phase: document.querySelector('.wb-stage')?.dataset.refinementPhase,
            loader: document.querySelector('.wb-stage-status')?.textContent?.trim(),
          }))
          if (Date.now() - lastLog >= 10000) {
            lastLog = Date.now()
            progress('Waiting for real raster-ready scene', state)
          }
          if (state.status === 'error' || state.status === 'content')
            throw new Error(`Workbench cannot reach raster-ready: ${state.status}: ${state.loader}`)
          return state.status
        },
        { timeout, intervals: [500, 1000] },
      )
      .toBe('ready')
    await expect(page.locator('canvas')).toHaveCount(1)
    await bridge(page, remember)
  }
  // Read the real component exposure through Vue's retained VNode tree. This test
  // does not add a renderer, supply product fixtures, or publish app debug globals.
  const attachHybrid = async () => {
    await page.evaluate(() => {
      const seen = new Set()
      const visit = (vnode) => {
        if (!vnode || typeof vnode !== 'object' || seen.has(vnode)) return undefined
        seen.add(vnode)
        const current = vnode.component
        if (current) {
          const exposed = current.exposed?.hybrid
          const value = exposed?.value ?? exposed
          if (value?.snapshot) return value
          const found = visit(current.subTree)
          if (found) return found
        }
        if (Array.isArray(vnode.children)) {
          for (const child of vnode.children) {
            const found = visit(child)
            if (found) return found
          }
        }
        return visit(vnode.suspense?.activeBranch)
      }
      const hybrid = visit(document.querySelector('#app')?._vnode)
      if (!hybrid) throw new Error('Real WorkbenchScene hybrid exposure absent')
      window.__hybridTest = hybrid
    })
    await expect.poll(() => refinement(), { timeout: 10000 }).not.toBeUndefined()
  }
  const refinement = () => page.evaluate(() => window.__hybridTest?.snapshot())
  const actual = () =>
    page.evaluate(() => {
      const context = window.__demo.scene,
        scene = context.scene.value,
        renderer = context.renderer.instance,
        root = scene.children.find((node) => node.userData.workbenchProduct),
        camera = context.camera.activeCamera.value
      if (!root) throw new Error('Real product root absent')
      const parts = [],
        poses = [],
        materials = [],
        highlighted = []
      let meshes = 0,
        instances = 0,
        triangles = 0
      root.traverse((node) => {
        if (Number.isInteger(node.userData.partId)) parts.push(node.name)
        poses.push([node.name, ...node.position.toArray(), ...node.quaternion.toArray()])
        if (node.isMesh) {
          meshes++
          const count = node.isInstancedMesh ? node.count : 1
          instances += node.isInstancedMesh ? count : 0
          triangles +=
            ((node.geometry.index?.count ?? node.geometry.attributes.position.count) / 3) * count
          if (node.instanceColor) {
            const values = node.instanceColor.array
            for (let index = 0; index < values.length; index += 3) {
              if (values[index] > 1) highlighted.push([node.name, index / 3])
            }
          }
          for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
            materials.push([
              material.name,
              material.color?.getHexString(),
              material.roughness,
              material.metalness,
            ])
          }
        }
      })
      const device = renderer.backend?.device
      return {
        roots: scene.children
          .filter((node) => node.userData.workbenchProduct)
          .map((node) => node.userData.workbenchProduct),
        source: root.userData.sourceKind,
        adapter: root.userData.adapter,
        bundle: root.userData.assetBundle,
        rootUuid: root.uuid,
        revision: window.__demo.store.revision,
        semanticParts: parts.length,
        meshes,
        instances,
        triangles,
        sourceTriangles: root.userData.triangles,
        parts,
        poses,
        materials,
        highlighted,
        sameCanvas: document.querySelector('canvas') === window.__demo.canvas,
        sameRenderer: renderer === window.__demo.renderer,
        camera: [...camera.position.toArray(), ...camera.quaternion.toArray()],
        webgpu: Boolean(
          renderer.isWebGPURenderer && renderer.backend?.isWebGPUBackend && device?.queue,
        ),
        adapterInfo: device?.adapterInfo
          ? {
              vendor: device.adapterInfo.vendor,
              architecture: device.adapterInfo.architecture,
              device: device.adapterInfo.device,
              description: device.adapterInfo.description,
            }
          : null,
        memory: renderer.info.memory,
        motion: Object.fromEntries(
          Object.entries(window.__demo.motion.states.value).map(([id, state]) => [
            id,
            { progress: state.progress, target: state.target, playing: state.playing },
          ]),
        ),
      }
    })
  const save = async (name) => {
    const snapshot = await actual()
    const { poses, materials, parts, ...compact } = snapshot
    compact.boundPartCount = parts.length
    compact.poseDigest = createHash('sha256').update(JSON.stringify(poses)).digest('hex')
    compact.materialDigest = createHash('sha256').update(JSON.stringify(materials)).digest('hex')
    compact.refinement = await refinement()
    const canvasPng = await page.locator('canvas').screenshot()
    await writeFile(`${output}/${name}.canvas.png`, canvasPng)
    const canvasStats = await sharp(canvasPng).stats()
    compact.canvasFrame = {
      bytes: canvasPng.length,
      channelStdDev: canvasStats.channels.slice(0, 3).map((channel) => channel.stdev),
    }
    expect(
      Math.max(...compact.canvasFrame.channelStdDev),
      'Actual canvas must contain a visible image',
    ).toBeGreaterThan(3)
    report.snapshots[name] = compact
    await page.screenshot({ path: `${output}/${name}.png`, fullPage: true })
    report.captures.push(name)
    return snapshot
  }
  const compareCanvas = async (beforeName, afterName) => {
    const decode = (name) =>
      sharp(`${output}/${name}.canvas.png`)
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true })
    const [before, after] = await Promise.all([decode(beforeName), decode(afterName)])
    expect(after.info).toEqual(before.info)
    const { width, height, channels } = before.info
    let squared = 0,
      invertedSquared = 0,
      changed = 0
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const offset = (y * width + x) * channels
        const invertedOffset = ((height - 1 - y) * width + x) * channels
        let difference = 0
        for (let c = 0; c < channels; c++) {
          const delta = after.data[offset + c] - before.data[offset + c]
          squared += delta * delta
          difference += Math.abs(delta)
          const invertedDelta = after.data[offset + c] - before.data[invertedOffset + c]
          invertedSquared += invertedDelta * invertedDelta
        }
        if (difference > 12) changed++
      }
    }
    return {
      width,
      height,
      rms: Math.sqrt(squared / before.data.length),
      invertedRms: Math.sqrt(invertedSquared / before.data.length),
      changedFraction: changed / (width * height),
    }
  }
  const waitPhase = async (phase) => {
    let lastLog = 0
    progress(`Waiting for ${phase}`)
    await expect
      .poll(
        async () => {
          const snapshot = await refinement()
          if (Date.now() - lastLog >= 10000) {
            lastLog = Date.now()
            progress(
              `Waiting for ${phase}`,
              snapshot
                ? {
                    phase: snapshot.phase,
                    min: snapshot.samples?.min,
                    max: snapshot.samples?.max,
                    target: snapshot.target,
                    generation: snapshot.generation,
                    revision: snapshot.revision,
                    error: snapshot.error,
                  }
                : 'Scene coordinator is not initialized yet',
            )
          }
          if (snapshot?.phase === 'error' && phase !== 'error')
            throw new Error(`Refinement failed: ${snapshot.error}`)
          return snapshot?.phase
        },
        { timeout, intervals: [500, 1000] },
      )
      .toBe(phase)
    progress(`Reached ${phase}`)
  }

  progress('Default WebGL baseline')
  await page.goto(new URL('/?product=typewriter-study', base).href)
  await ready(true)
  await expect(page.locator('.wb-stage')).toHaveAttribute('data-render-backend', 'webgl')
  const baseline = await actual()
  expect(baseline.webgpu).toBe(false)
  expect(report.requests.some((url) => /oidn|three\.webgpu|rt_hdr_alb_nrm\.tza/.test(url))).toBe(
    false,
  )
  report.checks.push('Existing WebGL entry loads without OIDN weights or WebGPU backend requests')

  if (scope === 'core' || scope === 'all') {
    progress('Actual WebGPU raster and first guided 128 spp')
    await page.goto(new URL('/?product=typewriter-study&renderPipeline=hybrid', base).href)
    await ready(true)
    await attachHybrid()
    await expect(page.locator('.wb-stage')).toHaveAttribute('data-render-backend', 'webgpu')
    const initial = await save('raster-ready')
    expect(initial.webgpu, 'A genuine GPUDevice-backed renderer, no WebGL fallback').toBe(true)
    expect(initial.roots).toEqual(['typewriter-study'])
    expect(initial.adapter).toBe('typewriter-v1')
    expect(initial.bundle).toBe(`${product.manifest.id}@${product.manifest.version}`)
    expect(initial.semanticParts).toBe(572)
    expect(initial.instances).toBeGreaterThan(0)
    expect(initial.instances).toBe(baseline.instances)
    expect(initial.triangles).toBe(initial.sourceTriangles)
    expect(initial.sameCanvas && initial.sameRenderer).toBe(true)
    report.checks.push(
      'Real GLB identity, 572 semantic parts, native instancing and unique GPU renderer',
    )
    await waitPhase('ready')
    const refined = await save('guided-128')
    const complete = await refinement()
    expect(complete.samples.min).toBeGreaterThanOrEqual(128)
    expect(complete.target).toBe(128)
    expect(complete.denoiseMs).toBeGreaterThan(0)
    expect(complete.firstRasterMs).toBeLessThan(complete.firstRefinedMs)
    await page.waitForTimeout(1200)
    const idle = await refinement()
    expect(idle.sampleFrames).toBe(complete.sampleFrames)
    expect(idle.rasterFrames).toBe(complete.rasterFrames)
    report.checks.push(
      'Actual 128 spp guided denoise presents only complete output and stops idle clock',
    )
    expect(refined.poses).toEqual(initial.poses)
    const pixels = await compareCanvas('raster-ready', 'guided-128')
    expect(pixels.changedFraction).toBeGreaterThan(0.01)
    expect(pixels.rms, 'Refined canvas must preserve the actual camera orientation').toBeLessThan(
      pixels.invertedRms,
    )
    report.snapshots.refinementPixelDifference = pixels
    report.checks.push(
      'Actual canvas pixels change under refinement and keep their vertical orientation',
    )

    progress('Continue to 1024, then mouse takeover')
    await page.getByRole('button', { name: '继续精修', exact: true }).click()
    await expect.poll(async () => (await refinement()).target, { timeout: 10000 }).toBe(1024)
    const continued = await refinement()
    expect(continued.samples?.min ?? complete.samples.min).toBeGreaterThanOrEqual(
      complete.samples.min,
    )
    report.snapshots['high-continuation'] = continued
    report.checks.push('1024 target preserves current valid accumulation')

    const point = await inputPoint(page)
    await page.mouse.move(point.x, point.y)
    await page.mouse.down()
    await page.mouse.move(point.x + 85, point.y + 20, { steps: 8 })
    const interrupted = await refinement()
    expect(interrupted.generation).toBeGreaterThan(continued.generation)
    expect(interrupted.phase).not.toBe('ready')
    expect(interrupted.samples?.min ?? 0).toBe(0)
    await page.mouse.up()
    const dragged = await save('drag-takeover')
    expect(dragged.camera).not.toEqual(initial.camera)
    expect(dragged.sameCanvas && dragged.sameRenderer).toBe(true)
    report.checks.push(
      'Mouse input immediately takes control and invalidates old high-sample result',
    )

    progress('Realtime mode, paused structure and exact restoration')
    await page.getByRole('button', { name: '仅实时展示', exact: true }).click()
    const realtime = await refinement()
    expect(realtime.realtime).toBe(true)
    await page.waitForTimeout(1200)
    expect((await refinement()).sampleFrames).toBe(realtime.sampleFrames)
    await openPanel(page, '结构与动作', '.wb-layout-motion')
    await page.getByRole('button', { name: '分层展开', exact: true }).click()
    await page.waitForTimeout(900)
    const pause = page.getByRole('button', { name: '暂停', exact: true })
    if (await pause.isVisible()) await pause.click()
    const layered = await save('paused-structure')
    expect(layered.poses).not.toEqual(initial.poses)
    expect(Object.values(layered.motion).every((state) => !state.playing)).toBe(true)
    await page.getByRole('button', { name: '复原动作', exact: true }).click()
    await page.waitForTimeout(900)
    const restored = await save('restored')
    expect(restored.poses).toEqual(initial.poses)
    expect(restored.sameCanvas && restored.sameRenderer).toBe(true)
    report.checks.push('Realtime opt-out, arbitrary paused structure, deterministic restoration')
  }

  if (scope === 'faults' || scope === 'all') {
    progress('Weight failure with rapid selection generations')
    expectedWeightFailure = true
    let weightFailures = 0
    const denyWeight = async (route) => {
      weightFailures++
      await route.fulfill({
        status: 503,
        contentType: 'text/plain',
        body: 'Intentional test outage',
      })
    }
    await page.route('**/models/denoise/rt_hdr_alb_nrm.tza', denyWeight)
    await page.goto(new URL('/?product=typewriter-study&renderPipeline=hybrid', base).href)
    await ready(true)
    await attachHybrid()
    const beforeRapid = await actual()
    const heldPoint = await inputPoint(page)
    await page.mouse.move(heldPoint.x, heldPoint.y)
    await page.mouse.down()
    await page.mouse.move(heldPoint.x + 35, heldPoint.y + 12, { steps: 5 })
    expect((await refinement()).interacting).toBe(true)
    // Delay transport, without supplying fixture JSON: both selections still
    // fetch the real API, and the first request is cancelled by the actual store.
    let requestCount = 0
    const delayFirst = async (route) => {
      requestCount++
      if (requestCount === 1) await page.waitForTimeout(600)
      await route.continue().catch((error) => {
        if (!/already handled|cancel|closed|aborted/i.test(String(error))) throw error
      })
    }
    await page.route('**/api/v1/products/typewriter-study', delayFirst)
    const pendingRequest = page.waitForRequest(
      (request) => new URL(request.url()).pathname === '/api/v1/products/typewriter-study',
    )
    await page.evaluate(() => {
      void window.__demo.store.select('typewriter-study')
    })
    await pendingRequest
    await page.evaluate(() => {
      void window.__demo.store.select('typewriter-study')
    })
    await ready()
    expect((await refinement()).interacting).toBe(false)
    await page.mouse.up()
    await page.unroute('**/api/v1/products/typewriter-study', delayFirst)
    const afterRapid = await save('rapid-current-generation')
    expect(afterRapid.revision).toBeGreaterThanOrEqual(beforeRapid.revision + 2)
    expect(afterRapid.rootUuid).not.toBe(beforeRapid.rootUuid)
    expect(afterRapid.roots).toEqual(['typewriter-study'])
    expect(afterRapid.instances).toBe(baseline.instances)
    expect(afterRapid.sameCanvas && afterRapid.sameRenderer).toBe(true)
    expect((await refinement()).revision).toBe(afterRapid.revision)
    report.checks.push(
      'Rapid real API selections retain only the current product generation and reuse the renderer',
    )

    await waitPhase('error')
    const weightError = await save('weight-failure-raster')
    const failed = await refinement()
    expect(weightFailures).toBeGreaterThan(0)
    expect(failed.error).toMatch(/(?:HTTP|加载失败[:：])\s*503/)
    expect(failed.firstRasterMs).not.toBeNull()
    expect(weightError.sameCanvas && weightError.sameRenderer).toBe(true)
    await expect(page.getByRole('button', { name: '重试精修', exact: true })).toBeVisible()
    await page.unroute('**/models/denoise/rt_hdr_alb_nrm.tza', denyWeight)
    expectedWeightFailure = false
    progress('Retry failed denoise using retained 128 target and actual weights')
    await page.getByRole('button', { name: '重试精修', exact: true }).click()
    await expect.poll(async () => (await refinement())?.target, { timeout: 10000 }).toBe(128)
    await waitPhase('ready')
    const recoveredWeight = await save('weight-retry-128')
    expect((await refinement()).samples.min).toBeGreaterThanOrEqual(128)
    expect(recoveredWeight.sameCanvas && recoveredWeight.sameRenderer).toBe(true)
    report.checks.push(
      'An actual weights HTTP 503 keeps raster usable; explicit retry completes guided 128 spp',
    )

    progress('Real GPUDevice loss and one-host recovery')
    await page.getByRole('button', { name: '仅实时展示', exact: true }).click()
    await openPanel(page, '结构与动作', '.wb-layout-motion')
    await page.getByRole('button', { name: '分层展开', exact: true }).click()
    await page.waitForTimeout(700)
    const pause = page.getByRole('button', { name: '暂停', exact: true })
    if (await pause.isVisible()) await pause.click()
    const point = await inputPoint(page)
    await page.mouse.move(point.x, point.y)
    await page.mouse.down()
    await page.mouse.move(point.x + 60, point.y + 15, { steps: 8 })
    await page.mouse.up()
    await page.evaluate(() => {
      const hotspot = window.__demo.store.presentation.hotspots[0]
      window.__demo.store.focus(hotspot.id)
    })
    await page.waitForTimeout(850)
    const beforeLoss = await save('before-device-loss')
    expect(beforeLoss.highlighted.length).toBeGreaterThan(0)
    await page.evaluate(() => {
      const renderer = window.__demo.scene.renderer.instance
      const device = renderer.backend.device
      if (!device?.destroy) throw new Error('Actual native GPUDevice unavailable')
      window.__deviceLossTest = {
        renderer,
        canvas: document.querySelector('canvas'),
        lost: null,
        maxCanvas: 1,
      }
      const observer = new MutationObserver(() => {
        window.__deviceLossTest.maxCanvas = Math.max(
          window.__deviceLossTest.maxCanvas,
          document.querySelectorAll('canvas').length,
        )
      })
      observer.observe(document.querySelector('#app'), { subtree: true, childList: true })
      window.__deviceLossTest.observer = observer
      void device.lost.then((info) => {
        window.__deviceLossTest.lost = info.reason
      })
      device.destroy()
    })
    await page.waitForFunction(() => window.__deviceLossTest.lost !== null, null, {
      timeout: 15000,
    })
    await page.waitForFunction(
      () => document.querySelector('canvas') !== window.__deviceLossTest.canvas,
      null,
      { timeout: 15000 },
    )
    await ready(true)
    await attachHybrid()
    await expect(page.locator('.wb-stage')).toHaveAttribute('data-render-backend', 'webgpu')
    await page.getByRole('button', { name: '仅实时展示', exact: true }).click()
    const recoveredDevice = await save('device-recovered')
    const loss = await page.evaluate(() => {
      window.__deviceLossTest.observer.disconnect()
      return {
        reason: window.__deviceLossTest.lost,
        maxCanvas: window.__deviceLossTest.maxCanvas,
        replacedRenderer:
          window.__deviceLossTest.renderer !== window.__demo.scene.renderer.instance,
      }
    })
    expect(loss.reason).toBe('destroyed')
    expect(loss.maxCanvas).toBeLessThanOrEqual(1)
    expect(loss.replacedRenderer).toBe(true)
    expect(recoveredDevice.webgpu).toBe(true)
    expect(recoveredDevice.roots).toEqual(['typewriter-study'])
    expect(recoveredDevice.poses).toEqual(beforeLoss.poses)
    expect(recoveredDevice.motion).toEqual(beforeLoss.motion)
    expect(recoveredDevice.highlighted).toEqual(beforeLoss.highlighted)
    recoveredDevice.camera.forEach((value, index) =>
      expect(value).toBeCloseTo(beforeLoss.camera[index], 6),
    )
    expect(Object.values(recoveredDevice.motion).every((state) => !state.playing)).toBe(true)
    report.snapshots.deviceLoss = loss
    report.checks.push(
      'Destroying the genuine GPUDevice rebuilds one host, retaining camera and paused structure',
    )
  }

  if (scope === 'admin' || scope === 'all') {
    progress('Authenticated real admin preview; no product writes')
    const localEnv = await readFile('server/.env.local', 'utf8').catch((error) => {
      if (error.code === 'ENOENT') return ''
      throw error
    })
    const credentials = Object.fromEntries(
      localEnv
        .split(/\r?\n/)
        .filter((line) => /^TREES_ADMIN_/.test(line))
        .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
    )
    await page.route('**/api/v1/admin/**', async (route) => {
      const request = route.request(),
        path = new URL(request.url()).pathname
      const allowed =
        request.method() === 'GET' ||
        (request.method() === 'POST' &&
          [
            '/api/v1/admin/session/login',
            '/api/v1/admin/session/logout',
            '/api/v1/admin/products/preview',
          ].includes(path))
      if (!allowed) {
        report.errors.push(`Blocked persisted-data write: ${request.method()} ${path}`)
        await route.abort('blockedbyclient')
        return
      }
      await route.continue()
    })
    await page.goto(new URL('/admin?renderPipeline=hybrid', base).href)
    await expect
      .poll(
        async () =>
          (await page.getByLabel('管理员账号', { exact: true }).isVisible()) ||
          (await page.getByRole('button', { name: '退出登录', exact: true }).isVisible()),
        { timeout: 10000 },
      )
      .toBe(true)
    if (await page.getByLabel('管理员账号', { exact: true }).isVisible()) {
      await page
        .getByLabel('管理员账号', { exact: true })
        .fill(process.env.HYBRID_ADMIN_USERNAME || credentials.TREES_ADMIN_USERNAME || 'admin')
      await page
        .getByLabel('密码', { exact: true })
        .fill(process.env.HYBRID_ADMIN_PASSWORD || credentials.TREES_ADMIN_PASSWORD || '123456')
      await page.getByRole('button', { name: '登录管理端', exact: true }).click()
    }
    await expect(page.getByRole('button', { name: '退出登录', exact: true })).toBeVisible()
    const detailUrl = new URL('/api/v1/admin/products/typewriter-study', base).href
    const originalResponse = await page.request.get(detailUrl)
    expect(originalResponse.ok()).toBe(true)
    const original = await originalResponse.json()
    await page.getByRole('button', { name: `编辑${product.product.name}`, exact: true }).click()
    const tab = (name) =>
      page
        .getByRole('navigation', { name: '商品编辑分区' })
        .getByRole('button', { name, exact: true })
        .click()
    await tab('镜头')
    await page.getByRole('button', { name: '为默认取景采集镜头', exact: true }).click()
    await ready(true)
    await attachHybrid()
    await expect(page.locator('.wb-stage')).toHaveAttribute('data-render-backend', 'webgpu')
    await page.getByRole('button', { name: '仅实时展示', exact: true }).click()
    const previewBefore = await save('admin-preview-raster')
    const point = await inputPoint(page)
    await page.mouse.move(point.x, point.y)
    await page.mouse.down({ button: 'right' })
    await page.mouse.move(point.x + 45, point.y + 12, { steps: 8 })
    await page.mouse.up({ button: 'right' })
    const previewMoved = await actual()
    expect(previewMoved.camera).not.toEqual(previewBefore.camera)
    expect(previewMoved.sameCanvas && previewMoved.sameRenderer).toBe(true)
    await page.getByRole('button', { name: '使用此取景并返回', exact: true }).click()
    await expect(page.locator('canvas')).toHaveCount(0)
    await expect(
      page.getByText('取景已回填到表单，尚未保存到数据库。', { exact: true }),
    ).toBeVisible()
    await tab('高级配置')
    const captured = JSON.parse(
      await page.getByLabel('完整展示配置 JSON', { exact: true }).inputValue(),
    )
    captured.camera.position.forEach((value, index) =>
      expect(value).toBeCloseTo(previewMoved.camera[index], 4),
    )
    expect(captured.camera.target).not.toEqual(original.presentation.camera.target)
    const perspective = captured.views.find((view) => view.id === 'perspective')
    expect(perspective.position).toEqual(captured.camera.position)
    expect(perspective.target).toEqual(captured.camera.target)
    expect(captured.actions).toEqual(original.presentation.actions)
    const persistedResponse = await page.request.get(detailUrl)
    expect(persistedResponse.ok()).toBe(true)
    expect(await persistedResponse.json()).toEqual(original)
    report.snapshots.adminCapture = {
      actualCamera: previewMoved.camera,
      capturedCamera: captured.camera,
      persistedUnchanged: true,
      source: captured.source,
    }
    await page.screenshot({ path: `${output}/admin-captured-unsaved.png`, fullPage: true })
    report.captures.push('admin-captured-unsaved')
    report.checks.push(
      'Authenticated GPU preview supports real right-button pan and camera return; persisted product is unchanged',
    )
    page.once('dialog', (dialog) => dialog.accept())
    await page.getByRole('button', { name: '返回商品列表', exact: true }).click()
    await expect(page.locator('canvas')).toHaveCount(0)
  }

  expect([...new Set(report.requests.map((url) => new URL(url).origin))]).toEqual([
    new URL(base).origin,
  ])
  if (scope !== 'admin')
    expect(report.requests.some((url) => url.includes('/models/denoise/rt_hdr_alb_nrm.tza'))).toBe(
      true,
    )
  expect(report.errors).toEqual([])
  report.passed = true
  progress('Completed', { scope, checks: report.checks.length })
} catch (error) {
  progress('Failed', error.message)
  report.failure = error.stack || String(error)
  if (page) await page.screenshot({ path: `${output}/failure.png`, fullPage: true }).catch(() => {})
} finally {
  await browser.close()
  await writeFile(`${output}/report.json`, `${JSON.stringify(report, null, 2)}\n`)
}
console.log(
  JSON.stringify(
    { passed: report.passed, checks: report.checks.length, output, failure: report.failure },
    null,
    2,
  ),
)
if (!report.passed) process.exitCode = 1
