/* global fetch, URL, setTimeout */
import { chromium, expect } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'

const base = process.env.CHECK_URL || 'http://127.0.0.1:5181'
const lifecycle = process.env.REVENTON_LIFECYCLE === '1'
const output = process.env.REVENTON_CHECK_OUTPUT || 'artifacts/reventon-workbench/runtime'
const timeout = 180000
const report = {
  passed: false,
  fixture: false,
  lifecycle,
  checks: [],
  states: {},
  captures: [],
  requests: [],
  failedRequests: [],
  errors: [],
  expectedFaultErrors: [],
  anchors: [],
  memory: [],
}
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ channel: 'msedge', headless: true })
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
  const manifestResponse = await fetch(new URL(p.source.bundle.manifest, base))
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
  const page = await context.newPage()
  let injectingFault = false
  page.on('pageerror', (error) => report.errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() !== 'error') return
    if (injectingFault && /Failed to load resource|net::ERR_FAILED/.test(message.text()))
      report.expectedFaultErrors.push(message.text())
    else report.errors.push(message.text())
  })
  page.on('request', (request) => report.requests.push(request.url()))
  page.on('requestfailed', (request) =>
    report.failedRequests.push({ url: request.url(), reason: request.failure()?.errorText }),
  )
  const bridge = async () => {
    await page.evaluate(() => {
      let component = document.querySelector('canvas').__vueParentComponent
      let scene, motion, store
      while (component) {
        const values = Reflect.ownKeys(component.provides ?? {}).map(
          (key) => component.provides[key],
        )
        const appValues = Reflect.ownKeys(component.appContext.provides).map(
          (key) => component.appContext.provides[key],
        )
        scene ??= component.exposed?.context ?? values.find((value) => value?.scene?.value?.isScene)
        motion ??= values.find(
          (value) => value?.states?.value && typeof value.snapshot === 'function',
        )
        store ??= component.setupState?.store
        if (typeof store?.motion !== 'function')
          store = appValues.find((value) => value?._s?.get('workbench'))?._s.get('workbench')
        component = component.parent
      }
      if (!scene || !motion || !store)
        throw new Error('Actual Three / motion / Pinia bridge missing')
      window.__carScene = scene
      window.__carMotion = motion
      window.__carStore = store
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
        motionNodes = {}
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
          meshes++
          triangles +=
            ((node.geometry.index?.count ?? node.geometry.attributes.position?.count ?? 0) / 3) *
            (node.isInstancedMesh ? node.count : 1)
          sourceObjects += node.userData.source_object_count ?? 0
        }
      })
      const camera = scene.camera.activeCamera.value
      return {
        slug: root.userData.workbenchProduct,
        source: root.userData.sourceKind,
        adapter: root.userData.adapter,
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
        memory: { ...scene.renderer.instance.info.memory },
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
    if (!(await controls().isVisible()))
      await page.getByRole('button', { name: '结构与动作', exact: true }).click()
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

  await page.goto(base + '/?product=reventon', { waitUntil: 'domcontentloaded', timeout: 90000 })
  await ready('reventon')
  console.log('Reventon actual GLB first frame ready')
  await page.evaluate(() => {
    window.__carCanvas = document.querySelector('canvas')
    window.__carRenderer = window.__carScene.renderer.instance
  })
  const initial = await saved('initial')
  expect(initial.source).toBe('glb')
  expect(initial.adapter).toBe('reventon-v1')
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
  await page.waitForTimeout(750)
  const focusCheck = await page.evaluate((hotspot) => {
    const root = window.__carScene.scene.value.children.find(
      (node) => node.userData.workbenchProduct,
    )
    const camera = window.__carScene.camera.activeCamera.value
    const node = root.getObjectByName(hotspot.node)
    const world = node.localToWorld(camera.position.clone().fromArray(hotspot.anchor ?? [0, 0, 0]))
    return {
      actual: camera.position.toArray(),
      expected: world.toArray().map((v, i) => v + hotspot.cameraOffset[i]),
    }
  }, chosenHotspot)
  cameraNear(focusCheck.actual, focusCheck.expected)
  report.checks.push(
    'Expanded thin leader anchors match actual transformed node world positions within one pixel; selecting a label focuses the current pose',
  )

  await openActions()
  const beforeViewReset = await state()
  await page.getByRole('button', { name: '复位视角', exact: true }).click()
  await page.waitForTimeout(750)
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
    await openActions()
    await seek(doors.id, 0.61)
    await seek(parts.id, 0.437)
    const beforeLoss = await saved('before-context-loss')
    await page.evaluate(() => {
      window.__carLoss = window.__carRenderer.getContext().getExtension('WEBGL_lose_context')
      if (!window.__carLoss) throw new Error('Actual context-loss extension unavailable')
      window.__carLoss.loseContext()
    })
    await expect(page.locator('.workbench')).toHaveAttribute('data-status', 'error')
    await page.waitForTimeout(250)
    await page.evaluate(() => window.__carLoss.restoreContext())
    await ready('reventon')
    const recovered = await stable()
    poseNear(recovered.motionNodes, beforeLoss.motionNodes)
    expect(recovered.motion).toEqual(beforeLoss.motion)
    expect(recovered.sameCanvas && recovered.sameRenderer).toBe(true)
    report.checks.push(
      'Real WebGL context loss/recovery retains both progress channels paused on the same Canvas and renderer',
    )

    for (const slug of ['typewriter-study', 'piano-cfx']) {
      await choose(slug)
      const value = await state()
      expect(value.sameCanvas && value.sameRenderer).toBe(true)
      expect(value.adapter).toBe(slug === 'piano-cfx' ? 'piano-v1' : 'typewriter-v1')
      expect(Object.keys(value.motionNodes)).toHaveLength(0)
      report.memory.push({ slug, ...value.memory })
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
    await choose('reventon', false)
    await pending
    await choose('typewriter-study')
    await completed
    await page.waitForTimeout(250)
    await ready('typewriter-study')
    await page.unroute('**/api/v1/products/reventon')
    report.checks.push(
      'Three-case identity transitions use the existing Canvas; a real delayed car response cannot replace the newer typewriter selection',
    )

    injectingFault = true
    await page.route('**' + p.source.bundle.manifest, (route) => route.abort('failed'))
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
    await page.unroute('**' + p.source.bundle.manifest)
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
  expect(report.requests.some((url) => url === new URL(p.source.bundle.manifest, base).href)).toBe(
    true,
  )
  expect(report.requests.some((url) => /\.glb$/.test(url))).toBe(true)
  expect(report.errors).toEqual([])
  report.checks.push(
    'All requests stay same-origin; no unexpected browser errors; a single persistent Canvas and renderer handles this verification',
  )
  report.passed = true
} catch (error) {
  report.failure = String(error)
  throw error
} finally {
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
