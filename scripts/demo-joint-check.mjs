/* global URL, performance, setInterval, clearInterval */
import { chromium, expect } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import {
  slugs,
  viewport,
  readProducts,
  productEvidence,
  positiveInteger,
  collectErrors,
  ready,
  sceneSnapshot,
  compactSnapshot,
  trackLifecycle,
  choose,
  openPanel,
  observeWithMouse,
  hotspotEvidence,
  near,
} from './demo/browser-check.mjs'

const base = process.env.CHECK_URL || 'http://127.0.0.1:5181'
const output = process.env.DEMO_JOINT_OUTPUT || 'artifacts/demo/joint'
const smoke = process.env.DEMO_SMOKE === '1'
const cycles = positiveInteger('DEMO_JOINT_CYCLES', 10)
const durationSeconds = positiveInteger('DEMO_JOINT_SECONDS', 1200)
if (!smoke && (cycles < 10 || durationSeconds < 1200))
  throw new Error(
    'Short checks require DEMO_SMOKE=1; formal acceptance needs 30 switches and 1200s',
  )
await mkdir(output, { recursive: true })
const report = {
  passed: false,
  formalAcceptance: false,
  smoke,
  fixture: false,
  origin: new URL(base).origin,
  viewport,
  browserChannel: 'msedge',
  headless: process.env.DEMO_HEADED !== '1',
  startedAt: new Date().toISOString(),
  requirement: { switches: cycles * slugs.length, interactiveSeconds: durationSeconds },
  measurement:
    'Actual Three roots, mesh/node identity, physical poses, transformed hotspot anchors, renderer.info and test-only dispose listeners. Timing covers continuous real UI/input operations after warmup, including model readiness waits; no empty timer sleep.',
  warmup: [],
  baseline: {},
  visits: [],
  operations: [],
  lifecycle: [],
  visibility: [],
  contextRecovery: [],
  errors: [],
  failedRequests: [],
  requestOrigins: new Set(),
}
let browser,
  page,
  currentSlug = null,
  stage = 'metadata',
  interactiveStart,
  heartbeat
const baseline = new Map()
const elapsed = () => (interactiveStart === undefined ? 0 : performance.now() - interactiveStart)
const progress = () =>
  console.log(
    JSON.stringify({
      event: 'demo-joint-progress',
      stage,
      slug: currentSlug,
      seconds: Math.round(elapsed() / 1000),
      requiredSeconds: durationSeconds,
      visits: report.visits.length,
      operations: report.operations.length,
      smoke,
    }),
  )

