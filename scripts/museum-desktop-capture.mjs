/* global getComputedStyle, innerWidth */
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium, expect } from '@playwright/test'
import { bridge } from './demo/browser-check.mjs'

const output = 'artifacts/museum/typewriter'
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
const report = []
try {
  await page.goto(
    `${process.env.CHECK_URL ?? 'http://127.0.0.1:5183'}/?gallery=next&product=typewriter-study`,
  )
  await expect(page.locator('.wb-stage')).toHaveAttribute('data-scene-status', 'ready', {
    timeout: 180000,
  })
  await expect(page.locator('.wb-stage-status')).toHaveCount(0, { timeout: 20000 })
  await bridge(page, true)
  for (const size of [
    { width: 1440, height: 1000 },
    { width: 1280, height: 720 },
    { width: 1920, height: 1080 },
  ]) {
    await page.setViewportSize(size)
    await expect(page.getByRole('button', { name: '整机', exact: true })).toBeVisible()
    await expect
      .poll(() => page.locator('canvas').evaluate((canvas) => [canvas.width, canvas.height]))
      .toEqual([size.width, size.height])
    // Give the real GPU resize and Chromium glass compositor time to present before capture.
    await page.waitForTimeout(2000)
    report.push(
      await page.locator('.museum-dock').evaluate((element) => ({
        width: innerWidth,
        text: element.textContent,
        opacity: getComputedStyle(element).opacity,
        buttons: [...element.querySelectorAll('button')].map((button) => ({
          name: button.textContent,
          color: getComputedStyle(button).color,
          visibility: getComputedStyle(button).visibility,
        })),
      })),
    )
    await page.screenshot({ path: `${output}/whole-${size.width}.png` })
    if (size.width === 1440) {
      const style = await page.addStyleTag({
        content:
          '.museum-header,.museum-identity,.museum-top-scrim,.museum-controls,.museum-tools,.museum-hint,.wb-realtime-quiet,.wb-callouts { visibility:hidden !important; }',
      })
      await page.screenshot({ path: `${output}/cover-clean-1440.png` })
      await style.evaluate((element) => element.remove())
    }
  }
} finally {
  await writeFile(`${output}/desktop-capture.json`, JSON.stringify(report, null, 2))
  await browser.close()
}
