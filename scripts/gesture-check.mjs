/* global Worker, OffscreenCanvas, performance, setTimeout, clearTimeout */
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium, expect } from '@playwright/test'

const base = process.env.CHECK_URL || 'http://127.0.0.1:5181'
const output = '.impeccable/review'
await mkdir(output, { recursive: true })
const browser = await chromium.launch({
  channel: 'msedge',
  headless: true,
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
})
const report = { browser: 'Edge', camera: 'synthetic; no physical camera captured' }
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: 'reduce',
  })
  const page = await context.newPage()
  const requests = [],
    errors = []
  page.on('request', (request) => requests.push(request.url()))
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(`${base}/?legacy=1`)

  await page.getByRole('button', { name: '完整控制台', exact: true }).click()
  await expect(page.getByRole('button', { name: '开启手势体验', exact: true })).toBeEnabled({
    timeout: 30000,
  })
  expect(requests.some((url) => url.startsWith(`${base}/gesture/`))).toBe(false)
  report.lazyAssets = 'pass'
  report.worker = await page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const worker = new Worker('/gesture/worker.js')
        const timeout = setTimeout(() => {
          worker.terminate()
          reject(new Error('Worker timed out'))
        }, 45000)
        worker.onerror = (error) => {
          clearTimeout(timeout)
          worker.terminate()
          reject(new Error(error.message))
        }
        worker.onmessage = ({ data }) => {
          if (data.type === 'ready') {
            const canvas = new OffscreenCanvas(640, 480)
            canvas.getContext('2d').fillRect(0, 0, 640, 480)
            const frame = canvas.transferToImageBitmap()
            worker.postMessage({ type: 'frame', frame, time: performance.now() }, [frame])
          } else {
            clearTimeout(timeout)
            worker.terminate()
            if (data.type === 'error') reject(new Error(data.message))
            else
              resolve({
                type: data.type,
                points: data.points.length,
                inferenceMs: data.inferenceMs,
              })
          }
        }
        worker.postMessage({ type: 'init' })
      }),
  )
  expect(report.worker.type).toBe('result')
  expect(report.worker.points).toBe(0)
  await page.getByRole('button', { name: '开启手势体验', exact: true }).click()
  await expect(page.getByRole('button', { name: '关闭摄像头', exact: true })).toBeVisible({
    timeout: 45000,
  })
  await expect
    .poll(() => page.locator('video').evaluate((video) => video.srcObject?.active))
    .toBe(true)
  await page.evaluate(() => {
    window.__cameraStream = document.querySelector('video').srcObject
  })
  await page.getByRole('button', { name: '收起面板', exact: true }).click()
  await expect(page.locator('.studio-console')).toBeHidden()
  await expect(page.getByRole('button', { name: '摄像头已开启 · 关闭', exact: true })).toBeVisible()
  expect(
    await page
      .locator('video')
      .evaluate((video) => video.srcObject === window.__cameraStream && video.srcObject.active),
  ).toBe(true)
  await page.getByRole('button', { name: '完整控制台', exact: true }).click()
  report.panelSession = 'closing panel preserves the same live MediaStream; header exposes stop'
  await page.getByRole('button', { name: '选择', exact: true }).click()
  await expect(page.getByRole('button', { name: '选择', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await page.getByRole('button', { name: '了解低音单元', exact: true }).click()
  await expect(page.getByRole('region', { name: '低音单元说明' })).toBeVisible()
  await expect(page.getByRole('button', { name: '恢复手势', exact: true })).toBeVisible()
  await page.screenshot({ path: `${output}/gesture-desktop.png`, fullPage: true })
  await page.getByRole('button', { name: '恢复手势', exact: true }).click()
  await page.getByRole('button', { name: '关闭摄像头', exact: true }).click()
  expect(await page.locator('video').evaluate((video) => video.srcObject)).toBe(null)
  await expect(page.getByRole('button', { name: '开启手势体验', exact: true })).toBeVisible()
  expect(requests.filter((url) => !url.startsWith(base) && !url.startsWith('data:'))).toEqual([])
  expect(errors).toEqual([])
  report.session = 'start, select mode, manual takeover, resume, stop: pass'
  report.network = 'all requests same-origin'
  await page.setViewportSize({ width: 390, height: 844 })
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.waitForTimeout(300)
  await expect(page.getByRole('button', { name: '开启手势体验', exact: true })).toBeEnabled()
  await page.screenshot({ path: `${output}/gesture-mobile.png`, fullPage: true })
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
  report.mobileOverflow = 'none'
  report.resizeRecovery = 'pass'
  await writeFile(`${output}/gesture-results.json`, JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
} finally {
  await browser.close()
}
