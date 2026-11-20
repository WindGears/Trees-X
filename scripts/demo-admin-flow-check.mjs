/* global URL, fetch, WebGL2RenderingContext, structuredClone */
import { chromium, expect } from '@playwright/test'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import sharp from 'sharp'
import { Matrix4, Vector3 } from 'three'
import { demoProducts, readDemoConfig } from './demo/config.mjs'
import { bridge } from './demo/browser-check.mjs'

const base = process.env.CHECK_URL || 'http://127.0.0.1:5182'
// Every API request, including preview and restoration, is pinned to the isolated restore server.
const backend = 'http://127.0.0.1:8091'
const frontend = new URL(base)
if (frontend.hostname !== '127.0.0.1' || frontend.protocol !== 'http:' || frontend.port === '5181')
  throw new Error('管理联合验收只允许本机隔离前端（默认 5182），禁止使用正式 5181。')
const config = readDemoConfig()
const output = process.env.DEMO_ADMIN_OUTPUT || 'artifacts/demo/admin-flow'
const showcase = process.env.DEMO_ADMIN_SHOWCASE === '1'
const selected = process.env.DEMO_ADMIN_PRODUCT
const captureDesktop = process.env.DEMO_ADMIN_DESKTOP === '1'
const testedProducts = selected
  ? demoProducts.filter((item) => item.slug === selected)
  : demoProducts
