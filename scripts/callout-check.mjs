/* global fetch, URL, getComputedStyle */
import { chromium, expect } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'

const base = process.env.CHECK_URL || 'http://127.0.0.1:5181'
const output = process.env.CALLOUT_CHECK_OUTPUT || 'artifacts/callouts'
const report = { passed: false, checks: [], captures: [], states: {}, errors: [], requests: [] }
const definitions = [
  { slug: 'typewriter-study', expand: '分层展开', collapse: '合拢整机' },
  { slug: 'piano-cfx', expand: '剖切', collapse: '整机' },
  { slug: 'reventon', expand: '展开部件', collapse: '合拢部件' },
]
const chapters = [
  '整机',
  '剖切',
  '键盘',
  '击弦机构',
  '弦列与铁板',
  '音板与弦桥',
  '制音器与踏板',
  '全部平铺',
]
await mkdir(output + '/visual', { recursive: true })
const browser = await chromium.launch({ channel: 'msedge', headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  page.setDefaultTimeout(30000)
  page.on('pageerror', (error) => report.errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') report.errors.push(message.text())
  })
  page.on('request', (request) => report.requests.push(request.url()))

  const ready = async (slug) => {
    await expect(page.locator('.workbench')).toHaveAttribute('data-slug', slug, { timeout: 120000 })
    await expect(page.locator('.workbench')).toHaveAttribute('data-status', 'ready', {
      timeout: 120000,
    })
    await expect(page.locator('canvas')).toHaveCount(1)
    await page.evaluate(() => {
      let component = document.querySelector('canvas').__vueParentComponent
      let scene
      while (component) {
        const values = Reflect.ownKeys(component.provides ?? {}).map(
          (key) => component.provides[key],
        )
        scene ??= component.exposed?.context ?? values.find((value) => value?.scene?.value?.isScene)
        component = component.parent
      }
      if (!scene) throw new Error('Actual Three context unavailable')
      window.__calloutScene = scene
    })
    expect(
      await page.evaluate(() =>
        window.__calloutScene.scene.value.children
          .filter((node) => node.userData.workbenchProduct)
          .map((node) => node.userData.workbenchProduct),
      ),
    ).toEqual([slug])
  }
  const go = async (slug) => {
    await page.goto(base + '/?product=' + slug, { waitUntil: 'domcontentloaded', timeout: 90000 })
    await ready(slug)
  }
  const openActions = async () => {
    if (
      !(
        await page
          .getByRole('button', { name: '结构与动作', exact: true })
          .getAttribute('aria-pressed')
      )?.includes('true')
    )
      await page.getByRole('button', { name: '结构与动作', exact: true }).click()
    await expect(page.locator('.wb-panel-content')).toBeVisible()
  }
  const closePanel = async () => {
    const close = page.getByRole('button', { name: '收起面板', exact: true })
    if (await close.isVisible()) await close.click()
    await page.waitForTimeout(400)
  }
  const snapshot = () =>
    page.evaluate(() => {
      const rect = (element) => {
        const value = element.getBoundingClientRect()
        return { x: value.x, y: value.y, width: value.width, height: value.height }
      }
      const blockers = [
        ...document.querySelectorAll('.wb-tools,.wb-intro,.wb-rail,.wb-panel,.wb-header'),
      ]
        .filter((element) => getComputedStyle(element).display !== 'none')
        .map((element) => ({ className: element.className, rect: rect(element) }))
      const labels = [...document.querySelectorAll('button.wb-hotspot')].map((element) => {
        const id = element.dataset.part
        const path = [...document.querySelectorAll('.wb-callout-lines path[data-part]')].find(
          (entry) => entry.dataset.part === id,
        )
        const style = getComputedStyle(element)
        return {
          id,
          name: element.textContent.trim(),
          hidden: element.hidden,
          layoutVisible: element.dataset.layoutVisible,
          visibility: style.visibility,
          opacity: Number(style.opacity),
          pressed: element.getAttribute('aria-pressed'),
          rect: rect(element),
          path: path?.getAttribute('d') ?? '',
          pathOpacity: path ? Number(getComputedStyle(path).opacity) : 0,
          circle: Boolean(
            [...document.querySelectorAll('.wb-callout-lines circle')].find(
              (entry) => entry.dataset.part === id,
            ),
          ),
        }
      })
      return {
        expanded: document.querySelector('.wb-hotspots')?.dataset.expanded,
        labels,
        blockers,
        canvasCount: document.querySelectorAll('canvas').length,
        camera: window.__calloutScene.camera.activeCamera.value.position.toArray(),
        width: innerWidth,
        time: window.performance.now(),
      }
    })
  const visible = (state) =>
    state.labels.filter(
      (label) =>
        !label.hidden &&
        label.visibility !== 'hidden' &&
        label.layoutVisible === 'true' &&
        label.opacity > 0.95,
    )
  const overlap = (a, b) =>
    Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > 0.5 &&
    Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > 0.5
  const validate = async (name, { multiple = true } = {}) => {
    await page.waitForTimeout(500)
    const state = await snapshot()
    const labels = visible(state)
    expect(state.canvasCount).toBe(1)
    if (multiple) expect(labels.length, name + ': useful structural labels').toBeGreaterThan(1)
    for (const label of labels) {
      expect(label.id, name + ': stable part identifier').toBeTruthy()
      expect(label.path, name + ': leader path for ' + label.id).toMatch(/^M/)
      expect(label.path).not.toMatch(/NaN|Infinity/)
      expect(label.rect.x, name + ': left viewport boundary').toBeGreaterThanOrEqual(-1)
      expect(
        label.rect.x + label.rect.width,
        name + ': right viewport boundary',
      ).toBeLessThanOrEqual(state.width + 1)
      for (const blocker of state.blockers)
        expect(overlap(label.rect, blocker.rect), name + ': avoids ' + blocker.className).toBe(
          false,
        )
    }
    for (let first = 0; first < labels.length; first++)
      for (let second = first + 1; second < labels.length; second++)
        expect(
          overlap(labels[first].rect, labels[second].rect),
          name + ': ' + labels[first].name + ' / ' + labels[second].name,
        ).toBe(false)
    report.states[name] = state
    return state
  }
  const capture = async (name) => {
    await page.evaluate(() => document.fonts.ready)
    await page.mouse.move(1, 1)
    await page.screenshot({ path: output + '/visual/' + name + '.png', fullPage: true })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    report.captures.push(name)
  }
  const startFadeRecording = () =>
    page.evaluate(() => {
      window.__calloutFade = []
      window.__calloutFadeTimer = window.setInterval(() => {
        window.__calloutFade.push(
          [...document.querySelectorAll('button.wb-hotspot')].map((element) => ({
            opacity: Number(getComputedStyle(element).opacity),
            hidden: element.hidden,
          })),
        )
      }, 16)
    })
  const stopFadeRecording = () =>
    page.evaluate(() => {
      window.clearInterval(window.__calloutFadeTimer)
      return window.__calloutFade
    })
  const startTransitionRecording = () =>
    page.evaluate(() => {
      window.__calloutTransition = { samples: 0, activeSamples: 0, collisions: [] }
      window.__calloutTransitionTimer = window.setInterval(() => {
        const active = [...document.querySelectorAll('button.wb-hotspot')]
          .filter((element) => {
            const style = getComputedStyle(element)
            return !element.hidden && style.visibility !== 'hidden' && Number(style.opacity) > 0.5
          })
          .map((element) => ({ id: element.dataset.part, rect: element.getBoundingClientRect() }))
        const state = window.__calloutTransition
        state.samples++
        if (active.length > 1) state.activeSamples++
        for (let first = 0; first < active.length; first++)
          for (let second = first + 1; second < active.length; second++) {
            const a = active[first].rect,
              b = active[second].rect
            if (
              Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 &&
              Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5
            )
              state.collisions.push({
                time: window.performance.now(),
                first: active[first].id,
                second: active[second].id,
                a: { x: a.x, y: a.y, width: a.width, height: a.height },
                b: { x: b.x, y: b.y, width: b.width, height: b.height },
              })
          }
      }, 16)
    })
  const stopTransitionRecording = () =>
    page.evaluate(() => {
      window.clearInterval(window.__calloutTransitionTimer)
      return window.__calloutTransition
    })
  const startOrbitRecording = () =>
    page.evaluate(() => {
      window.__calloutOrbit = []
      const record = () => {
        window.__calloutOrbit.push({
          time: window.performance.now(),
          labels: [...document.querySelectorAll('button.wb-hotspot')].map((element) => {
            const style = getComputedStyle(element),
              rect = element.getBoundingClientRect()
            return {
              id: element.dataset.part,
              hidden: element.hidden,
              visibility: style.visibility,
              layoutVisible: element.dataset.layoutVisible,
              opacity: Number(style.opacity),
              rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
            }
          }),
        })
        window.__calloutOrbitFrame = window.requestAnimationFrame(record)
      }
      record()
    })
  const stopOrbitRecording = () =>
    page.evaluate(() => {
      window.cancelAnimationFrame(window.__calloutOrbitFrame)
      return window.__calloutOrbit
    })
  const expand = async (definition) => {
    await openActions()
    await page.getByRole('button', { name: definition.expand, exact: true }).click()
    await expect(page.locator('.wb-hotspots')).toHaveAttribute('data-expanded', 'true', {
      timeout: 30000,
    })
    if (definition.slug !== 'reventon')
      await expect(
        page.getByRole('button', { name: definition.expand, exact: true }),
      ).toHaveAttribute('aria-pressed', 'true', { timeout: 30000 })
    else await page.waitForTimeout(900)
    await page.waitForTimeout(500)
  }

  // Normal motion: observe actual intermediate opacity, not only two screenshots.
  for (const definition of definitions) {
    await go(definition.slug)
    await openActions()
    await startTransitionRecording()
    await startFadeRecording()
    await expand(definition)
    const fadeIn = await stopFadeRecording()
    report.states[definition.slug + '-fade-in'] = fadeIn
    expect(
      fadeIn.some((frame) =>
        frame.some((label) => !label.hidden && label.opacity > 0.01 && label.opacity < 0.99),
      ),
      definition.slug + ': gradual entrance opacity',
    ).toBe(true)
    await closePanel()
    const settled = await validate(definition.slug + '-expanded')
    expect(settled.expanded).toBe('true')
    const canvas = await page.evaluate(() => {
      window.__calloutCanvas = document.querySelector('canvas')
      window.__calloutRenderer = window.__calloutScene.renderer.instance
      return Boolean(window.__calloutCanvas)
    })
    expect(canvas).toBe(true)
    const beforeOrbit = visible(settled)
    await page.locator('.wb-stage').focus()
    await startOrbitRecording()
    await page.keyboard.press('ArrowRight')
    await page.waitForTimeout(650)
    const samples = await stopOrbitRecording()
    report.states[definition.slug + '-orbit-samples'] = samples
    const afterOrbit = await validate(definition.slug + '-orbit')
    expect(afterOrbit.camera).not.toEqual(settled.camera)
    const changed = beforeOrbit.some((start) =>
      afterOrbit.labels.some((end) => end.id === start.id && end.path !== start.path),
    )
    expect(changed, definition.slug + ': anchor/line follows actual orbit').toBe(true)
    // Sample inside the page's RAF clock. A safe straight route damps through intermediate
    // coordinates; an obstructed route fades out, relocates while faint, then fades in.
    const intermediate = beforeOrbit.some((start) => {
      const end = visible(afterOrbit).find((entry) => entry.id === start.id)
      if (!end || Math.hypot(end.rect.x - start.rect.x, end.rect.y - start.rect.y) < 6) return false
      return samples.some((sample) => {
        const label = sample.labels.find((entry) => entry.id === start.id)
        return (
          label &&
          !label.hidden &&
          label.visibility !== 'hidden' &&
          label.opacity > 0.5 &&
          Math.hypot(label.rect.x - start.rect.x, label.rect.y - start.rect.y) > 0.5 &&
          Math.hypot(label.rect.x - end.rect.x, label.rect.y - end.rect.y) > 0.5
        )
      })
    })
    const crossFade = beforeOrbit.some((start) => {
      const end = visible(afterOrbit).find((entry) => entry.id === start.id)
      if (!end || Math.hypot(end.rect.x - start.rect.x, end.rect.y - start.rect.y) < 6) return false
      const frames = samples.map((sample) => sample.labels.find((label) => label.id === start.id))
      const fading = frames.findIndex(
        (label) => label && !label.hidden && label.opacity > 0.01 && label.opacity < 0.95,
      )
      if (fading < 0) return false
      const relocated = frames.findIndex(
        (label, index) =>
          index > fading &&
          label &&
          label.opacity <= 0.5 &&
          Math.hypot(label.rect.x - start.rect.x, label.rect.y - start.rect.y) > 6,
      )
      if (relocated < 0) return false
      return frames.some(
        (label, index) =>
          index > relocated &&
          label &&
          !label.hidden &&
          label.visibility !== 'hidden' &&
          label.opacity > frames[relocated].opacity + 0.05 &&
          label.opacity < 0.99 &&
          Math.hypot(label.rect.x - start.rect.x, label.rect.y - start.rect.y) > 6,
      )
    })
    report.states[definition.slug + '-orbit-proof'] = { intermediate, crossFade }
    expect(
      intermediate || crossFade,
      definition.slug + ': real RAF evidence of smooth movement or fade/relocate/fade sequence',
    ).toBe(true)
    await openActions()
    await startFadeRecording()
    await page.getByRole('button', { name: definition.collapse, exact: true }).click()
    await expect(page.locator('.wb-hotspots')).toHaveAttribute('data-expanded', 'false', {
      timeout: 30000,
    })
    await page.waitForTimeout(500)
    const fadeOut = await stopFadeRecording()
    report.states[definition.slug + '-fade-out'] = fadeOut
    expect(
      fadeOut.some((frame) =>
        frame.some((label) => !label.hidden && label.opacity > 0.01 && label.opacity < 0.99),
      ),
      definition.slug + ': gradual exit opacity',
    ).toBe(true)
    await closePanel()
    expect(visible(await snapshot())).toHaveLength(0)
    const transition = await stopTransitionRecording()
    report.states[definition.slug + '-transition-collisions'] = transition
    expect(
      transition.activeSamples,
      definition.slug + ': sampled active transition labels',
    ).toBeGreaterThan(0)
    expect(
      transition.collisions,
      definition.slug + ': alpha > 0.5 labels never overlap during fade/orbit/relocation',
    ).toEqual([])
    expect(
      await page.evaluate(
        () =>
          document.querySelector('canvas') === window.__calloutCanvas &&
          window.__calloutScene.renderer.instance === window.__calloutRenderer,
      ),
    ).toBe(true)
    report.checks.push(
      definition.slug +
        ': pose-driven fade in/out, close-panel persistence, smooth real-camera following, no active transition collisions, one renderer',
    )
  }

  // A single bounded screenshot batch: all products/sizes, their selected state and source chapters.
  await page.emulateMedia({ reducedMotion: 'reduce' })
  for (const definition of definitions) {
    await page.setViewportSize({ width: 1440, height: 1000 })
    await go(definition.slug)
    await expand(definition)
    await closePanel()
    for (const [width, height] of [
      [1280, 720],
      [1440, 1000],
      [1920, 1080],
      [390, 844],
      [320, 760],
    ]) {
      await page.setViewportSize({ width, height })
      await validate(definition.slug + '-' + width, { multiple: width >= 1024 })
      await capture(definition.slug + '-' + width)
    }
    await page.setViewportSize({ width: 1440, height: 1000 })
    const labels = visible(await validate(definition.slug + '-before-selection'))
    const selected = labels[0]
    await page.locator('button.wb-hotspot[data-part="' + selected.id + '"]').click()
    await expect(
      page.locator('button.wb-hotspot[data-part="' + selected.id + '"]'),
    ).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('.wb-part-copy')).toBeVisible()
    await closePanel()
    const focusState = await validate(definition.slug + '-selected', { multiple: false })
    expect(
      visible(focusState).some((label) => label.id === selected.id && label.pressed === 'true'),
    ).toBe(true)
    await capture(definition.slug + '-selected')
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 760 })
      const small = await validate(definition.slug + '-selected-' + width, { multiple: false })
      expect(
        visible(small).some((label) => label.id === selected.id && label.pressed === 'true'),
      ).toBe(true)
    }
    report.checks.push(
      definition.slug +
        ': desktop/mobile non-overlap, toolbar/intro avoidance, clicked selection survives capacity suppression',
    )
  }

  await page.setViewportSize({ width: 1440, height: 1000 })
  await go('piano-cfx')
  await openActions()
  for (let index = 0; index < chapters.length; index++) {
    await page
      .locator('.wb-piano-chapters')
      .getByRole('button', { name: chapters[index], exact: true })
      .click()
    await expect(
      page
        .locator('.wb-piano-chapters')
        .getByRole('button', { name: chapters[index], exact: true }),
    ).toHaveAttribute('aria-pressed', 'true')
    await page.locator('.wb-piano-view').click()
    await closePanel()
    const chapterState = await validate('piano-chapter-' + index, { multiple: index > 0 })
    expect(chapterState.expanded).toBe(index === 0 ? 'false' : 'true')
    await capture('piano-chapter-' + index)
    await openActions()
  }
  await go('typewriter-study')
  await openActions()
  await page.getByRole('button', { name: '平铺部件', exact: true }).click()
  await expect(page.getByRole('button', { name: '平铺部件', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await page.getByRole('button', { name: '平铺俯视', exact: true }).click()
  await closePanel()
  await validate('typewriter-flat')
  await capture('typewriter-flat')
  report.checks.push(
    'All 8 piano chapters and typewriter flat layout keep current semantic anchors and readable sparse labels',
  )

  const catalog = await (await fetch(base + '/api/v1/products')).json()
  const configurations = Object.fromEntries(
    await Promise.all(
      catalog.map(async (product) => [
        product.slug,
        (await (await fetch(base + '/api/v1/products/' + product.slug)).json()).presentation,
      ]),
    ),
  )
  const selectCatalog = async (slug) => {
    await page.getByRole('button', { name: '商品目录', exact: true }).click()
    await page
      .locator('.wb-catalog-list')
      .getByRole('button', { name: new RegExp(catalog.find((entry) => entry.slug === slug).name) })
      .click()
  }
  // The selected node need not be a sparse marker. A restored controller must still project it.
  await selectCatalog('piano-cfx')
  await ready('piano-cfx')
  await expand(definitions[1])
  await page.getByRole('button', { name: '细节', exact: true }).click()
  const nonMarker = configurations['piano-cfx'].hotspots.find((part) => part.marker === false)
  expect(nonMarker, 'Actual piano has a non-marker semantic part').toBeTruthy()
  await page.locator('#wb-parts-query').fill(nonMarker.id)
  await page
    .locator('.wb-part-list')
    .getByRole('button', { name: nonMarker.name, exact: true })
    .click()
  await closePanel()
  const selectedLabel = page.locator('button.wb-hotspot[data-part="' + nonMarker.id + '"]')
  await expect(selectedLabel).toHaveAttribute('aria-pressed', 'true')
  const selectedBeforeLoss = await validate('piano-non-marker-before-loss', { multiple: false })
  expect(visible(selectedBeforeLoss).some((label) => label.id === nonMarker.id)).toBe(true)
  await page.evaluate(() => {
    window.__calloutCanvas = document.querySelector('canvas')
    window.__calloutRenderer = window.__calloutScene.renderer.instance
    window.__calloutLoss = window.__calloutRenderer.getContext().getExtension('WEBGL_lose_context')
    if (!window.__calloutLoss) throw new Error('Actual WebGL loss extension unavailable')
    window.__calloutLoss.loseContext()
  })
  await expect(page.locator('.workbench')).toHaveAttribute('data-status', 'error')
  await expect(page.locator('.wb-hotspots')).toHaveCount(0)
  await page.waitForTimeout(250)
  await page.evaluate(() => window.__calloutLoss.restoreContext())
  await ready('piano-cfx')
  await expect(selectedLabel).toHaveAttribute('aria-pressed', 'true')
  const restored = await validate('piano-non-marker-restored', { multiple: false })
  expect(restored.expanded).toBe('true')
  expect(
    visible(restored).some((label) => label.id === nonMarker.id && label.pressed === 'true'),
    'Restored scene projects the selected non-marker node with a visible leader label',
  ).toBe(true)
  expect(
    await page.evaluate(
      () =>
        document.querySelector('canvas') === window.__calloutCanvas &&
        window.__calloutScene.renderer.instance === window.__calloutRenderer,
    ),
  ).toBe(true)
  report.checks.push(
    'Real WebGL loss/recovery restores selected non-marker label and current structure on the same Canvas/renderer',
  )
  // Fast client-side selection must discard old labels without recreating the Canvas.
  await page.evaluate(() => {
    window.__calloutCanvas = document.querySelector('canvas')
    window.__calloutRenderer = window.__calloutScene.renderer.instance
  })
  await selectCatalog('piano-cfx')
  await selectCatalog('reventon')
  await ready('reventon')
  await page.getByRole('button', { name: '细节', exact: true }).click()
  await page.waitForTimeout(500)
  const finalState = await snapshot()
  const currentIds = configurations.reventon.hotspots.map((part) => part.id)
  expect(finalState.labels.every((label) => currentIds.includes(label.id))).toBe(true)
  expect(
    await page.evaluate(
      () =>
        document.querySelector('canvas') === window.__calloutCanvas &&
        window.__calloutScene.renderer.instance === window.__calloutRenderer,
    ),
  ).toBe(true)
  report.checks.push(
    'Rapid directory switching removes old product labels and retains original Canvas/renderer',
  )
  expect(
    report.requests
      .filter((url) => /^https?:/.test(url))
      .every((url) => new URL(url).origin === new URL(base).origin),
  ).toBe(true)
  expect(report.errors).toEqual([])
  report.passed = true
} catch (error) {
  report.errors.push(error instanceof Error ? error.message : String(error))
  throw error
} finally {
  await browser.close()
  await writeFile(output + '/report.json', JSON.stringify(report, null, 2) + '\n')
}
console.log(
  JSON.stringify({
    passed: report.passed,
    checks: report.checks,
    captures: report.captures,
    errors: report.errors,
  }),
)
