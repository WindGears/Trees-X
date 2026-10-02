/* global requestAnimationFrame */
import { mkdir, writeFile } from 'node:fs/promises'
import { URL } from 'node:url'
import { chromium, expect } from '@playwright/test'

const base = process.env.CHECK_URL || 'http://127.0.0.1:5181'
const output = '.impeccable/review'
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const report = { browser: 'Edge', targetViewport: '1440x1000' }

function summarize(values) {
  const ordered = values.sort((a, b) => a - b)
  return {
    median: ordered[Math.floor(ordered.length * 0.5)],
    p95: ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * 0.95))],
    samples: ordered.length,
  }
}

try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1,
    reducedMotion: 'no-preference',
  })
  const page = await context.newPage()
  const errors = [],
    requests = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  page.on('request', (request) => requests.push(request.url()))
  await page.goto(`${base}/?legacy=1&product=toy-racer`)
  const viewer = page.locator('.product-viewer')
  await expect(viewer).toHaveAttribute('data-visual-quality', 'cinematic', { timeout: 30000 })
  await expect(viewer).toHaveAttribute('data-composer-count', '1', { timeout: 30000 })
  await expect(viewer).toHaveAttribute('data-particle-count', '1600')
  await expect(viewer).toHaveAttribute('data-environment', 'hdr', { timeout: 30000 })
  await expect(viewer).toHaveAttribute('data-intro-state', 'stable', { timeout: 30000 })
  await expect(viewer).toHaveAttribute('data-intro-request', '1')
  const canvas = page.locator('canvas')
  await expect(canvas).toHaveCount(1)
  const cinematic = await canvas.screenshot()

  await page.getByRole('button', { name: '电影画质 · HDR', exact: true }).click()
  await expect(viewer).toHaveAttribute('data-visual-quality', 'eco')
  await expect(viewer).toHaveAttribute('data-composer-count', '0')
  await expect(viewer).toHaveAttribute('data-particle-count', '0')
  await page.waitForTimeout(250)
  const eco = await canvas.screenshot()
  expect(cinematic.equals(eco), 'Cinematic stage must change real pixels').toBe(false)

  await page.getByRole('button', { name: '基础画质', exact: true }).click()
  await expect(viewer).toHaveAttribute('data-environment', 'hdr', { timeout: 30000 })
  await expect(viewer).toHaveAttribute('data-composer-count', '1', { timeout: 30000 })
  await expect(viewer).toHaveAttribute('data-intro-request', '1')
  await page.getByRole('button', { name: '重播视觉演出', exact: true }).click()
  await expect(viewer).toHaveAttribute('data-intro-request', '2')
  await expect(viewer).toHaveAttribute('data-intro-state', 'playing')
  await page.waitForTimeout(620)
  const intro = await canvas.screenshot()
  expect(intro.equals(eco), 'Bloom, scan and aggregation must change real pixels').toBe(false)
  await canvas.dispatchEvent('pointerdown', { pointerType: 'mouse' })
  await expect(viewer).toHaveAttribute('data-intro-state', 'stable')
  await page.waitForTimeout(100)
  const interrupted = await canvas.screenshot()
  expect(intro.equals(interrupted), 'Pointer input must settle the visual timeline').toBe(false)

  const frameTimes = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const samples = []
        let start = 0,
          previous = 0
        function frame(time) {
          if (!start) start = time
          if (previous) {
            const delta = time - previous
            if (delta > 0) samples.push(delta)
          }
          previous = time
          if (samples.length > 0 && samples.length % 60 === 0)
            document
              .querySelectorAll('.view-presets button')
              [Math.floor(samples.length / 60) % 3]?.click()
          if (time - start < 10000) requestAnimationFrame(frame)
          else resolve(samples)
        }
        requestAnimationFrame(frame)
      }),
  )
  const frames = summarize(frameTimes)
  report.cinematic = {
    hdr: 'loaded from same origin',
    composerCount: 1,
    particleCount: 1600,
    automaticIntroRequests: 1,
    replayAndInputInterruption: 'pass',
    realPixelDifference: 'pass',
  }
  report.frameTimeMs = frames
  report.frameBudget =
    frames.median <= 20 && frames.p95 <= 33
      ? 'pass'
      : 'budget exceeded; desktop quality retained by user request'
  report.localBlobWorkers = requests.filter((url) => url.startsWith('blob:'))
  report.externalRequests = requests.filter(
    (url) => !url.startsWith('data:') && new URL(url).origin !== new URL(base).origin,
  )
  report.sameOrigin = report.externalRequests.length === 0
  expect(
    report.externalRequests,
    'all network requests and Blob workers use the local origin',
  ).toEqual([])
  expect(errors).toEqual([])
  await page.screenshot({ path: `${output}/phase-4-desktop.png`, fullPage: true })
  await context.close()

  for (const [name, width, height, reducedMotion] of [
    ['mobile-390', 390, 844, 'no-preference'],
    ['mobile-320', 320, 740, 'no-preference'],
    ['reduced-motion', 1440, 1000, 'reduce'],
  ]) {
    const fallback = await browser.newContext({
      viewport: { width, height },
      isMobile: name.startsWith('mobile'),
      hasTouch: name.startsWith('mobile'),
      reducedMotion,
    })
    const fallbackPage = await fallback.newPage()
    const network = []
    fallbackPage.on('request', (request) => network.push(request.url()))
    await fallbackPage.goto(`${base}/?legacy=1`)
    const fallbackViewer = fallbackPage.locator('.product-viewer')
    await expect(fallbackViewer).toHaveAttribute('data-visual-quality', 'eco')
    await expect(fallbackViewer).toHaveAttribute('data-composer-count', '0')
    await expect(fallbackViewer).toHaveAttribute('data-particle-count', '0')
    await expect(fallbackPage.getByRole('button', { name: '正面', exact: true })).toBeEnabled()
    expect(network.some((url) => url.endsWith('.hdr'))).toBe(false)
    expect(
      await fallbackPage.evaluate(() => document.documentElement.scrollWidth > innerWidth),
    ).toBe(false)
    await fallbackPage.screenshot({ path: `${output}/phase-4-${name}.png`, fullPage: true })
    report[name] = 'eco fallback passed'
    await fallback.close()
  }
  await writeFile(`${output}/phase-4-visual-report.json`, JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
} finally {
  await browser.close()
}
