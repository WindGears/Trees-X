/* global fetch */
import { chromium, expect } from '@playwright/test'
import { mkdir, readFile, writeFile } from 'node:fs/promises'

const base = process.env.CHECK_URL || 'http://127.0.0.1:5181'
const current = await (await fetch(base + '/api/v1/products/typewriter-study')).json()
if (current.presentation?.source.adapter === 'typewriter-v1') {
  await import('./typewriter-lifecycle-check.mjs')
  process.exit(0)
}
const output = 'artifacts/progress/browser'
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const report = {
  scope: 'v3 procedural cases, real Spring Boot/MySQL, actual Three poses and pixels',
  errors: [],
  checks: [],
  captures: [],
  pixels: [],
  hotspots: [],
  passed: false,
}
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  page.on('pageerror', (e) => report.errors.push(e.message))
  async function ready(slug) {
    await expect(page.locator('.workbench')).toHaveAttribute('data-slug', slug)
    await expect(page.locator('.workbench')).toHaveAttribute('data-status', 'ready', {
      timeout: 30000,
    })
    await expect(page.locator('canvas')).toHaveCount(1)
    return page.evaluate(() => {
      let c = document.querySelector('canvas').__vueParentComponent
      while (c) {
        const context =
          c.exposed?.context ??
          Reflect.ownKeys(c.provides ?? {})
            .map((k) => c.provides[k])
            .find((v) => v?.scene?.value?.isScene)
        if (context) {
          window.__progressContext = context
          const roots = context.scene.value.children.filter((n) => n.userData.workbenchProduct)
          if (roots.length !== 1) throw new Error('Multiple model roots')
          return roots[0].userData.workbenchProduct
        }
        c = c.parent
      }
      throw new Error('Missing Three context')
    })
  }
  async function select(name, slug) {
    await page.getByRole('button', { name: '商品目录', exact: true }).click()
    await page.locator('.wb-catalog-list button').filter({ hasText: name }).click()
    expect(await ready(slug)).toBe(slug)
  }
  const pose = () =>
    page.evaluate(() => {
      const ctx = window.__progressContext,
        root = ctx.scene.value.children.find((n) => n.userData.workbenchProduct),
        nodes = {}
      root.traverse((n) => {
        if (n.name)
          nodes[n.name] = { position: n.position.toArray(), quaternion: n.quaternion.toArray() }
      })
      return { nodes, camera: ctx.camera.activeCamera.value.position.toArray() }
    })
  const control = () => page.locator('.wb-progress')
  const percentage = async () =>
    Number((await control().locator('output').textContent()).replace('%', ''))
  const seek = async (value) => {
    await control()
      .locator('input')
      .evaluate((input, value) => {
        input.value = String(value)
        input.dispatchEvent(new Event('input', { bubbles: true }))
      }, value)
    await expect(control().locator('output')).toHaveText(value.toFixed(1) + '%')
  }
  const stable = async () => {
    const state = await pose(),
      progress = await percentage()
    await page.waitForTimeout(200)
    expect((await pose()).nodes).toEqual(state.nodes)
    expect(await percentage()).toBe(progress)
    return state
  }
  async function start(label) {
    if (['展开', '打开'].includes(label) && (await percentage()) > 75) await seek(20)
    if (['合拢', '关闭'].includes(label) && (await percentage()) < 25) await seek(80)
    await control().getByRole('button', { name: label, exact: true }).click()
    await expect(control().getByRole('button', { name: '暂停', exact: true })).toBeVisible()
    await page.waitForTimeout(120)
  }
  async function capture(name) {
    await page.screenshot({ path: output + '/' + name + '.png' })
    report.captures.push(name)
  }
  async function anchor(node, local, name) {
    await page.waitForTimeout(100)
    const result = await page.evaluate(
      ({ node, local, name }) => {
        const c = window.__progressContext,
          root = c.scene.value.children.find((n) => n.userData.workbenchProduct),
          part = root.getObjectByName(node)
        const expected = part
          .localToWorld(part.position.clone().fromArray(local))
          .project(c.camera.activeCamera.value)
        const canvas = document.querySelector('canvas'),
          label = [...document.querySelectorAll('.wb-hotspot')].find((e) =>
            e.textContent.includes(name),
          )
        const xy = {
          x: (expected.x * 0.5 + 0.5) * canvas.clientWidth,
          y: (-expected.y * 0.5 + 0.5) * canvas.clientHeight,
        }
        const line = [...document.querySelectorAll('.wb-callout-lines path[data-part]')].find(
          (path) => path.dataset.part === label?.dataset.part,
        )
        const coordinates = line
          ?.getAttribute('d')
          ?.match(/[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/gi)
        if (!coordinates || coordinates.length < 2)
          throw new Error('Missing real callout leader for ' + name)
        const actual = { x: Number(coordinates[0]), y: Number(coordinates[1]) }
        return {
          node,
          expected: xy,
          actual,
          error: Math.max(Math.abs(actual.x - xy.x), Math.abs(actual.y - xy.y)),
        }
      },
      { node, local, name },
    )
    expect(result.error).toBeLessThanOrEqual(1)
    report.hotspots.push(result)
  }
  await page.goto(base + '/?product=form-01')
  expect(await ready('form-01')).toBe('form-01')
  await page.evaluate(() => {
    window.__persistentCanvas = document.querySelector('canvas')
    window.__persistentRenderer = window.__progressContext.renderer.instance
  })
  await page.getByRole('button', { name: '结构与动作', exact: true }).click()
  const initial = await pose()
  expect(await percentage()).toBe(0)
  await seek(43.7)
  expect((await pose()).nodes.front.position[2]).toBeCloseTo(
    initial.nodes.front.position[2] + (0.65 * 0.437) / 0.55,
    10,
  )
  await anchor('driver', [0, 0, 0.2], '扬声器')
  await page.locator('.wb-action-list > button').first().click()
  await page.waitForTimeout(650)
  expect((await pose()).nodes.knob.quaternion).not.toEqual(initial.nodes.knob.quaternion)
  await control()
    .getByRole('button', { name: /复原动作/ })
    .click()
  expect((await pose()).nodes.knob.quaternion).not.toEqual(initial.nodes.knob.quaternion)
  expect((await pose()).nodes.front).toEqual(initial.nodes.front)
  await start('展开')
  await control().getByRole('button', { name: '暂停', exact: true }).click()
  await stable()
  await control().getByRole('button', { name: '继续', exact: true }).click()
  await seek(52.4)
  await stable()
  await start('展开')
  const bounds = await page.locator('canvas').boundingBox()
  await page.mouse.move(bounds.x + bounds.width * 0.8, bounds.y + bounds.height * 0.5)
  await page.mouse.down()
  await page.mouse.move(bounds.x + bounds.width * 0.68, bounds.y + bounds.height * 0.45, {
    steps: 5,
  })
  await page.mouse.up()
  await stable()
  await capture('speaker-drag-takeover')
  await start('展开')
  await page.mouse.move(bounds.x + bounds.width * 0.8, bounds.y + bounds.height * 0.5)
  await page.mouse.wheel(0, 100)
  await stable()
  await start('展开')
  await page.getByRole('button', { name: '复位视角', exact: true }).click()
  await stable()
  await start('展开')
  await page.getByLabel('观察视角', { exact: true }).selectOption('front')
  await stable()
  await start('展开')
  await page.getByRole('group', { name: '商品展示区', exact: true }).focus()
  await page.keyboard.press('ArrowLeft')
  await stable()
  await start('展开')
  await page.getByRole('button', { name: '细节', exact: true }).click()
  await page.locator('.wb-part-list button').first().click()
  await page.getByRole('button', { name: '结构与动作', exact: true }).click()
  await stable()
  await seek(50)
  await start('展开')
  await page.getByRole('button', { name: '收起面板', exact: true }).click()
  await page.waitForTimeout(1100)
  await page.getByRole('button', { name: '结构与动作', exact: true }).click()
  expect(await percentage()).toBe(100)
  await start('合拢')
  await seek(37.5)
  await stable()
  await control().getByRole('button', { name: '继续', exact: true }).click()
  await expect(control().locator('output')).toHaveText('0.0%', { timeout: 1500 })
  report.checks.push(
    'speaker: 0.1% seek, local parent/child anchor, independent knob/reset, play/pause/resume/reverse; drag/wheel/view/focus/keyboard pause; panel close preserves playback',
  )
  // Synthetic visibility events exercise the real document-visibility subscriber, without pretending to be a physical user test.
  await start('展开')
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await stable()
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await stable()
  await seek(43.7)
  await page.evaluate(() => {
    window.__loss = window.__persistentRenderer.getContext().getExtension('WEBGL_lose_context')
    window.__loss.loseContext()
  })
  await expect(page.locator('.workbench')).toHaveAttribute('data-status', 'error')
  await page.waitForTimeout(200)
  await page.evaluate(() => window.__loss.restoreContext())
  await ready('form-01')
  expect(await percentage()).toBe(43.7)
  await stable()
  report.checks.push(
    'visibility hidden pauses, visible never resumes (synthetic event); real WebGL loss/recovery restores 43.7% paused',
  )
  await page.getByRole('button', { name: '导览', exact: true }).click()
  await page.getByRole('button', { name: '开始导览', exact: true }).click()
  await page.getByRole('button', { name: '下一步', exact: true }).click()
  await page.getByRole('button', { name: '下一步', exact: true }).click()
  await page.getByRole('button', { name: '结构与动作', exact: true }).click()
  expect(await percentage()).toBe(70)
  await page.getByRole('button', { name: '细节', exact: true }).click()
  await page.getByRole('button', { name: '返回全景', exact: true }).click()
  await page.getByRole('button', { name: '结构与动作', exact: true }).click()
  expect(await percentage()).toBe(0)
  await select('汽车样板', 'reventon')
  await page.getByRole('button', { name: '结构与动作', exact: true }).click()
  const carBase = await pose()
  await seek(43.7)
  await page.getByRole('button', { name: '展开部件', exact: true }).click()
  await page.waitForTimeout(650)
  const combined = await pose()
  expect(combined.nodes['door-left'].position[0]).toBeCloseTo(
    carBase.nodes['door-left'].position[0] - 0.55,
    10,
  )
  expect(combined.nodes['door-left'].quaternion[0]).toBeCloseTo(Math.sin((-1.15 * 0.437) / 2), 10)
  await control()
    .getByRole('button', { name: /复原动作/ })
    .click()
  expect((await pose()).nodes['door-left'].position).toEqual(combined.nodes['door-left'].position)
  expect((await pose()).nodes['door-left'].quaternion).toEqual(
    carBase.nodes['door-left'].quaternion,
  )
  await seek(50)
  await anchor('door-left', [0, 0.45, -0.54], '车门')
  await start('打开')
  await page.getByRole('button', { name: '还原商品', exact: true }).click()
  expect(await percentage()).toBe(0)
  await page.waitForTimeout(650)
  await stable()
  expect((await pose()).nodes).toEqual(carBase.nodes)
  report.checks.push(
    'guide 70% inspection and overview reset; car door rotation + separation composition, action-only reset preserves separation, restore returns all poses',
  )
  for (const [slug, name, id] of [
    ['form-01', '桌面音箱', 'explore-layers'],
    ['reventon', '汽车样板', 'open-doors'],
  ]) {
    await select(name, slug)
    await page.getByRole('button', { name: '结构与动作', exact: true }).click()
    for (const width of [1280, 1440, 1920]) {
      await page.setViewportSize({
        width,
        height: width === 1280 ? 720 : width === 1440 ? 1000 : 1080,
      })
      let priorPixels
      for (const progress of width === 1440 ? [0, 50, 100] : [50]) {
        await seek(progress)
        if (width === 1440) {
          const pixels = await page.locator('canvas').screenshot({
            style: '.wb-hotspots,.wb-intro,.wb-tools,.wb-input-hint{visibility:hidden!important}',
          })
          if (priorPixels)
            expect(pixels.equals(priorPixels), 'progress must change actual canvas pixels').toBe(
              false,
            )
          priorPixels = pixels
          report.pixels.push({ slug, progress, canvasChanged: progress === 0 ? 'baseline' : true })
        }
        await capture(slug + '-' + width + '-' + progress)
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      )
    }
    expect(await control().getAttribute('data-motion-id')).toBe(id)
  }
  await page.setViewportSize({ width: 1440, height: 1000 })
  await start('关闭')
  await select('桌面音箱', 'form-01')
  await page.getByRole('button', { name: '结构与动作', exact: true }).click()
  expect(await percentage()).toBe(0)
  await page.waitForTimeout(500)
  expect(await percentage()).toBe(0)
  expect(
    await page.evaluate(
      () =>
        document.querySelector('canvas') === window.__persistentCanvas &&
        window.__progressContext.renderer.instance === window.__persistentRenderer,
    ),
  ).toBe(true)
  report.checks.push(
    'selection cancels old progress, initializes new product; one persistent Canvas/renderer',
  )
  // Old v1/v2 routes still bind their registered behaviors, including a real GLB fixture.
  const fixture = JSON.parse(
    await readFile('server/src/test/resources/fixtures/speaker-glb-v2.json', 'utf8'),
  )
  await select('机械打字机', 'typewriter-study')
  await page.route('**/api/v1/products/form-01', (route) => route.fulfill({ json: fixture }))
  await select('桌面音箱', 'form-01')
  await page.getByRole('button', { name: '结构与动作', exact: true }).click()
  expect(await control().count()).toBe(0)
  expect(
    await page.evaluate(
      () =>
        window.__progressContext.scene.value.children.find((n) => n.userData.workbenchProduct)
          .userData.assetBundle,
    ),
  ).toBe('speaker-engineering@1')
  await page.getByRole('button', { name: '展开部件', exact: true }).click()
  await page.waitForTimeout(650)
  await page.unroute('**/api/v1/products/form-01')
  report.checks.push('v1 typewriter and real v2 GLB still available; no progress UI falsely added')
  const mobile = await browser.newPage({
    viewport: { width: 390, height: 844 },
    reducedMotion: 'reduce',
  })
  mobile.on('pageerror', (e) => report.errors.push(e.message))
  await mobile.goto(base + '/?product=reventon')
  await expect(mobile.locator('.workbench')).toHaveAttribute('data-status', 'ready', {
    timeout: 30000,
  })
  await mobile.getByRole('button', { name: '结构与动作', exact: true }).click()
  await mobile.getByRole('button', { name: '打开', exact: true }).click()
  await expect(mobile.locator('.wb-progress output')).toHaveText('100.0%')
  for (const width of [390, 320]) {
    await mobile.setViewportSize({ width, height: 844 })
    const slider = mobile.getByRole('slider', { name: '打开车门' })
    await slider.focus()
    await mobile.keyboard.press('Home')
    await expect(mobile.locator('.wb-progress output')).toHaveText('0.0%')
    await mobile.keyboard.press('ArrowRight')
    await expect(mobile.locator('.wb-progress output')).toHaveText('0.1%')
    await mobile.screenshot({ path: output + '/mobile-' + width + '.png' })
    report.captures.push('mobile-' + width)
    expect(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    )
  }
  await mobile.close()
  report.checks.push(
    '390/320px basic compatibility; reduced-motion endpoint instant; native slider Home/arrow keyboard 0.1%',
  )
  expect(report.errors).toEqual([])
  report.passed = true
} catch (error) {
  report.failure = String(error)
  throw error
} finally {
  await writeFile(output + '/results.json', JSON.stringify(report, null, 2) + '\n')
  await browser.close()
}
console.log(JSON.stringify(report, null, 2))
