/* global queueMicrotask */
import { chromium, expect } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
const base = process.env.CHECK_URL || 'http://127.0.0.1:5180'
const output = '.impeccable/review'
await mkdir(output, { recursive: true })
const browser = await chromium.launch({
  channel: 'msedge',
  headless: true,
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
})
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: 'reduce',
  })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  // A test-only Worker replacement. The production detector, selection, UI and
  // camera lifecycle remain real; this is not a test of human landmark accuracy.
  await page.addInitScript(() => {
    window.__testHands = []
    window.Worker = class {
      onmessage = null
      stopped = false
      postMessage(data) {
        if (data.type === 'init')
          queueMicrotask(() => this.onmessage?.({ data: { type: 'ready' } }))
        if (data.type === 'frame') {
          data.frame.close()
          queueMicrotask(() => {
            if (!this.stopped)
              this.onmessage?.({
                data: {
                  type: 'result',
                  points: window.__testHands,
                  epoch: data.epoch,
                  time: data.time,
                  aspect: 4 / 3,
                  inferenceMs: 5,
                },
              })
          })
        }
      }
      terminate() {
        this.stopped = true
      }
    }
  })
  await page.goto(base)

  await page.getByRole('button', { name: '完整控制台', exact: true }).click()
  await expect(page.getByRole('button', { name: '开启手势体验', exact: true })).toBeEnabled({
    timeout: 30000,
  })
  await page.getByRole('button', { name: '正面', exact: true }).click()
  await page.getByRole('button', { name: '开启手势体验', exact: true }).click()
  await page.getByRole('button', { name: '选择', exact: true }).click()
  await page.locator('.gesture-advanced summary').click()
  await page.getByRole('button', { name: '捏合确认', exact: true }).click()
  const setHand = async (pinch, fingerOffset = 0, palmOffset = 0) =>
    page.evaluate(
      ({ pinch, fingerOffset, palmOffset }) => {
        const target = document.querySelector('.model-hotspot')
        const x = 1 - parseFloat(target.style.left) / 100,
          y = parseFloat(target.style.top) / 100
        const points = Array.from({ length: 21 }, () => ({ x: 0.5 + palmOffset, y: 0.5, z: 0 }))
        points[0].y = 0.85
        points[5].x = 0.35 + palmOffset
        points[17].x = 0.65 + palmOffset
        points[8] = { x: x + fingerOffset + palmOffset, y, z: 0 }
        points[4] = { x: points[8].x + (pinch ? 0.01 : 0.22), y, z: 0 }
        window.__testHands = points
      },
      { pinch, fingerOffset, palmOffset },
    )
  await setHand(false)
  await expect(page.getByText('已瞄准 · 捏合两指', { exact: true })).toBeVisible()
  await setHand(true, 0.15)
  await expect(page.getByText('已锁定 · 松开两指确认', { exact: true })).toBeVisible()
  await page.waitForTimeout(200)
  await setHand(false, 0.15)
  await expect(page.getByRole('region', { name: '低音单元说明' })).toBeVisible()
  await page
    .locator('.part-description')
    .getByRole('button', { name: '返回全景', exact: true })
    .click()
  await page.getByRole('button', { name: '恢复手势', exact: true }).click()
  await setHand(false)
  await expect(page.getByText('已瞄准 · 捏合两指', { exact: true })).toBeVisible()
  await setHand(true)
  await expect(page.getByText('已锁定 · 松开两指确认', { exact: true })).toBeVisible()
  await setHand(true, 0, 0.3)
  await expect(page.getByText('已取消 · 张开两指，重新瞄准', { exact: true })).toBeVisible()
  await setHand(false)
  await expect(page.getByRole('region', { name: '低音单元说明' })).toHaveCount(0)
  await page.getByRole('button', { name: '校准捏合', exact: true }).click()
  await setHand(false)
  await expect(page.getByRole('button', { name: '开始采集捏合', exact: true })).toBeVisible({
    timeout: 5000,
  })
  await setHand(true)
  await page.getByRole('button', { name: '开始采集捏合', exact: true }).click()
  await expect(page.getByText('使用本次校准', { exact: true })).toBeVisible({ timeout: 5000 })
  await page.getByText('识别诊断', { exact: true }).click()
  await expect(page.locator('.gesture-skeleton polyline')).toHaveCount(6)
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: `${output}/gesture-v2-desktop.png`, fullPage: true })
  await page.getByRole('button', { name: '恢复默认阈值', exact: true }).click()
  await expect(page.getByText('使用默认阈值', { exact: true })).toBeVisible()
  await page.getByText('识别诊断', { exact: true }).click()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.waitForTimeout(300)
  await page.screenshot({ path: `${output}/gesture-v2-mobile.png`, fullPage: true })
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
  await page.getByRole('button', { name: '关闭摄像头', exact: true }).click()
  expect(errors).toEqual([])
  const report = {
    browser: 'Edge',
    input: 'synthetic landmarks and camera',
    movedFingertipSelection: 'pass',
    palmCancellation: 'pass',
    calibrationAndReset: 'pass',
    skeleton: 'pass',
    mobileOverflow: false,
    errors,
  }
  await writeFile(`${output}/gesture-v2-results.json`, JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
} finally {
  await browser.close()
}
