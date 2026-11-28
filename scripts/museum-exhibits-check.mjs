/* global performance */
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium, expect } from '@playwright/test'
import { bridge } from './demo/browser-check.mjs'

const base = process.env.CHECK_URL ?? 'http://127.0.0.1:5183'
const output = 'artifacts/museum/exhibits'
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({
  viewport: { width: 1440, height: 1000 },
  deviceScaleFactor: 1,
})
const report = { passed: false, products: [], errors: [], checks: [] }
page.on('pageerror', (error) => report.errors.push(error.message))
page.setDefaultTimeout(30000)
const button = (name) => page.getByRole('button', { name, exact: true })
const product = async (slug) => {
  const response = await page.request.get(`${base}/api/v1/products/${slug}`)
  assert.equal(response.status(), 200)
  return response.json()
}
async function ready(slug, remember = false) {
  await expect(page.locator('.workbench')).toHaveAttribute('data-slug', slug)
  await expect(page.locator('.wb-stage')).toHaveAttribute('data-scene-status', 'ready', {
    timeout: 180000,
  })
  await bridge(page, remember)
  const identity = await page.evaluate(() => {
    const { scene, canvas, renderer, store } = window.__demo
    return {
      slug: store.slug,
      roots: scene.scene.value.children
        .filter((node) => node.userData.workbenchProduct)
        .map((node) => ({
          product: node.userData.workbenchProduct,
          adapter: node.userData.adapter,
          bundle: node.userData.assetBundle,
          triangles: node.userData.triangles,
        })),
      sameCanvas: document.querySelector('canvas') === canvas,
      sameRenderer: scene.renderer.instance === renderer,
      backend: renderer.backend?.isWebGPUBackend ? 'webgpu' : 'other',
    }
  })
  assert.equal(identity.slug, slug)
  assert.deepEqual(
    identity.roots.map((root) => root.product),
    [slug],
  )
  assert.ok(identity.roots[0].triangles > 0)
  assert.equal(identity.sameCanvas, true)
  assert.equal(identity.sameRenderer, true)
  assert.equal(identity.backend, 'webgpu')
  await expect(page.locator('canvas')).toHaveCount(1)
  await expect(page.locator('.wb-stage-status')).toHaveCount(0, { timeout: 20000 })
  report.products.push(identity)
}
async function settled(id, progress) {
  await expect
    .poll(
      () =>
        page.evaluate(
          ({ id, progress }) => {
            const state = window.__demo.motion.states.value[id]
            return Boolean(state && !state.playing && Math.abs(state.progress - progress) < 0.001)
          },
          { id, progress },
        ),
      { timeout: 30000 },
    )
    .toBe(true)
}
async function select(slug) {
  const data = await product(slug)
  await button('切换展品').click()
  await page
    .locator('.museum-switch-results')
    .getByRole('button')
    .filter({ hasText: data.name })
    .click()
  await ready(slug)
  return data
}
try {
  await page.goto(`${base}/?gallery=next&product=typewriter-study`)
  await ready('typewriter-study', true)
  await button('分层').click()
  await settled('explore-layout', 0.6)
  const piano = await select('piano-cfx')
  const pianoAction = piano.presentation.actions.find(
    (action) => action.motion?.program?.type === 'piano-sound-path-v1',
  )
  for (let index = 0; index < 8; index++) {
    await page.locator('.museum-chapter-numbers button').nth(index).click()
    await settled(pianoAction.id, index / 7)
    await expect(page.locator('.museum-chapter-numbers button').nth(index)).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    if (index === 3) await page.screenshot({ path: `${output}/piano-action-1440.png` })
  }
  await button('下一章')
    .isDisabled()
    .then((disabled) => assert.ok(disabled))
  report.checks.push('piano: eight real progress states')
  const car = await select('reventon')
  const doors = car.presentation.actions.find((action) => action.id === 'open-doors')
  const structure = car.presentation.actions.find((action) => action.id === 'explore-parts')
  await expect(button('观察座舱')).toBeDisabled()
  const start = performance.now()
  await button(doors.motion.openLabel).click()
  await settled(doors.id, 1)
  await expect(button('观察座舱')).toBeEnabled()
  await button('观察座舱').click()
  await page.waitForTimeout(850)
  await page.screenshot({ path: `${output}/car-cabin-1440.png` })
  await button(structure.motion.openLabel).click()
  await settled(structure.id, 1)
  await settled(doors.id, 1)
  await page.screenshot({ path: `${output}/car-open-separated-1440.png` })
  await button(doors.motion.closeLabel).click()
  await settled(doors.id, 0)
  await settled(structure.id, 1)
  report.checks.push({ carIndependentActions: true, sequenceMs: performance.now() - start })
  await page.goBack()
  await ready('piano-cfx')
  await page.goForward()
  await ready('reventon')
  report.checks.push('browser back and forward, single original renderer')
  await button('更多操作').click()
  await button('回到封面').click()
  await expect(page.locator('canvas')).toHaveCount(0, { timeout: 20000 })
  await expect(button('开始互动')).toBeVisible()
  report.checks.push('return to cover releases scene')
  assert.deepEqual(report.errors, [])
  report.passed = true
} catch (error) {
  report.failure = String(error.stack ?? error)
  await page.screenshot({ path: `${output}/failure.png` }).catch(() => {})
  throw error
} finally {
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2))
  await browser.close()
}
console.log(JSON.stringify(report, null, 2))
