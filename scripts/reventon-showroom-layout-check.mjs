import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium, expect } from '@playwright/test'
import { showroomOptions, showroomUrl, verifyShowroomState } from './reventon-showroom/model.mjs'
import { attachShowroomBridge, showroomState } from './reventon-showroom/browser.mjs'
import { candidateIdentity } from './reventon-clean-stress/model.mjs'

// One real load followed by viewport changes; never reloads or raises a window.
const options = showroomOptions(['--mode', 'visual', '--variants', 'showroom', '--video', '0']),
  output = resolve('artifacts/car-showroom/layout'),
  report = { passed: false, headless: true, checks: [], errors: [], screenshots: [] }
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ channel: options.channel, headless: true }),
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 })
page.on('pageerror', (error) => report.errors.push(error.message))
try {
  await page.goto(showroomUrl(options.base, 'showroom'), { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(
    () => document.querySelector('.workbench')?.dataset.status === 'ready',
    null,
    { timeout: 240000 },
  )
  await attachShowroomBridge(page)
  await expect
    .poll(async () => (await page.evaluate(showroomState)).lighting.keyShadow?.phase, {
      timeout: 240000,
    })
    .toBe('ready')
  const initial = await page.evaluate(showroomState)
  verifyShowroomState(initial, 'showroom', candidateIdentity.sha256)
  for (const [width, height] of [
    [1280, 720],
    [1440, 1000],
    [1920, 1080],
    [390, 844],
    [320, 740],
  ]) {
    await page.setViewportSize({ width, height })
    await page.waitForTimeout(600)
    const state = await page.evaluate(showroomState)
    assert.equal(state.canvases, 1)
    assert.ok(state.sameCanvas && state.sameRenderer)
    assert.equal(state.environment, initial.environment)
    assert.equal(state.showroom.phase, 'ready')
    assert.equal(state.lighting.error, null)
    const layout = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth > innerWidth + 1,
      title: window.getComputedStyle(document.querySelector('.wb-intro')).color,
      description: window.getComputedStyle(document.querySelector('.wb-intro p')).color,
      room: document.querySelector('.wb-stage')?.getAttribute('data-car-showroom'),
    }))
    assert.equal(layout.overflow, false)
    assert.equal(layout.title, 'rgb(241, 243, 246)')
    assert.equal(layout.description, 'rgb(189, 194, 202)')
    assert.equal(layout.room, 'cold-studio')
    const file = `${width}x${height}.png`
    await page.screenshot({ path: resolve(output, file) })
    report.screenshots.push(file)
    report.checks.push({ width, height, layout, output: state.output })
  }
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.waitForTimeout(100)
  assert.equal((await page.evaluate(showroomState)).lighting.error, null)
  assert.deepEqual(report.errors, [])
  report.passed = true
} catch (error) {
  report.failure = error.message
  await page.screenshot({ path: resolve(output, 'failure.png') }).catch(() => {})
} finally {
  await browser.close()
  await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2) + '\n')
}
console.log(JSON.stringify({ passed: report.passed, output, failure: report.failure }))
if (!report.passed) process.exitCode = 1