try {
  const { products } = await readProducts(base)
  report.products = products.map(productEvidence)
  browser = await chromium.launch({ channel: 'msedge', headless: report.headless })
  report.browserVersion = browser.version()
  const context = await browser.newContext({ viewport, reducedMotion: 'no-preference' })
  page = await context.newPage()
  page.setDefaultTimeout(30000)
  collectErrors(page, report)
  heartbeat = setInterval(progress, 60000)

  const operation = async (kind, detail, perform) => {
    const entry = {
      kind,
      detail,
      slug: currentSlug,
      stage,
      startedAt: new Date().toISOString(),
      startMs: Math.round(elapsed()),
    }
    report.operations.push(entry)
    await perform()
    entry.completedAt = new Date().toISOString()
    entry.endMs = Math.round(elapsed())
  }
  const currentState = (metadata) => sceneSnapshot(page, metadata)
  const motionState = (action) =>
    page.evaluate((id) => {
      const value = window.__demo.motion.states.value[id]
      return value ? { progress: value.progress, playing: value.playing } : null
    }, action.id)
  const actions = (metadata) =>
    metadata.product.presentation.actions.filter((a) => a.kind === 'progress')
  const primary = (metadata) =>
    actions(metadata).find(
      (action) => action.id === metadata.product.presentation.structureActionId,
    ) ?? actions(metadata)[0]
  const control = (action) => page.locator(`.wb-progress[data-motion-id="${action.id}"]`)
  const paused = async (metadata, action) => {
    await expect.poll(async () => (await motionState(action))?.playing).toBe(false)
    const snapshot = await currentState(metadata)
    await page.waitForTimeout(250)
    expect((await currentState(metadata)).poseDigest).toBe(snapshot.poseDigest)
    return snapshot
  }
  const settled = async (metadata, action, value) => {
    await expect
      .poll(async () => (await motionState(action))?.progress, {
        timeout: 45000,
      })
      .toBeCloseTo(value, 7)
    return paused(metadata, action)
  }
  const openActions = () => openPanel(page, '结构与动作', '.wb-action-list')
  const targetLabel = (metadata, action, value) => {
    if (metadata.rig?.type === 'typewriter-layout-v1')
      return value === 0 ? '合拢整机' : value === 0.6 ? '分层展开' : '平铺部件'
    if (metadata.rig?.type === 'piano-sound-path-v1') return value === 0 ? '整机' : '全部平铺'
    return value === 0 ? action.motion.closeLabel : action.motion.openLabel
  }
  const clickTarget = async (metadata, action, value) => {
    await openActions()
    await control(action)
      .getByRole('button', { name: targetLabel(metadata, action, value), exact: true })
      .click()
  }
  const assertTracks = (metadata, state, initial) => {
    for (const action of actions(metadata))
      for (const track of action.motion.tracks ?? []) {
        const now = state.nodes[track.node],
          rest = initial.nodes[track.node],
          progress = state.motion[action.id].progress,
          local = Math.min(
            1,
            Math.max(0, (progress - track.range[0]) / (track.range[1] - track.range[0])),
          )
        if (track.type === 'translate')
          near(
            now.position,
            rest.position.map((v, i) => v + track.offset[i] * local),
          )
        else {
          const dot = Math.abs(
            now.quaternion.reduce((sum, v, i) => sum + v * rest.quaternion[i], 0),
          )
          expect(2 * Math.acos(Math.min(1, dot))).toBeCloseTo(Math.abs(track.angle) * local, 5)
        }
      }
  }
  const seek = async (metadata, action, value) => {
    await page.evaluate(({ id, value }) => window.__demo.store.motion('seek', id, value), {
      id: action.id,
      value,
    })
    return settled(metadata, action, value)
  }
  const validateLifecycle = async () => {
    const entries = await trackLifecycle(page)
    for (const entry of entries) {
      if (!entry.detached) continue
      expect(
        entry.disposed,
        `${entry.slug} root ${entry.rootId} releases source resources`,
      ).toEqual(entry.resources)
    }
    report.lifecycle = entries
  }
  const validateBudget = (metadata, snapshot) => {
    const expected = baseline.get(metadata.product.slug)
    expect(snapshot.identityDigest).toBe(expected.identityDigest)
    expect(snapshot.poseDigest).toBe(expected.poseDigest)
    expect(snapshot.meshes).toBe(expected.meshes)
    expect(snapshot.triangles).toBe(expected.triangles)
    for (const resource of ['geometries', 'textures', 'programs'])
      expect(
        snapshot.renderer[resource],
        `${snapshot.slug} current renderer ${resource} vs warm baseline`,
      ).toBeLessThanOrEqual(expected.renderer[resource])
  }
  const visit = async (metadata, countVisit = false) => {
    await operation('catalog-select', metadata.product.slug, async () => choose(page, metadata))
    currentSlug = metadata.product.slug
    const snapshot = await ready(page, metadata)
    await validateLifecycle()
    if (countVisit) {
      validateBudget(metadata, snapshot)
      const entry = {
        visit: report.visits.length + 1,
        at: new Date().toISOString(),
        elapsedMs: Math.round(elapsed()),
        ...compactSnapshot(snapshot),
        baselineRenderer: baseline.get(currentSlug).renderer,
        resourceDelta: Object.fromEntries(
          ['geometries', 'textures', 'programs'].map((key) => [
            key,
            snapshot.renderer[key] - baseline.get(currentSlug).renderer[key],
          ]),
        ),
      }
      report.visits.push(entry)
      console.log(
        JSON.stringify({
          event: 'demo-joint-ready',
          visit: entry.visit,
          slug: currentSlug,
          elapsedSeconds: Math.round(elapsed() / 1000),
          renderer: entry.renderer,
          delta: entry.resourceDelta,
        }),
      )
    }
    return snapshot
  }

  const exercise = async (metadata, initial, round) => {
    const action = primary(metadata)
    expect(action, 'Real product has a registered progress action').toBeDefined()
    const expandedValue = metadata.rig?.type === 'typewriter-layout-v1' ? 0.6 : 1
    await operation('expand-pause-resume', action.id, async () => {
      await clickTarget(metadata, action, expandedValue)
      await expect.poll(async () => (await motionState(action))?.progress).toBeGreaterThan(0.01)
      await control(action)
        .locator(
          metadata.product.slug === 'reventon' ? '.wb-car-pause' : '.wb-progress-buttons button',
        )
        .first()
        .click()
      const stopped = await paused(metadata, action)
      expect(stopped.motion[action.id].progress).toBeGreaterThan(0)
      expect(stopped.motion[action.id].progress).toBeLessThan(expandedValue)
      expect(stopped.poseDigest).not.toBe(initial.poseDigest)
      near(stopped.camera, initial.camera)
      await control(action)
        .locator(
          metadata.product.slug === 'reventon' ? '.wb-car-pause' : '.wb-progress-buttons button',
        )
        .first()
        .click()
      const expanded = await settled(metadata, action, expandedValue)
      expect(expanded.poseDigest).not.toBe(initial.poseDigest)
      assertTracks(metadata, expanded, initial)
      near(expanded.camera, initial.camera)
    })
    if (expandedValue !== 1)
      await operation('flat-layout', action.id, async () => {
        await clickTarget(metadata, action, 1)
        await settled(metadata, action, 1)
      })
    if (metadata.product.slug === 'reventon')
      await operation('door-composition', 'open-doors + explore-parts', async () => {
        const doors = actions(metadata).find((entry) => entry.id === 'open-doors')
        await clickTarget(metadata, doors, 1)
        assertTracks(metadata, await settled(metadata, doors, 1), initial)
        await clickTarget(metadata, doors, 0)
        assertTracks(metadata, await settled(metadata, doors, 0), initial)
      })
    await operation(
      'deterministic-pose-checkpoint',
      `${action.id}@0.437 forward/reverse`,
      async () => {
        const forward = await seek(metadata, action, 0.437)
        assertTracks(metadata, forward, initial)
        await seek(metadata, action, 1)
        const backward = await seek(metadata, action, 0.437)
        expect(backward.poseDigest).toBe(forward.poseDigest)
        assertTracks(metadata, backward, initial)
        await seek(metadata, action, 1)
      },
    )
    await operation(
      'hotspot-and-part-focus',
      'Actual visible leader and semantic detail',
      async () => {
        await page.waitForTimeout(650)
        const visibleIds = await page
          .locator('.wb-hotspot[data-layout-visible=true]')
          .evaluateAll((elements) => elements.map((element) => element.dataset.part))
        const hotspot = metadata.product.presentation.hotspots.find((part) =>
          visibleIds.includes(part.id),
        )
        expect(
          hotspot,
          'Expanded real model exposes at least one physical annotation',
        ).toBeDefined()
        const anchor = await hotspotEvidence(page, metadata, hotspot)
        expect(anchor.labelVisible).toBe(true)
        expect(anchor.anchorErrorPx).not.toBeNull()
        expect(anchor.anchorErrorPx).toBeLessThanOrEqual(1.5)
        await page.locator(`.wb-hotspot[data-part="${hotspot.id}"]`).click()
        await expect(page.locator('.wb-part-copy h3')).toHaveText(hotspot.name)
        await expect.poll(async () => (await currentState(metadata)).selectedPart).toBe(hotspot.id)
        await page.waitForTimeout(850)
        const focused = await hotspotEvidence(page, metadata, hotspot)
        near(focused.actualCamera, focused.expectedCamera, 1e-5)
        expect((await currentState(metadata)).rootId).toBe(initial.rootId)
        await page.getByRole('button', { name: '返回全景', exact: true }).click()
        await page.waitForTimeout(850)
        expect((await currentState(metadata)).selectedPart).toBe('')
      },
    )
    await operation('reverse-and-restore', action.id, async () => {
      await clickTarget(metadata, action, 0)
      const restored = await settled(metadata, action, 0)
      expect(restored.poseDigest).toBe(initial.poseDigest)
      assertTracks(metadata, restored, initial)
    })
    await operation('guide-and-return', 'Named guide checkpoints + user exit', async () => {
      await openPanel(page, '导览', '.wb-panel-content')
      // Opening an existing non-guide inspector still requires the explicit guide tool.
      if (!(await page.getByRole('button', { name: '开始导览', exact: true }).isVisible()))
        await page.getByRole('button', { name: '导览', exact: true }).click()
      await page.getByRole('button', { name: '开始导览', exact: true }).click()
      await expect(page.locator('.wb-guide-count')).toHaveText(
        `1 / ${metadata.product.presentation.guide.length}`,
      )
      if (metadata.product.presentation.guide.length > 1) {
        await page.getByRole('button', { name: '下一步', exact: true }).click()
        await expect(page.locator('.wb-guide-count')).toHaveText(
          `2 / ${metadata.product.presentation.guide.length}`,
        )
        await page.getByRole('button', { name: '上一步', exact: true }).click()
      }
      await page.getByRole('button', { name: '退出导览，保留当前观察', exact: true }).click()
      expect((await currentState(metadata)).guideStep).toBe(-1)
      await page.getByRole('button', { name: '开始导览', exact: true }).click()
      await page.getByRole('group', { name: '商品展示区', exact: true }).focus()
      await page.keyboard.press(round % 2 ? 'ArrowLeft' : 'ArrowRight')
      await expect(page.getByRole('button', { name: '开始导览', exact: true })).toBeVisible()
    })
    await operation('panel-close-reopen', 'Preserve paused actual pose', async () => {
      await openActions()
      await page.getByRole('button', { name: '复原动作', exact: true }).click()
      const before = await paused(metadata, action)
      await page.getByRole('button', { name: '收起面板', exact: true }).click()
      await expect(page.locator('#wb-inspector')).toHaveCount(0)
      await openActions()
      expect((await currentState(metadata)).poseDigest).toBe(before.poseDigest)
    })
    await operation(
      'mouse-keyboard-view-reset',
      'Canvas drag/wheel + arrows/zoom/Home',
      async () => {
        await observeWithMouse(page, round)
        await page.getByRole('group', { name: '商品展示区', exact: true }).focus()
        for (const key of ['ArrowUp', 'ArrowDown', '+', '-', 'Home']) await page.keyboard.press(key)
        await page.getByRole('button', { name: '复位视角', exact: true }).click()
        await page.waitForTimeout(850)
        const state = await currentState(metadata)
        expect(state.poseDigest).toBe(initial.poseDigest)
        near(state.camera, initial.camera, 1e-5)
        expect(state.sameCanvas && state.sameRenderer).toBe(true)
      },
    )
    await operation('restore-product', 'Reset current product through visitor UI', async () => {
      await page.getByRole('button', { name: '还原商品', exact: true }).click()
      await page.waitForTimeout(850)
      const state = await currentState(metadata)
      expect(state.poseDigest).toBe(initial.poseDigest)
      expect(state.identityDigest).toBe(initial.identityDigest)
      expect(state.rootId).toBe(initial.rootId)
      near(state.camera, initial.camera, 1e-5)
      for (const [name, node] of Object.entries(initial.nodes))
        expect(state.nodes[name].id).toBe(node.id)
    })
  }

  stage = 'warmup'
  currentSlug = products[0].product.slug
  await page.goto(base + '/?product=' + currentSlug, {
    waitUntil: 'domcontentloaded',
    timeout: 90000,
  })
  let initial = await ready(page, products[0], { remember: true })
  report.device = initial.device
  await trackLifecycle(page)
  // Warm every registered adapter, action pose and material variant before allocating baselines.
  for (const [index, metadata] of products.entries()) {
    if (index) initial = await visit(metadata)
    await exercise(metadata, initial, index)
    report.warmup.push(compactSnapshot(await currentState(metadata)))
    console.log(JSON.stringify({ event: 'demo-joint-warmed', slug: metadata.product.slug }))
  }
  stage = 'baseline'
  for (const metadata of products) {
    initial = await visit(metadata)
    await exercise(metadata, initial, 0)
    const warmed = await currentState(metadata)
    baseline.set(metadata.product.slug, {
      ...initial,
      renderer: Object.fromEntries(
        Object.entries(initial.renderer).map(([key, value]) => [
          key,
          typeof value === 'number' ? Math.max(value, warmed.renderer[key]) : value,
        ]),
      ),
    })
    report.baseline[metadata.product.slug] = compactSnapshot(baseline.get(metadata.product.slug))
  }
  await writeFile(output + '/baseline.json', JSON.stringify(report.baseline, null, 2) + '\n')

  stage = 'required-switches'
  interactiveStart = performance.now()
  report.interactiveStartedAt = new Date().toISOString()
  for (let cycle = 0; cycle < cycles; cycle++)
    for (const metadata of products) {
      initial = await visit(metadata, true)
      await exercise(metadata, initial, cycle)
      progress()
    }
  report.requiredSwitchesCompletedAt = new Date().toISOString()
  report.requiredSwitchesElapsedMs = Math.round(elapsed())
  stage = 'continued-interaction'
  let continued = 0
  // Continue switching all three products; every round performs the same real visitor operations.
  while (elapsed() < durationSeconds * 1000) {
    const metadata = products[continued % products.length]
    initial = await visit(metadata, true)
    await exercise(metadata, initial, cycles + continued)
    continued++
    progress()
  }

  stage = 'page-lifecycle'
  const metadata = products.find((entry) => entry.product.slug === currentSlug),
    action = primary(metadata)
  await operation(
    'visibility-lifecycle',
    'Synthetic visibility event on the actual page/scene',
    async () => {
      await clickTarget(metadata, action, 1)
      await expect.poll(async () => (await motionState(action))?.progress).toBeGreaterThan(0.01)
      await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', {
          configurable: true,
          get: () => 'hidden',
        })
        document.dispatchEvent(new Event('visibilitychange'))
      })
      const hidden = await paused(metadata, action)
      await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', {
          configurable: true,
          get: () => 'visible',
        })
        document.dispatchEvent(new Event('visibilitychange'))
      })
      const visible = await paused(metadata, action)
      expect(visible.poseDigest).toBe(hidden.poseDigest)
      expect(visible.motion).toEqual(hidden.motion)
      expect(visible.sameCanvas && visible.sameRenderer).toBe(true)
      report.visibility.push({
        slug: currentSlug,
        hidden: compactSnapshot(hidden),
        visible: compactSnapshot(visible),
        syntheticVisibilityEvent: true,
      })
      await page.evaluate(() => {
        delete document.visibilityState
        document.dispatchEvent(new Event('visibilitychange'))
      })
      await operation(
        'real-webgl-context-recovery',
        'Actual WebGL context loss and restored paused scene',
        async () => {
          await page.evaluate(() => {
            const extension = window.__demo.scene.renderer.instance
              .getContext()
              .getExtension('WEBGL_lose_context')
            if (!extension) throw new Error('Actual WebGL context-loss extension unavailable')
            window.__demoLoss = extension
            extension.loseContext()
          })
          await expect(page.locator('.workbench')).toHaveAttribute('data-status', 'error')
          await page.waitForTimeout(250)
          expect(
            await page.evaluate(
              () =>
                window.__demo.scene.scene.value.children.filter(
                  (node) => node.userData.workbenchProduct,
                ).length,
            ),
          ).toBe(0)
          await page.evaluate(() => window.__demoLoss.restoreContext())
          const recovered = await ready(page, metadata)
          expect(recovered.poseDigest).toBe(hidden.poseDigest)
          expect(recovered.motion).toEqual(hidden.motion)
          expect(recovered.sameCanvas && recovered.sameRenderer).toBe(true)
          await validateLifecycle()
          report.contextRecovery.push({
            slug: currentSlug,
            before: compactSnapshot(hidden),
            recovered: compactSnapshot(recovered),
            actualContextLoss: true,
          })
          await page.evaluate(() => delete window.__demoLoss)
        },
      )
      await page.getByRole('button', { name: '复原动作', exact: true }).click()
    },
  )
  await validateLifecycle()
  report.interactiveElapsedMs = Math.round(elapsed())
  report.completedAt = new Date().toISOString()
  report.visitsBySlug = Object.fromEntries(
    slugs.map((slug) => [slug, report.visits.filter((visit) => visit.slug === slug).length]),
  )
  report.operationKinds = [
    ...new Set(
      report.operations
        .filter((entry) => entry.stage !== 'warmup' && entry.stage !== 'baseline')
        .map((entry) => entry.kind),
    ),
  ]
  expect(report.visits.length).toBeGreaterThanOrEqual(cycles * slugs.length)
  for (const slug of slugs) expect(report.visitsBySlug[slug]).toBeGreaterThanOrEqual(cycles)
  expect(report.interactiveElapsedMs).toBeGreaterThanOrEqual(durationSeconds * 1000)
  expect(report.operations.every((entry) => Boolean(entry.completedAt))).toBe(true)
  const operational = report.operations.filter((entry) =>
    ['required-switches', 'continued-interaction'].includes(entry.stage),
  )
  report.operationTiming = {
    completed: operational.length,
    firstStartMs: operational[0].startMs,
    lastEndMs: operational.at(-1).endMs,
    maxGapBetweenOperationsMs: Math.max(
      0,
      ...operational.slice(1).map((entry, index) => entry.startMs - operational[index].endMs),
    ),
    activeOperationMs: operational.reduce((sum, entry) => sum + entry.endMs - entry.startMs, 0),
  }
  expect(
    report.operationTiming.lastEndMs - report.operationTiming.firstStartMs,
  ).toBeGreaterThanOrEqual(durationSeconds * 1000)
  expect(report.errors).toEqual([])
  expect(report.failedRequests).toEqual([])
  expect([...report.requestOrigins]).toEqual([new URL(base).origin])
  report.passed = true
  report.formalAcceptance = !smoke
  stage = 'complete'
  progress()
} catch (error) {
  report.failure = String(error)
  if (page && !page.isClosed())
    await page.screenshot({ path: output + '/failure.png' }).catch(() => {})
  throw error
} finally {
  if (heartbeat) clearInterval(heartbeat)
  if (browser) await browser.close()
  report.requestOrigins = [...report.requestOrigins]
  await writeFile(output + '/report.json', JSON.stringify(report, null, 2) + '\n')
}
console.log(
  JSON.stringify({
    passed: report.passed,
    formalAcceptance: report.formalAcceptance,
    smoke,
    visits: report.visits.length,
    durationMs: report.interactiveElapsedMs,
    output,
  }),
)
