/* global URL, fetch, WebGL2RenderingContext, structuredClone */
import { chromium, expect } from '@playwright/test'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import sharp from 'sharp'
import { Matrix4, Vector3 } from 'three'
import { demoProducts, readDemoConfig } from './demo/config.mjs'

const base = process.env.CHECK_URL || 'http://127.0.0.1:5182'
// Every API request, including preview and restoration, is pinned to the isolated restore server.
const backend = 'http://127.0.0.1:8091'
const frontend = new URL(base)
if (frontend.hostname !== '127.0.0.1' || frontend.protocol !== 'http:' || frontend.port === '5181')
  throw new Error('管理联合验收只允许本机隔离前端（默认 5182），禁止使用正式 5181。')
const config = readDemoConfig()
const output = process.env.DEMO_ADMIN_OUTPUT || 'artifacts/demo/admin-flow'
const timeout = 180000
const report = {
  passed: false,
  frontend: base,
  backend,
  database: 'trees_x_restore_test',
  products: [],
  errors: [],
  restored: [],
}
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
await context.route('**/api/**', async (route) => {
  const url = new URL(route.request().url())
  await route.fulfill({ response: await route.fetch({ url: backend + url.pathname + url.search }) })
})
await context.addInitScript(() => {
  const names = new WeakMap()
  const matrices = new WeakMap()
  window.__adminViewMatrices = matrices
  const prototype = WebGL2RenderingContext.prototype
  const locate = prototype.getUniformLocation
  const matrix = prototype.uniformMatrix4fv
  prototype.getUniformLocation = function (program, name) {
    const location = locate.call(this, program, name)
    if (location) names.set(location, name)
    return location
  }
  prototype.uniformMatrix4fv = function (location, transpose, data, ...rest) {
    if (names.get(location) === 'viewMatrix')
      matrices.set(this.canvas, Array.from(data).slice(0, 16))
    return matrix.call(this, location, transpose, data, ...rest)
  }
})
const page = await context.newPage()
let visitor
const originals = new Map()
const changed = new Set()
context.on('page', (target) => target.on('pageerror', (error) => report.errors.push(error.message)))
page.on('pageerror', (error) => report.errors.push(error.message))
async function api(path, method = 'GET', body) {
  return page.evaluate(
    async ({ path, method, body }) => {
      const headers = { Accept: 'application/json' }
      if (method !== 'GET') {
        const token = await (await fetch('/api/v1/admin/session/csrf')).json()
        headers[token.headerName] = token.token
        headers['Content-Type'] = 'application/json'
      }
      const response = await fetch(path, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
      return {
        status: response.status,
        data: response.status === 204 ? null : await response.json(),
      }
    },
    { path, method, body },
  )
}
async function detail(slug) {
  const result = await api('/api/v1/admin/products/' + slug)
  expect(result.status).toBe(200)
  return result.data
}
async function tab(name) {
  await page
    .getByRole('navigation', { name: '商品编辑分区' })
    .getByRole('button', { name, exact: true })
    .click()
}
async function draftConfig() {
  await tab('高级配置')
  return JSON.parse(await page.getByLabel('完整展示配置 JSON', { exact: true }).inputValue())
}
async function ready(target, slug) {
  await expect(target.locator('.workbench')).toHaveAttribute('data-slug', slug)
  await expect(target.locator('.workbench')).toHaveAttribute('data-status', 'ready', { timeout })
  await expect(target.locator('canvas')).toHaveCount(1)
}
async function viewMatrix(target) {
  await target.waitForTimeout(120)
  return target.evaluate(() => {
    const matrix = window.__adminViewMatrices.get(document.querySelector('canvas'))
    if (!matrix || !matrix.every(Number.isFinite)) throw new Error('缺少实际 WebGL viewMatrix。')
    return matrix
  })
}
function cameraPosition(matrix) {
  return [0, 4, 8].map(
    (index) =>
      -(
        matrix[index] * matrix[12] +
        matrix[index + 1] * matrix[13] +
        matrix[index + 2] * matrix[14]
      ),
  )
}
function expectedMatrix(camera) {
  const position = new Vector3().fromArray(camera.position)
  return new Matrix4()
    .lookAt(position, new Vector3().fromArray(camera.target), new Vector3(0, 1, 0))
    .setPosition(position)
    .invert().elements
}
function near(actual, expected, tolerance = 0.0002) {
  expect(Math.max(...actual.map((value, index) => Math.abs(value - expected[index])))).toBeLessThan(
    tolerance,
  )
}
const canonical = (value) =>
  JSON.parse(JSON.stringify(value, (_key, item) => (item === null ? undefined : item)))
async function pixels(target, name) {
  const screenshot = await target.locator('canvas').screenshot({
    path: `${output}/${name}.png`,
    timeout,
    style: '.wb-hotspots,.wb-intro,.wb-tools,.wb-input-hint{visibility:hidden!important}',
  })
  const { data, info } = await sharp(screenshot)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const colors = new Set()
  let minimum = 255,
    maximum = 0
  for (let index = 0; index < data.length; index += info.channels * 16) {
    colors.add(`${data[index]},${data[index + 1]},${data[index + 2]}`)
    const value = (data[index] + data[index + 1] + data[index + 2]) / 3
    minimum = Math.min(minimum, value)
    maximum = Math.max(maximum, value)
  }
  expect(colors.size).toBeGreaterThan(64)
  expect(maximum - minimum).toBeGreaterThan(25)
  return {
    data,
    info,
    evidence: {
      file: name + '.png',
      width: info.width,
      height: info.height,
      sampledColors: colors.size,
      luminanceRange: maximum - minimum,
      sha256: createHash('sha256').update(data).digest('hex'),
    },
  }
}
function pixelChange(before, after) {
  expect(after.info.width).toBe(before.info.width)
  expect(after.info.height).toBe(before.info.height)
  let changedPixels = 0
  for (let index = 0; index < before.data.length; index += before.info.channels)
    if (
      [0, 1, 2].reduce(
        (total, channel) =>
          total + Math.abs(before.data[index + channel] - after.data[index + channel]),
        0,
      ) > 24
    )
      changedPixels++
  const ratio = changedPixels / (before.info.width * before.info.height)
  expect(ratio).toBeGreaterThan(0.002)
  return ratio
}
async function restore(slug) {
  const original = originals.get(slug)
  const current = await detail(slug)
  const restored = await api('/api/v1/admin/products/' + slug, 'PUT', {
    ...original.item,
    revision: current.item.revision,
    presentation: original.presentation,
  })
  expect(restored.status).toBe(200)
  expect(canonical(restored.data.presentation)).toEqual(canonical(original.presentation))
  const oldItem = { ...original.item }
  const newItem = { ...restored.data.item }
  delete oldItem.revision
  delete newItem.revision
  expect(newItem).toEqual(oldItem)
  changed.delete(slug)
  report.restored.push(slug)
}
try {
  await page.goto(base + '/admin')
  await page
    .getByLabel('管理员账号', { exact: true })
    .fill(config.env.TREES_ADMIN_USERNAME ?? 'admin')
  await page.getByLabel('密码', { exact: true }).fill(config.env.TREES_ADMIN_PASSWORD ?? '123456')
  await page.getByRole('button', { name: '登录管理端', exact: true }).click()
  await expect(page.getByRole('button', { name: '退出登录', exact: true })).toBeVisible()
  for (const { slug, manifest } of demoProducts) {
    console.log(JSON.stringify({ event: 'demo-admin-product', slug }))
    const original = await detail(slug)
    originals.set(slug, original)
    expect(original.item.listed).toBe(true)
    expect(original.presentation.source.kind).toBe('glb')
    expect(original.presentation.source.bundle.manifest).toBe(manifest)
    const entry = { slug, checks: [], pixels: [] }
    report.products.push(entry)
    await page.getByRole('button', { name: '编辑' + original.item.name, exact: true }).click()
    const description = original.item.description + '（隔离库管理联合验收，完成后恢复。）'
    await page.getByLabel('商品介绍', { exact: true }).fill(description)
    const previewResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/v1/admin/products/preview' &&
        response.request().method() === 'POST',
    )
    await page.getByRole('button', { name: '预览当前配置', exact: true }).click()
    expect((await (await previewResponse).json()).description).toBe(description)
    await ready(page, slug)
    entry.pixels.push((await pixels(page, slug + '-unsaved-preview')).evidence)
    await page.getByRole('button', { name: '返回编辑', exact: true }).click()
    await expect(page.locator('canvas')).toHaveCount(0)
    expect(await detail(slug)).toEqual(original)
    entry.checks.push(
      'Unsaved description reaches the real GLB preview; API and complete configuration remain unchanged.',
    )
    await tab('镜头')
    await page.getByRole('button', { name: '为默认取景采集镜头', exact: true }).click()
    await ready(page, slug)
    const before = await viewMatrix(page)
    const point = await page.evaluate(() => {
      const canvas = document.querySelector('canvas')
      const bounds = canvas.getBoundingClientRect()
      for (const y of [0.45, 0.55, 0.65, 0.35])
        for (const x of [0.55, 0.65, 0.45, 0.75, 0.35]) {
          const candidate = { x: bounds.x + bounds.width * x, y: bounds.y + bounds.height * y }
          if (document.elementFromPoint(candidate.x, candidate.y) === canvas) return candidate
        }
      throw new Error('预览 Canvas 没有可用的真实拖动输入位置。')
    })
    await page.mouse.move(point.x, point.y)
    await page.mouse.down({ button: 'right' })
    await page.mouse.move(point.x + 38, point.y + 12, { steps: 8 })
    await page.mouse.up({ button: 'right' })
    const actual = await viewMatrix(page)
    expect(actual).not.toEqual(before)
    await page.getByRole('button', { name: '使用此取景并返回', exact: true }).click()
    await expect(page.locator('canvas')).toHaveCount(0)
    const captured = await draftConfig()
    near(captured.camera.position, cameraPosition(actual))
    expect(captured.camera.target).not.toEqual(original.presentation.camera.target)
    const perspective = captured.views.find((view) => view.id === 'perspective')
    expect(perspective.position).toEqual(captured.camera.position)
    expect(perspective.target).toEqual(captured.camera.target)
    const expected = structuredClone(original.presentation)
    expected.camera.position = captured.camera.position
    expected.camera.target = captured.camera.target
    const expectedPerspective = expected.views.find((view) => view.id === 'perspective')
    expectedPerspective.position = captured.camera.position
    expectedPerspective.target = captured.camera.target
    expect(canonical(captured)).toEqual(canonical(expected))
    expect(await detail(slug)).toEqual(original)
    changed.add(slug)
    await page.getByRole('button', { name: '保存修改', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: /^已保存。/ })).toBeVisible()
    const saved = await detail(slug)
    expect(saved.item.description).toBe(description)
    expect(canonical(saved.presentation)).toEqual(canonical(expected))
    entry.camera = captured.camera
    entry.checks.push(
      'Real right-button pan is captured, remains unsaved until explicit save, and updates only default camera plus perspective view.',
    )
    await page.getByRole('button', { name: '返回商品列表', exact: true }).click()
    await expect(page.locator('canvas')).toHaveCount(0)
    visitor = await context.newPage()
    await visitor.goto(base + '/?product=' + slug)
    await ready(visitor, slug)
    await visitor.reload()
    await ready(visitor, slug)
    const visitorMatrix = await viewMatrix(visitor)
    near(visitorMatrix, expectedMatrix(saved.presentation.camera))
    entry.visitorViewMatrix = visitorMatrix
    entry.pixels.push((await pixels(visitor, slug + '-saved-visitor')).evidence)
    await visitor.getByRole('button', { name: '细节', exact: true }).click()
    const hotspot = visitor.locator('.wb-part-list button').first()
    const hotspotName = await hotspot.textContent()
    await hotspot.click()
    await expect(hotspot).toHaveAttribute('aria-pressed', 'true')
    await expect(visitor.locator('.wb-part-copy')).toContainText(hotspotName.trim())
    await visitor.waitForTimeout(1200)
    expect(await viewMatrix(visitor)).not.toEqual(visitorMatrix)
    entry.pixels.push((await pixels(visitor, slug + '-saved-hotspot')).evidence)
    await visitor.getByRole('button', { name: '返回全景', exact: true }).click()
    await visitor.waitForTimeout(1200)
    near(await viewMatrix(visitor), expectedMatrix(saved.presentation.camera))
    await visitor.getByRole('button', { name: '结构与动作', exact: true }).click()
    await visitor.waitForTimeout(300)
    const actionBefore = await pixels(visitor, slug + '-action-before')
    const matrixBefore = await viewMatrix(visitor)
    const actionButton =
      slug === 'typewriter-study'
        ? visitor
            .locator('.wb-layout-choices')
            .getByRole('button', { name: '分层展开', exact: true })
        : slug === 'piano-cfx'
          ? visitor.locator('.wb-piano-chapters').getByRole('button', { name: '剖切', exact: true })
          : visitor.locator('[data-motion-id="open-doors"]').getByRole('button', {
              name: saved.presentation.actions.find((action) => action.id === 'open-doors').motion
                .openLabel,
              exact: true,
            })
    await actionButton.click()
    await expect(actionButton).toHaveAttribute('aria-pressed', 'true', { timeout: 30000 })
    await visitor.waitForTimeout(250)
    near(await viewMatrix(visitor), matrixBefore)
    const actionAfter = await pixels(visitor, slug + '-action-after')
    entry.actionPixelChange = pixelChange(actionBefore, actionAfter)
    entry.pixels.push(actionBefore.evidence, actionAfter.evidence)
    entry.checks.push(
      'Visitor reload renders the saved viewMatrix; hotspot changes the real camera; structure action changes rendered model pixels while preserving that camera.',
    )
    await visitor.close()
    visitor = undefined
    await restore(slug)
  }
  expect(report.errors).toEqual([])
  report.passed = true
} catch (error) {
  report.failure = String(error)
  throw error
} finally {
  if (visitor) await visitor.close()
  for (const slug of changed) {
    try {
      await restore(slug)
    } catch (error) {
      report.errors.push('隔离商品恢复失败：' + slug + '；' + error.message)
      report.passed = false
    }
  }
  await writeFile(output + '/report.json', JSON.stringify(report, null, 2) + '\n')
  await browser.close()
}
console.log(JSON.stringify(report, null, 2))
if (!report.passed) process.exitCode = 1
