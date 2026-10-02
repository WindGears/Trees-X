/* global queueMicrotask */
import { assertStablePixels } from './pixel-stability.mjs'
import { chromium, expect } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
const base = process.env.CHECK_URL || 'http://127.0.0.1:5181'
const output = '.impeccable/review'
await mkdir(output, { recursive: true })
const browser = await chromium.launch({
  channel: 'msedge',
  headless: true,
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
})
const errors = []
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: 'no-preference',
  })
  page.on('pageerror', (error) => errors.push(error.message))
  await page.addInitScript(() => {
    window.__dwellHand = []
    const NativeWorker = window.Worker
    window.Worker = class {
      onmessage = null
      stopped = false
      constructor(url, options) {
        if (!String(url).includes('/gesture/worker.js')) return new NativeWorker(url, options)
      }
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
                  points: window.__dwellHand,
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
  await page.goto(`${base}/?legacy=1`)

  await page.getByRole('button', { name: '完整控制台', exact: true }).click()
  await expect(page.getByRole('button', { name: '开启手势体验', exact: true })).toBeEnabled({
    timeout: 30000,
  })
  await page.getByRole('button', { name: /电影画质/ }).click()
  await page.getByRole('button', { name: '开启手势体验', exact: true }).click()
  await page.getByRole('button', { name: '选择', exact: true }).click()
  await page.locator('.gesture-advanced summary').click()
  await expect(page.getByRole('button', { name: '悬停确认', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  const pointAt = async (id) =>
    page.evaluate((id) => {
      const element = document.querySelector(`[data-gesture-target="${id}"]`)
      const rect = element.getBoundingClientRect(),
        host = document.querySelector('.canvas-host').getBoundingClientRect()
      const x = 1 - (rect.left + rect.width / 2 - host.left) / host.width,
        y = (rect.top + rect.height / 2 - host.top) / host.height
      const points = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5, z: 0 }))
      points[0].y = 0.85
      points[5].x = 0.35
      points[17].x = 0.65
      points[8] = { x, y, z: 0 }
      points[4] = { x: x + 0.22, y, z: 0 }
      window.__dwellHand = points
    }, id)
  await pointAt('group:finishes')
  await expect(page.getByRole('button', { name: '手势：香槟', exact: true })).toBeVisible({
    timeout: 5000,
  })
  await pointAt('finish:champagne')
  await expect(page.getByRole('button', { name: '香槟', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
    { timeout: 5000 },
  )
  await pointAt('group:parts')
  await expect(page.getByRole('button', { name: '手势：低音单元', exact: true })).toBeVisible({
    timeout: 5000,
  })
  await pointAt('action:part:woofer')
  await page.waitForTimeout(400)
  await page.evaluate(() => {
    window.__dwellHand = []
  })
  await page.waitForTimeout(600)
  await expect(page.locator('.part-description')).toHaveCount(0)
  await pointAt('action:part:woofer')
  await expect(page.getByRole('region', { name: '低音单元说明' })).toBeVisible({ timeout: 5000 })
  await expect(page.getByText('已识别手部', { exact: true })).toBeVisible({ timeout: 3000 })
  const capture = () =>
    page.locator('canvas').screenshot({
      style:
        '.model-hotspot,.gesture-selection-cursor,.gesture-palette{visibility:hidden!important}',
    })
  const camera = await capture()
  await page.waitForTimeout(1500)
  const held = await capture()
  await writeFile(`${output}/dwell-camera-before.png`, camera)
  await writeFile(`${output}/dwell-camera-held.png`, held)
  const stationaryDifference = await assertStablePixels(
    page,
    camera,
    held,
    'stationary hand must not retrigger focus',
  )
  await page.getByRole('button', { name: '正面', exact: true }).click()
  await expect(page.getByText('鼠标已接管', { exact: true })).toBeVisible({ timeout: 3000 })
  await page.waitForTimeout(1000)
  await expect(page.getByText('鼠标已接管', { exact: true })).toBeVisible()
  await page.evaluate(() => {
    window.__dwellHand = []
  })
  await page.getByRole('button', { name: /商品目录/ }).click()
  await page.getByRole('button', { name: '展示迷你赛车', exact: true }).click()
  await expect(page.getByRole('button', { name: '正面', exact: true })).toBeEnabled({
    timeout: 30000,
  })
  await page.getByRole('button', { name: '恢复手势', exact: true }).click()
  await pointAt('action:part:body')
  await expect(page.getByRole('region', { name: '赛车车身说明' })).toBeVisible({ timeout: 5000 })
  await expect(page.getByText('已识别手部', { exact: true })).toBeVisible({ timeout: 3000 })
  await pointAt('group:tools')
  await expect(page.getByRole('button', { name: '手势：展开结构', exact: true })).toBeVisible({
    timeout: 5000,
  })
  await pointAt('structure')
  await expect(page.getByRole('button', { name: '合拢结构', exact: true })).toBeVisible({
    timeout: 5000,
  })
  await page.screenshot({ path: `${output}/gesture-collection.png` })
  await page.getByRole('button', { name: '关闭摄像头', exact: true }).click()
  expect(errors).toEqual([])
  const report = {
    input: 'synthetic camera and landmarks; real decoder, store, camera and renderer',
    dwell: 'finish, group, part and structure actions pass',
    missing: 'does not confirm',
    stationary: {
      result: 'does not retrigger',
      compositorTolerance: 'at most 4 pixels, 1 channel level',
      ...stationaryDifference,
    },
    mouseOwnership: 'preserved',
    importedModel: 'toy-racer focus and expansion pass',
    errors,
  }
  await writeFile(`${output}/gesture-dwell-results.json`, JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
} finally {
  await browser.close()
}
