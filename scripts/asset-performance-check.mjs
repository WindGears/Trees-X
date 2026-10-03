/* global performance */
import { chromium, expect } from '@playwright/test'
import { mkdir, readFile, writeFile } from 'node:fs/promises'

const output = '.impeccable/review/asset-ingestion'
await mkdir(output, { recursive: true })
const fixture = JSON.parse(
  await readFile('server/src/test/resources/fixtures/speaker-glb-v2.json', 'utf8'),
)
const browser = await chromium.launch({ channel: 'msedge', headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  await page.route('**/api/v1/products/form-01', (route) => route.fulfill({ json: fixture }))
  await page.goto((process.env.CHECK_URL || 'http://127.0.0.1:5181') + '/?product=form-01')
  await expect(page.locator('.workbench')).toHaveAttribute('data-status', 'ready', {
    timeout: 45000,
  })
  await page.evaluate(() => {
    let component = document.querySelector('canvas').__vueParentComponent
    while (component) {
      const context =
        component.exposed?.context ??
        Reflect.ownKeys(component.provides ?? {})
          .map((key) => component.provides[key])
          .find((value) => value?.scene?.value?.isScene)
      if (context) {
        const times = [],
          renderer = context.renderer.instance
        const subscription = context.renderer.onRender(() => times.push(performance.now()))
        const gl = renderer.getContext(),
          debug = gl.getExtension('WEBGL_debug_renderer_info')
        window.__assetTiming = {
          times,
          subscription,
          renderer,
          device: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : 'unavailable',
        }
        return
      }
      component = component.parent
    }
    throw new Error('Missing renderer for measurement')
  })
  await page.mouse.move(800, 580)
  await page.mouse.down()
  const start = performance.now()
  let moves = 0
  while (performance.now() - start < 10000) {
    const t = (performance.now() - start) / 1000
    await page.mouse.move(800 + 110 * Math.sin(t), 580 + 65 * Math.cos(t))
    await page.waitForTimeout(16)
    moves++
  }
  await page.mouse.up()
  const measured = await page.evaluate(() => {
    const state = window.__assetTiming
    state.subscription.off()
    return {
      times: state.times,
      device: state.device,
      memory: { ...state.renderer.info.memory },
      calls: state.renderer.info.render.calls,
    }
  })
  const intervals = measured.times
    .slice(1)
    .map((time, i) => time - measured.times[i])
    .sort((a, b) => a - b)
  expect(intervals.length).toBeGreaterThan(30)
  const percentile = (fraction) =>
    intervals[Math.min(intervals.length - 1, Math.floor(intervals.length * fraction))]
  const report = {
    scope:
      'speaker engineering GLB only; Edge headless; 1440x1000; continuous Playwright mouse drag',
    method:
      'intervals between completed Tres renderer onRender events; includes driver/automation scheduling, not GPU query time',
    durationMs: performance.now() - start,
    moves,
    samples: intervals.length,
    medianFrameIntervalMs: percentile(0.5),
    p95FrameIntervalMs: percentile(0.95),
    device: measured.device,
    memory: measured.memory,
    drawCallsLastFrame: measured.calls,
    note: 'No quality downgrade or full-car performance claim; interactive headed device acceptance remains separate',
  }
  await writeFile(output + '/frame-times.json', JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
} finally {
  await browser.close()
}
