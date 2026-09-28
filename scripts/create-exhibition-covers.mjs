import { chromium, expect } from '@playwright/test'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
const base = process.env.CHECK_URL || 'http://127.0.0.1:5180'
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const report = []
const selectedIds = process.env.PRODUCT_IDS?.split(',')
await mkdir('public/covers/exhibition', { recursive: true })
try {
  for (const id of [
    'form-01',
    'toy-racer',
    'potted-plant',
    'gamepad',
    'gaming-console',
    'oak-side-table',
    'home-furniture-set',
  ]) {
    if (selectedIds && !selectedIds.includes(id)) continue
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
    const errors = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.goto(`${base}/?product=${id}`)
    await expect(page.getByRole('button', { name: '正面', exact: true })).toBeEnabled({
      timeout: 45000,
    })
    await page.waitForTimeout(3500)
    await expect(page.locator('.product-viewer')).toHaveAttribute('data-intro-state', 'stable')
    await page.addStyleTag({
      content:
        '.viewer-shell {position:relative!important; width:960px!important; height:600px!important} .canvas-host {inset:0!important} .scene-topline,.scene-bottom,.model-hotspot,.gesture-motion-status,.studio-intro,.site-header,.experience-tools {display:none!important}',
    })
    await page.waitForTimeout(1200)
    const cover = await page
      .locator('.product-viewer')
      .screenshot({ path: `public/covers/exhibition/${id}.png` })
    expect(errors).toEqual([])
    report.push({
      id,
      meshes: await page.locator('.product-viewer').getAttribute('data-rendered-meshes'),
      cover: `${id}.png`,
      bytes: cover.length,
      sha256: createHash('sha256').update(cover).digest('hex'),
    })
    console.log(id)
    await page.close()
  }
  const previous = selectedIds
    ? JSON.parse(await readFile('public/covers/exhibition/manifest.json', 'utf8'))
    : []
  const merged = [
    ...previous.filter((item) => !report.some((next) => next.id === item.id)),
    ...report,
  ]
  await writeFile('public/covers/exhibition/manifest.json', JSON.stringify(merged, null, 2))
} finally {
  await browser.close()
}
