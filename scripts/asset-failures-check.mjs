/* global structuredClone */
import { chromium, expect } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import { digest, readGlb, glbWithJson } from './asset-package.mjs'

const base = process.env.CHECK_URL || 'http://127.0.0.1:5181'
const fixture = JSON.parse(
  await readFile('server/src/test/resources/fixtures/speaker-glb-v2.json', 'utf8'),
)
const model = await readFile('public/models/bundles/speaker-engineering/v1/model.glb')
const brokenDocument = readGlb(model)
brokenDocument.meshes[0].primitives[0].attributes.POSITION = 999999
const brokenModel = glbWithJson(model, brokenDocument)
const manifest = JSON.parse(
  await readFile('public/models/bundles/speaker-engineering/v1/manifest.json', 'utf8'),
)
manifest.files[0].bytes = brokenModel.length
manifest.files[0].sha256 = digest(brokenModel)
manifest.budget.maxBytes = brokenModel.length
const manifestBody = JSON.stringify(manifest)
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const report = { checks: [], errors: [] }
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  page.on('pageerror', (e) => report.errors.push(e.message))
  let mode = 'network'
  await page.route('**/api/v1/products/form-01', (route) => {
    const product = structuredClone(fixture)
    if (mode === 'parse') product.presentation.source.bundle.sha256 = digest(manifestBody)
    return route.fulfill({ json: product })
  })
  await page.route('**/models/bundles/speaker-engineering/v1/manifest.json', (route) =>
    mode === 'parse'
      ? route.fulfill({ body: manifestBody, contentType: 'application/json' })
      : route.continue(),
  )
  await page.route('**/models/bundles/speaker-engineering/v1/model.glb', (route) => {
    if (mode === 'network') return route.fulfill({ status: 503, body: 'Unavailable' })
    if (mode === 'parse')
      return route.fulfill({ body: brokenModel, contentType: 'model/gltf-binary' })
    if (mode === 'checksum') return route.fulfill({ body: 'Corrupt file' })
    return route.continue()
  })
  await page.goto(base + '/?product=form-01')
  for (const problem of ['network', 'checksum', 'parse']) {
    mode = problem
    if (problem !== 'network')
      await page.getByRole('button', { name: '商品目录', exact: true }).click()
    if (problem !== 'network')
      await page.locator('.wb-catalog-list button').filter({ hasText: '桌面音箱' }).click()
    await expect(page.locator('.workbench')).toHaveAttribute('data-status', 'error', {
      timeout: 30000,
    })
    await expect(page.locator('.wb-hotspots')).toHaveCount(0)
    mode = 'ok'
    await page.getByRole('button', { name: '重新加载', exact: true }).click()
    await expect(page.locator('.workbench')).toHaveAttribute('data-status', 'ready', {
      timeout: 30000,
    })
    report.checks.push(problem + ' failure → retry → actual GLB ready')
    if (problem !== 'parse') {
      await page.getByRole('button', { name: '商品目录', exact: true }).click()
      await page.locator('.wb-catalog-list button').filter({ hasText: '汽车样板' }).click()
      await expect(page.locator('.workbench')).toHaveAttribute('data-status', 'ready')
    }
  }
  expect(report.errors).toEqual([])
  report.passed = true
} finally {
  await writeFile(
    '.impeccable/review/asset-ingestion/failures.json',
    JSON.stringify(report, null, 2),
  )
  await browser.close()
}
console.log(JSON.stringify(report))
