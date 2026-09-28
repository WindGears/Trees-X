import { chromium, expect } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
const base = process.env.CHECK_URL || 'http://127.0.0.1:5180'
const output = '.impeccable/review'
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const errors = []
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: 'no-preference',
  })
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(`${base}/?product=toy-racer`)

  await page.getByRole('button', { name: '完整控制台', exact: true }).click()
  const viewer = page.locator('.product-viewer')
  await expect(viewer).toHaveAttribute('data-composer-count', '1', { timeout: 40000 })
  await expect(viewer).toHaveAttribute('data-intro-state', 'stable', { timeout: 10000 })
  await page.getByRole('button', { name: /电影画质/ }).click()
  await expect(viewer).toHaveAttribute('data-composer-count', '0')
  await page.waitForTimeout(1000)
  // Exclude DOM labels and projected hotspots so they cannot make a frozen canvas pass.
  const screenshot = (name) =>
    page.locator('canvas').screenshot({
      path: `${output}/handoff-${name}.png`,
      style:
        '.studio-intro,.site-header,.studio-console,.scene-topline,.scene-bottom,.model-hotspot,.gesture-selection-cursor,.gesture-palette,.gesture-motion-status{visibility:hidden!important}',
    })
  const perspective = await screenshot('eco-perspective')
  await page.getByRole('button', { name: '正面', exact: true }).click()
  await page.waitForTimeout(1100)
  const front = await screenshot('eco-front')
  expect(front.equals(perspective), 'eco must draw new camera pixels after Composer unmount').toBe(
    false,
  )
  await page.getByRole('button', { name: /商品目录/ }).click()
  await page.getByRole('button', { name: '展示复古游戏手柄', exact: true }).click()
  await expect(page.getByRole('button', { name: '正面', exact: true })).toBeEnabled({
    timeout: 30000,
  })
  await page.waitForTimeout(1100)
  const gamepad = await screenshot('eco-gamepad')
  expect(gamepad.equals(front), 'new GLB must replace old product pixels').toBe(false)
  await page.getByRole('button', { name: '冷调试色', exact: true }).click()
  const tinted = await screenshot('eco-tinted')
  expect(tinted.equals(gamepad), 'material must redraw in eco').toBe(false)
  for (let i = 0; i < 3; i++) {
    await page.getByRole('button', { name: '基础画质', exact: true }).click()
    await expect(viewer).toHaveAttribute('data-composer-count', '1')
    await page.getByRole('button', { name: /电影画质/ }).click()
    await expect(viewer).toHaveAttribute('data-composer-count', '0')
  }
  await page.getByRole('button', { name: '原始材质', exact: true }).click()
  await page.waitForTimeout(250)
  expect(
    (await screenshot('eco-restored')).equals(tinted),
    'repeated toggles preserve redraw',
  ).toBe(false)
  await expect(page.locator('canvas')).toHaveCount(1)
  expect(errors).toEqual([])
  const report = {
    browser: 'Edge',
    canvas: 1,
    cameraPixels: 'changed',
    modelPixels: 'changed',
    materialPixels: 'changed',
    repeatedToggles: 3,
    uiExcludedFromPixelEvidence: true,
    errors,
  }
  await writeFile(`${output}/render-handoff-results.json`, JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
} finally {
  await browser.close()
}
