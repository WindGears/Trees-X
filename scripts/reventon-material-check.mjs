import { chromium, expect } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const errors = []
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } })
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('http://127.0.0.1:5181/artifacts/reventon/realtime/material-proof.html')
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true', { timeout: 120000 })
  await page.waitForTimeout(1000)
  const report = await page.evaluate(() => window.materialProof)
  expect(report.meshes).toBe(2)
  expect(report.triangles).toBe(10704)
  expect(
    report.materials.every(
      (material) =>
        material.map && material.normal && material.roughness && material.normalUv === 1,
    ),
  ).toBe(true)
  expect(errors).toEqual([])
  await page.screenshot({ path: 'artifacts/reventon/realtime/material-proof-browser.png' })
  await writeFile(
    'artifacts/reventon/realtime/material-proof-browser.json',
    JSON.stringify({ ...report, errors }, null, 2),
  )
  console.log(JSON.stringify(report, null, 2))
} finally {
  await browser.close()
}
