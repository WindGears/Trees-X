/* global queueMicrotask, performance */
import { chromium, expect } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { assertStablePixels } from './pixel-stability.mjs'

const base = process.env.CHECK_URL || 'http://127.0.0.1:5181'
const output = '.impeccable/review'
await mkdir(output, { recursive: true })
const browser = await chromium.launch({
  channel: 'msedge',
  headless: true,
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
})
const reports = []
try {
  for (const reducedMotion of ['no-preference', 'reduce']) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      reducedMotion,
      recordVideo: { dir: `${output}/gesture-motion-video`, size: { width: 1440, height: 1000 } },
    })
    const page = await context.newPage(),
      errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.addInitScript(() => {
      window.__motionInput = { type: 'still', start: performance.now(), origin: 0.65, speed: 0.12 }
      window.__motionFrames = []
      window.Worker = class {
        onmessage = null
        stopped = false
        postMessage(data) {
          if (data.type === 'init')
            queueMicrotask(() => this.onmessage?.({ data: { type: 'ready' } }))
          if (data.type !== 'frame') return
          data.frame.close()
          const input = window.__motionInput
          if (input.type === 'silent') return
          const x =
            input.origin -
            (input.type === 'moving' ? ((data.time - input.start) / 1000) * input.speed : 0)
          const points = Array.from({ length: 21 }, () => ({ x, y: 0.5, z: 0 }))
          points[0].y = 0.85
          points[5].x -= 0.15
          points[17].x += 0.15
          for (const tip of [8, 12, 16, 20]) {
            points[tip].y = 0.1
            points[tip - 2].y = 0.4
          }
          points[8].y = 0.5
          points[4].x += 0.22
          queueMicrotask(() => {
            if (this.stopped) return
            window.__motionFrames.push({
              time: performance.now(),
              sampleAt: data.time,
              type: input.type,
            })
            this.onmessage?.({
              data: {
                type: 'result',
                points: input.type === 'missing' ? [] : points,
                epoch: data.epoch,
                time: data.time,
                aspect: 4 / 3,
                inferenceMs: 5,
              },
            })
          })
        }
        terminate() {
          this.stopped = true
        }
      }
    })
    await page.goto(`${base}/?legacy=1`)

    await page.getByRole('button', { name: '完整控制台', exact: true }).click()
    const button = (label) => page.getByRole('button', { name: label, exact: true })
    await expect(button('开启手势体验')).toBeEnabled({ timeout: 30000 })
    // Measure camera movement with decorative animation disabled; inertia remains enabled.
    if (reducedMotion === 'no-preference')
      await page.getByRole('button', { name: /电影画质/ }).click()
    await button('正面').click()
    await page.waitForTimeout(1000)
    await button('开启手势体验').click()
    const hud = page.locator('.gesture-motion-status')
    const input = async (type, origin = 0.65) =>
      page.evaluate(
        ({ type, origin }) => {
          window.__motionInput = { type, origin, start: performance.now(), speed: 0.12 }
        },
        { type, origin },
      )
    const angle = async () => Number(await hud.getAttribute('data-camera-angle'))
    await input('moving')
    await expect.poll(async () => Math.abs(await angle())).toBeGreaterThan(0.15)
    const movingAngle = await angle()
    await input('missing')
    await page.waitForTimeout(140)
    const releaseAngle = await angle()
    const releasePixels = await page.locator('canvas').screenshot()
    await page.waitForTimeout(500)
    const coastAngle = await angle()
    const coastTravel = Math.abs(coastAngle - releaseAngle)
    if (reducedMotion === 'reduce') expect(coastTravel).toBeLessThan(0.001)
    else {
      expect(coastTravel).toBeGreaterThan(0.02)
      expect(releasePixels.equals(await page.locator('canvas').screenshot())).toBe(false)
    }
    await page.waitForTimeout(1100)
    const stoppedAngle = await angle()
    await page.waitForTimeout(200)
    expect(Math.abs((await angle()) - stoppedAngle)).toBeLessThan(0.001)
    await input('still', 0.2)
    await page.waitForTimeout(350)
    expect(
      Math.abs((await angle()) - stoppedAngle),
      'Reentry cannot jump to the new hand position',
    ).toBeLessThan(0.001)
    await input('moving', 0.5)
    await page.waitForTimeout(500)
    const beforeTakeover = await angle()
    await button('正面').click()
    await expect(button('恢复手势')).toBeVisible()
    await page.waitForTimeout(1000)
    const manualAngle = await angle()
    expect(Math.abs(manualAngle), 'Front view must reach zero orbit angle').toBeLessThan(0.001)
    const pixels = await page.locator('canvas').screenshot()
    await page.waitForTimeout(300)
    const takeoverPixels = await page.locator('canvas').screenshot()
    await writeFile(`${output}/gesture-takeover-before-${reducedMotion}.png`, pixels)
    await writeFile(`${output}/gesture-takeover-after-${reducedMotion}.png`, takeoverPixels)
    const takeoverPixelDifference = await assertStablePixels(
      page,
      pixels,
      takeoverPixels,
      'Manual camera must not drift',
    )
    expect(
      Math.abs((await angle()) - manualAngle),
      'Actual camera angle must remain fixed',
    ).toBeLessThan(0.001)
    await button('恢复手势').click()
    await input('moving')
    await page.waitForTimeout(600)
    await input('silent')
    await page.waitForTimeout(1600)
    const silentAngle = await angle()
    await page.waitForTimeout(200)
    expect(Math.abs((await angle()) - silentAngle)).toBeLessThan(0.001)
    await page.screenshot({ path: `${output}/gesture-motion-${reducedMotion}.png`, fullPage: true })
    await button('关闭摄像头').click()
    await expect(hud).toHaveCount(0)
    expect(errors).toEqual([])
    reports.push({
      reducedMotion,
      movingAngle,
      releaseAngle,
      coastAngle,
      coastTravel,
      stoppedAngle,
      beforeTakeover,
      manualAngle,
      takeoverPixelDifference,
      reentry: 'no jump',
      takeover: 'stable pixels',
      workerSilence: 'stopped',
      errors,
    })
    await context.close()
  }
  await writeFile(
    `${output}/gesture-motion-results.json`,
    JSON.stringify(
      {
        input: 'Synthetic landmarks; actual camera and rendered pixels. Not a human accuracy test.',
        reports,
      },
      null,
      2,
    ),
  )
  console.log(JSON.stringify(reports, null, 2))
} finally {
  await browser.close()
}
