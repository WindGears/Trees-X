/* global URL */
import { chromium, expect } from '@playwright/test'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { bridge } from './demo/browser-check.mjs'
const base = process.env.CHECK_URL || 'http://127.0.0.1:5181'
const fixture = process.env.TYPEWRITER_FIXTURE === '1'
const asset = process.env.TYPEWRITER_ASSET ?? 'v1'
if (!['v1', 'v2'].includes(asset)) throw new Error('Invalid TYPEWRITER_ASSET')
const backend = process.env.TYPEWRITER_PIPELINE ?? 'webgl'
if (!['webgl', 'realtime'].includes(backend)) throw new Error('Invalid TYPEWRITER_PIPELINE')
const output = process.env.TYPEWRITER_CHECK_OUTPUT || 'artifacts/typewriter-migration/runtime'
await mkdir(output, { recursive: true })
const product = JSON.parse(
  await readFile('server/src/main/resources/presentations/typewriter-kimi-v1.json', 'utf8'),
)
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const report = { passed: false, fixture, backend, errors: [], requests: [], checks: [] }
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  if (fixture)
    await context.route('**/api/v1/products/typewriter-study', (route) =>
      route.fulfill({ json: product }),
    )
  const page = await context.newPage()
  page.on('pageerror', (error) => report.errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') report.errors.push(message.text())
  })
  page.on('request', (request) => report.requests.push(request.url()))
  const url = new URL('/?product=typewriter-study', base)
  url.searchParams.set('typewriterAsset', asset)
  url.searchParams.set('renderPipeline', backend)
  await page.goto(url.href)
  await expect(page.locator('.workbench')).toHaveAttribute('data-status', 'ready', {
    timeout: backend === 'realtime' ? 240000 : 90000,
  })
  await expect(page.locator('canvas')).toHaveCount(1)
  await bridge(page, true)
  expect(
    await page.evaluate(() =>
      Boolean(window.__demo.scene.renderer.instance.backend?.isWebGPUBackend),
    ),
  ).toBe(backend === 'realtime')
  await page.evaluate(() => {
    window.__wb = window.__demo.scene
    window.__canvas = window.__demo.canvas
    window.__renderer = window.__demo.renderer
  })
  const state = () =>
    page.evaluate(() => {
      const root = window.__wb.scene.value.children.find((o) => o.userData.workbenchProduct)
      const parts = []
      root.traverse((node) => {
        if (Number.isInteger(node.userData.partId))
          parts.push({
            id: node.userData.partId,
            node: node.name,
            position: node.position.toArray(),
            quaternion: node.quaternion.toArray(),
          })
      })
      const meshes = []
      root.traverse((node) => {
        if (node.isInstancedMesh) meshes.push({ count: node.count, geometry: node.geometry.uuid })
      })
      return {
        parts,
        meshes,
        source: root.userData.sourceKind,
        adapter: root.userData.adapter,
        triangles: root.userData.triangles,
        sameCanvas: document.querySelector('canvas') === window.__canvas,
        sameRenderer: window.__wb.renderer.instance === window.__renderer,
        camera: window.__wb.camera.activeCamera.value.position.toArray(),
      }
    })
  const initial = await state()
  expect(initial.source).toBe('glb')
  expect(initial.adapter).toBe('typewriter-v1')
  expect(initial.parts).toHaveLength(572)
  expect(initial.meshes.length).toBeGreaterThan(0)
  await writeFile(output + '/initial.json', JSON.stringify(initial, null, 2))
  report.checks.push('Real GLB, 572 semantic parts, instanced surfaces and one Canvas')
  await page.getByRole('button', { name: '结构与动作', exact: true }).click()
  await expect(page.locator('.wb-layout-motion input[type=range]')).toHaveCount(0)
  await page.getByRole('button', { name: '分层展开', exact: true }).click()
  await page.waitForTimeout(700)
  await page.getByRole('button', { name: '暂停', exact: true }).click()
  const paused = await state()
  await page.waitForTimeout(400)
  expect((await state()).parts).toEqual(paused.parts)
  expect(paused.parts).not.toEqual(initial.parts)
  await page.getByRole('button', { name: '继续', exact: true }).click()
  await expect(page.getByRole('button', { name: '分层展开', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
    { timeout: 10000 },
  )
  report.checks.push('Button-driven layout, pause/resume, no public percentage slider')
  await page.getByRole('button', { name: '平铺部件', exact: true }).click()
  await expect(page.getByRole('button', { name: '平铺部件', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
    { timeout: 10000 },
  )
  await page.getByLabel('观察视角', { exact: true }).selectOption('knoll')
  await page.waitForTimeout(800)
  const flat = await state()
  expect(flat.parts).not.toEqual(initial.parts)
  await page.getByRole('button', { name: '复原动作', exact: true }).click()
  await expect.poll(async () => (await state()).parts).toEqual(initial.parts)
  expect((await state()).camera).toEqual(flat.camera)
  report.checks.push('Flat layout and exact action reset without camera reset')
  await page.getByRole('button', { name: '击发 A 键', exact: true }).click()
  await page.waitForTimeout(80)
  expect((await state()).parts).not.toEqual(initial.parts)
  await expect.poll(async () => (await state()).parts).toEqual(initial.parts)
  report.checks.push('A key / lever / typebar linkage returns to rest')
  await page.getByRole('button', { name: '细节', exact: true }).click()
  await page.getByLabel('查找部件', { exact: true }).fill('A')
  await expect(page.locator('.wb-part-list button')).toHaveCount(2)
  await expect(page.locator('.wb-part-list')).toContainText('按键 · 24 · A')
  await expect(page.locator('.wb-part-list')).toContainText('字杆 24 · A')
  await page.getByLabel('查找部件', { exact: true }).fill('按键')
  await expect(page.locator('.wb-part-list button').first()).toBeVisible()
  await page.locator('.wb-part-list button').first().click()
  await expect(page.locator('.wb-part-copy')).toBeVisible()
  await page.getByRole('button', { name: '返回全景', exact: true }).click()
  report.checks.push('Semantic search, focus, world anchors and return to overview')
  expect((await state()).sameCanvas).toBe(true)
  expect((await state()).sameRenderer).toBe(true)
  expect(
    report.requests
      .filter((url) => /^https?:/.test(url))
      .every((url) => new URL(url).origin === new URL(base).origin),
  ).toBe(true)
  expect(report.errors).toEqual([])
  report.passed = true
} finally {
  await browser.close()
  await writeFile(output + '/report.json', JSON.stringify(report, null, 2))
}
console.log(
  JSON.stringify({ passed: report.passed, fixture, checks: report.checks, errors: report.errors }),
)
