/* global fetch */
import { chromium, expect } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import sharp from 'sharp'

const base = process.env.CHECK_URL || 'http://127.0.0.1:5182'
const current = await (await fetch(base + '/api/v1/products/typewriter-study')).json()
if (current.presentation?.source.adapter === 'typewriter-v1') {
  await import('./workbench-production-check.mjs')
  process.exit(0)
}
const output = 'artifacts/progress/production.json'
await mkdir('artifacts/progress', { recursive: true })
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const report = {
  scope: 'production build; real API; actual WebGL pixels without Vue debug internals',
  cases: [],
  pixelComparisons: [],
  errors: [],
  passed: false,
}
try {
  async function equivalent(aPng, bPng, label) {
    const a = await sharp(aPng).raw().toBuffer(),
      b = await sharp(bPng).raw().toBuffer()
    expect(a.length).toBe(b.length)
    let changed = 0,
      max = 0,
      total = 0
    for (let i = 0; i < a.length; i++) {
      const d = Math.abs(a[i] - b[i])
      if (d) changed++
      max = Math.max(max, d)
      total += d
    }
    const result = {
      label,
      channels: changed,
      ratio: changed / a.length,
      max,
      mean: total / a.length,
    }
    report.pixelComparisons.push(result)
    // Measured GPU rounding: 4 channels differed by one level, despite matching node poses.
    expect(max).toBeLessThanOrEqual(1)
    expect(result.ratio).toBeLessThanOrEqual(0.00001)
  }
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  page.on('pageerror', (e) => report.errors.push(e.message))
  for (const [slug, open, close] of [
    ['form-01', '展开', '合拢'],
    ['reventon', '打开', '关闭'],
  ]) {
    await page.goto(base + '/?product=' + slug)
    const host = page.locator('.workbench'),
      canvas = page.locator('canvas')
    await expect(host).toHaveAttribute('data-status', 'ready', { timeout: 30000 })
    await expect(canvas).toHaveCount(1)
    await page.getByRole('button', { name: '结构与动作', exact: true }).click()
    const control = page.locator('.wb-progress'),
      slider = control.locator('input'),
      output = control.locator('output')
    const pixels = () =>
      canvas.screenshot({
        style: '.wb-hotspots,.wb-intro,.wb-tools,.wb-input-hint{visibility:hidden!important}',
      })
    async function seek(percent) {
      await slider.evaluate((input, value) => {
        input.value = String(value)
        input.dispatchEvent(new Event('input', { bubbles: true }))
      }, percent)
      await expect(output).toHaveText(percent.toFixed(1) + '%')
    }
    const initial = await pixels()
    await seek(43.7)
    const middle = await pixels()
    expect(middle.equals(initial)).toBe(false)
    await control.getByRole('button', { name: open, exact: true }).click()
    await page.waitForTimeout(200)
    await control.getByRole('button', { name: '暂停', exact: true }).click()
    await page.waitForTimeout(100)
    const paused = await output.textContent(),
      frozen = await pixels()
    await page.waitForTimeout(200)
    expect(await output.textContent()).toBe(paused)
    await equivalent(await pixels(), frozen, slug + ' paused pose')
    await control.getByRole('button', { name: '继续', exact: true }).click()
    await expect(output).toHaveText('100.0%', { timeout: 2000 })
    expect((await pixels()).equals(middle)).toBe(false)
    await control.getByRole('button', { name: close, exact: true }).click()
    await seek(43.7)
    const returned = await pixels()
    await equivalent(returned, middle, slug + ' forward/reverse 43.7%')
    await page.getByRole('button', { name: '复位视角', exact: true }).click()
    await expect(output).toHaveText('43.7%')
    await page.waitForTimeout(700)
    await page.evaluate(() => {
      window.__productionCanvas = document.querySelector('canvas')
      window.__productionGl = window.__productionCanvas.getContext('webgl2')
      window.__productionLoss = window.__productionGl.getExtension('WEBGL_lose_context')
      window.__productionLoss.loseContext()
    })
    await expect(host).toHaveAttribute('data-status', 'error')
    await page.waitForTimeout(200)
    await page.evaluate(() => window.__productionLoss.restoreContext())
    await expect(host).toHaveAttribute('data-status', 'ready', { timeout: 30000 })
    await expect(output).toHaveText('43.7%')
    await expect(control.getByRole('button', { name: '继续', exact: true })).toBeVisible()
    expect(
      await page.evaluate(
        () =>
          document.querySelector('canvas') === window.__productionCanvas &&
          document.querySelector('canvas').getContext('webgl2') === window.__productionGl,
      ),
    ).toBe(true)
    await control.getByRole('button', { name: /复原动作/ }).click()
    await expect(output).toHaveText('0.0%')
    await equivalent(await pixels(), initial, slug + ' restored baseline')
    report.cases.push({
      slug,
      seek: '43.7%',
      pausePixels: 'stable',
      forwardReversePixels: 'equivalent within measured GPU rounding tolerance',
      restorePixels: 'equivalent to baseline within measured GPU rounding tolerance',
      context: 'same canvas/context, paused progress retained',
    })
  }
  expect(report.errors).toEqual([])
  report.passed = true
} catch (error) {
  report.failure = String(error)
  throw error
} finally {
  await writeFile(output, JSON.stringify(report, null, 2) + '\n')
  await browser.close()
}
console.log(JSON.stringify(report, null, 2))