if (!testedProducts.length) throw new Error('未知的隔离测试展品：' + selected)
function pageUrl(path) {
  const url = new URL(path, frontend)
  url.searchParams.set('renderPipeline', showcase ? 'showcase' : 'webgl')
  return url.href
}
const timeout = 180000
const report = {
  passed: false,
  frontend: base,
  backend,
  database: showcase ? 'isolated showcase backend on 8091' : 'trees_x_restore_test',
  showcase,
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
  if (showcase) {
    await bridge(target)
    return target.evaluate(() => {
      const { scene } = window.__demo
      if (!scene.renderer.instance.backend.isWebGPUBackend)
        throw new Error('缺少实际 WebGPU 后端。')
      return scene.camera.activeCamera.value.matrixWorldInverse.toArray()
    })
  }
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
function matrixDelta(actual, expected) {
  return Math.max(...actual.map((value, index) => Math.abs(value - expected[index])))
}
function near(actual, expected, tolerance = 0.0002) {
  expect(matrixDelta(actual, expected)).toBeLessThan(tolerance)
}
const canonical = (value) =>
  JSON.parse(JSON.stringify(value, (_key, item) => (item === null ? undefined : item)))
async function pixels(target, name) {
  const screenshot = await target.locator('canvas').screenshot({
    path: `${output}/${name}.png`,
    timeout,
    style:
      '.wb-hotspots,.wb-intro,.wb-tools,.wb-input-hint,.wb-panel,.wb-stage-status,.exhibit-part-detail{visibility:hidden!important}',
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
async function adminDesktopScreens(target) {
  const layouts = [
    { width: 1280, height: 720 },
    { width: 1440, height: 1000 },
    { width: 1920, height: 1080 },
  ]
  try {
    for (const size of layouts) {
      await target.setViewportSize(size)
      const documentWidth = await target.evaluate(() => document.documentElement.scrollWidth)
      expect(documentWidth).toBeLessThanOrEqual(size.width)
      await target.screenshot({ path: `${output}/editor-${size.width}.png` })
    }
  } finally {
    await target.setViewportSize({ width: 1440, height: 1000 })
  }
  return layouts
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
function legacyStructureStep(panel, slug, presentation) {
  if (slug === 'typewriter-study')
    return panel
      .locator('.wb-layout-choices')
      .getByRole('button', { name: '分层展开', exact: true })
  if (slug === 'piano-cfx')
    return panel.locator('.wb-piano-chapters').getByRole('button', { name: '剖切', exact: true })
  return panel.locator('[data-motion-id="open-doors"]').getByRole('button', {
    name: presentation.actions.find((action) => action.id === 'open-doors').motion.openLabel,
    exact: true,
  })
}

const showcaseTasks = {
  'typewriter-study': {
    part: 'part-095',
    action: { label: '分层展开', id: 'explore-layout', progress: 0.6, view: 'structure' },
  },
  'piano-cfx': {
    part: 'piano-part-435',
    action: { label: '剖切', id: 'sound-path', progress: 1 / 7, view: 'piano-section' },
  },
  reventon: {
    part: 'headlights',
    action: { label: '打开双门', id: 'open-doors', progress: 1 },
  },
}

async function inspectSavedPart(target, slug, presentation, entry, savedMatrix) {
  const inspector = target.locator('#wb-inspector')
  let detail
  let back
  if (showcase) {
    await target.getByRole('button', { name: '观察工具', exact: true }).click()
    const sheet = target.getByRole('dialog', { name: '观察工具', exact: true })
    const part = presentation.hotspots.find((item) => item.id === showcaseTasks[slug].part)
    expect(part, `Missing initial-pose inspectable part for ${slug}`).toBeTruthy()
    await sheet.getByRole('searchbox', { name: '查找部件' }).fill(part.name)
    await sheet.getByRole('button', { name: part.name, exact: true }).click()
    detail = target.locator('.exhibit-part-detail')
    await expect(detail.getByRole('heading', { name: part.name, exact: true })).toBeVisible()
    back = '回到本段'
  } else {
    await target.getByRole('button', { name: '细节', exact: true }).click()
    const hotspot = inspector.locator('.wb-part-list button').first()
    const hotspotName = await hotspot.textContent()
    await hotspot.click()
    await expect(hotspot).toHaveAttribute('aria-pressed', 'true')
    detail = inspector.locator('.wb-part-copy')
    await expect(detail).toContainText(hotspotName.trim())
    back = '返回全景'
  }
  await expect
    .poll(async () => matrixDelta(await viewMatrix(target), savedMatrix))
    .toBeGreaterThan(0.01)
  entry.pixels.push((await pixels(target, slug + '-saved-hotspot')).evidence)
  await detail.getByRole('button', { name: back, exact: true }).click()
  const expected = expectedMatrix(presentation.camera)
  await expect
    .poll(async () => matrixDelta(await viewMatrix(target), expected))
    .toBeLessThan(0.0002)
  await expect(detail).toBeHidden()
}

async function verifySavedAction(target, slug, presentation, entry) {
  const inspector = target.locator('#wb-inspector')
  if (!showcase) await target.getByRole('button', { name: '结构与动作', exact: true }).click()
  const before = await pixels(target, slug + '-action-before')
  const matrixBefore = await viewMatrix(target)
  if (showcase) {
    const action = showcaseTasks[slug].action
    await target.getByRole('button', { name: action.label, exact: true }).click()
    await target.waitForFunction(
      ({ id, progress }) => {
        const state = window.__demo.motion.snapshot()[id]
        return state && !state.playing && Math.abs(state.progress - progress) < 0.0001
      },
      { id: action.id, progress: action.progress },
      { timeout },
    )
    if (action.view) {
      const view = presentation.views.find((item) => item.id === action.view)
      expect(view, `Missing suggested chapter view for ${slug}`).toBeTruthy()
      near(await viewMatrix(target), expectedMatrix(view))
      entry.suggestedView = view.id
    } else near(await viewMatrix(target), matrixBefore)
  } else {
    const action = legacyStructureStep(inspector, slug, presentation)
    await action.click()
    await expect(action).toHaveAttribute('aria-pressed', 'true', { timeout: 30000 })
    await target.waitForTimeout(250)
    near(await viewMatrix(target), matrixBefore)
  }
  const after = await pixels(target, slug + '-action-after')
  entry.actionPixelChange = pixelChange(before, after)
  entry.pixels.push(before.evidence, after.evidence)
  entry.checks.push(
    showcase
      ? 'Visitor renders the saved camera, part inspection returns to it, and the chapter reaches real structure progress and its suggested view when configured.'
      : 'Visitor reload renders the saved viewMatrix; hotspot changes the real camera; structure action changes rendered model pixels while preserving that camera.',
  )
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
  await page.goto(pageUrl('/admin'))
  await page
    .getByLabel('管理员账号', { exact: true })
    .fill(config.env.TREES_ADMIN_USERNAME ?? 'admin')
  await page.getByLabel('密码', { exact: true }).fill(config.env.TREES_ADMIN_PASSWORD ?? '123456')
  await page.getByRole('button', { name: '登录管理端', exact: true }).click()
  await expect(page.getByRole('button', { name: '退出登录', exact: true })).toBeVisible()
  for (const { slug, manifest } of testedProducts) {
    console.log(JSON.stringify({ event: 'demo-admin-product', slug }))
    const original = await detail(slug)
    originals.set(slug, original)
    expect(original.item.listed).toBe(true)
    expect(original.presentation.source.kind).toBe('glb')
    expect(original.presentation.source.bundle.manifest).toBe(manifest)
    const entry = { slug, checks: [], pixels: [] }
    report.products.push(entry)
    await page.getByRole('button', { name: '编辑' + original.item.name, exact: true }).click()
    await expect(page.getByLabel('商品介绍', { exact: true })).toBeVisible({ timeout })
    if (captureDesktop && report.products.length === 1)
      report.desktop = await adminDesktopScreens(page)
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
    if (captureDesktop) await page.screenshot({ path: `${output}/${slug}-preview-ui.png` })
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
    const persisted = canonical(saved.presentation)
    const savedPerspective = persisted.views.find((view) => view.id === 'perspective')
    expect(savedPerspective).toBeTruthy()
    // Database JSON serialization may round the last floating-point digit.
    for (const [actual, draft] of [
      [persisted.camera, expected.camera],
      [savedPerspective, expectedPerspective],
    ]) {
      for (const key of ['position', 'target']) {
        expect(actual[key]).toHaveLength(3)
        near(actual[key], draft[key], 1e-12)
        actual[key] = draft[key]
      }
    }
    expect(persisted).toEqual(canonical(expected))
    entry.camera = captured.camera
    entry.checks.push(
      'Real right-button pan is captured, remains unsaved until explicit save, and updates only default camera plus perspective view.',
    )
    await page.getByRole('button', { name: '返回商品列表', exact: true }).click()
    await expect(page.locator('canvas')).toHaveCount(0)
    visitor = await context.newPage()
    await visitor.goto(pageUrl('/?product=' + slug))
    await ready(visitor, slug)
    await visitor.reload()
    await ready(visitor, slug)
    const visitorMatrix = await viewMatrix(visitor)
    near(visitorMatrix, expectedMatrix(saved.presentation.camera))
    entry.visitorViewMatrix = visitorMatrix
    entry.pixels.push((await pixels(visitor, slug + '-saved-visitor')).evidence)
    await inspectSavedPart(visitor, slug, saved.presentation, entry, visitorMatrix)
    await verifySavedAction(visitor, slug, saved.presentation, entry)
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
