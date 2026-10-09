/* global URL, fetch, structuredClone, WebGL2RenderingContext */
import { chromium, expect } from '@playwright/test'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'

const base = process.env.CHECK_URL || 'http://127.0.0.1:5181'
const backend = process.env.ADMIN_CHECK_API || 'http://127.0.0.1:8090'
// The browser proxy points at an isolated trees_x_test server. Never edit live products.
if (new URL(backend).port !== '8090')
  throw new Error('Admin browser checks require the isolated test backend on 8090.')
const env = Object.fromEntries(
  (await readFile('server/.env.local', 'utf8'))
    .split(/\r?\n/)
    .filter((l) => /^TREES_ADMIN_/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
)
const output = process.env.ADMIN_CHECK_OUTPUT || 'artifacts/admin'
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const report = {
  frontend: base,
  api: 'Real Spring Boot / trees_x_test, same-origin browser proxy',
  passed: false,
  checks: [],
  errors: [],
  captures: [],
  reusedCaptures: [],
}
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
await context.route('**/api/**', async (route) => {
  const path = new URL(route.request().url())
  await route.fulfill({
    response: await route.fetch({ url: backend + path.pathname + path.search }),
  })
})
const page = await context.newPage()
// Production Vue does not expose debug component internals. Observe the real
// WebGL view uniform in the test browser instead of adding an app debug API.
await context.addInitScript(() => {
  const names = new WeakMap(),
    matrices = new WeakMap()
  window.__adminViewMatrices = matrices
  const proto = WebGL2RenderingContext.prototype
  const getLocation = proto.getUniformLocation,
    setMatrix = proto.uniformMatrix4fv
  proto.getUniformLocation = function (program, name) {
    const location = getLocation.call(this, program, name)
    if (location) names.set(location, name)
    return location
  }
  proto.uniformMatrix4fv = function (location, transpose, data, ...rest) {
    if (names.get(location) === 'viewMatrix')
      matrices.set(this.canvas, Array.from(data).slice(0, 16))
    return setMatrix.call(this, location, transpose, data, ...rest)
  }
})
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
      const res = await fetch(path, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
      return { status: res.status, data: res.status === 204 ? null : await res.json() }
    },
    { path, method, body },
  )
}
async function login() {
  await page.getByLabel('管理员账号', { exact: true }).fill(env.TREES_ADMIN_USERNAME)
  await page.getByLabel('密码', { exact: true }).fill(env.TREES_ADMIN_PASSWORD)
  await page.getByRole('button', { name: '登录管理端', exact: true }).click()
  await expect(page.getByRole('button', { name: '退出登录', exact: true })).toBeVisible()
}
async function capture(name) {
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.mouse.move(1, 1)
  await page.waitForTimeout(180)
  if (process.env.ADMIN_SKIP_CAPTURES !== '1') {
    if (process.env.ADMIN_CAPTURE_RESUME === '1' && existsSync(`${output}/${name}.png`))
      report.reusedCaptures.push(name)
    else await page.screenshot({ path: `${output}/${name}.png`, fullPage: true })
    report.captures.push(name)
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
}
const tab = async (name, selected = true) => {
  const button = page
    .getByRole('navigation', { name: '商品编辑分区' })
    .getByRole('button', { name, exact: true })
  await button.click()
  if (selected) await expect(button).toHaveAttribute('aria-current', 'page')
}
async function draftConfig() {
  await tab('高级配置')
  return JSON.parse(await page.getByLabel('完整展示配置 JSON', { exact: true }).inputValue())
}
async function readyPreview() {
  await expect(page.locator('.ad-preview .workbench')).toHaveAttribute('data-status', 'ready', {
    timeout: 30000,
  })
  await expect(page.locator('canvas')).toHaveCount(1)
}
async function realCamera(targetPage = page) {
  await targetPage.waitForTimeout(80)
  return targetPage.evaluate(() => {
    let component = document.querySelector('canvas').__vueParentComponent
    while (component) {
      const context =
        component.exposed?.context ??
        Reflect.ownKeys(component.provides ?? {})
          .map((k) => component.provides[k])
          .find((v) => v?.scene?.value?.isScene)
      if (context) return context.camera.activeCamera.value.position.toArray()
      component = component.parent
    }
    const matrix = window.__adminViewMatrices.get(document.querySelector('canvas'))
    if (!matrix) throw new Error('Missing real Three view matrix')
    return [0, 4, 8].map(
      (index) =>
        -(
          matrix[index] * matrix[12] +
          matrix[index + 1] * matrix[13] +
          matrix[index + 2] * matrix[14]
        ),
    )
  })
}
let original, category
try {
  await page.goto(base + '/admin')
  await expect(page.getByRole('heading', { name: '管理员登录' })).toBeVisible()
  await capture('login-1440')
  await page.getByLabel('管理员账号', { exact: true }).fill('wrong')
  await page.getByLabel('密码', { exact: true }).fill('wrong')
  await page.getByRole('button', { name: '登录管理端', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('账号或密码不正确')
  await login()
  expect(await page.locator('canvas').count()).toBe(0)
  original = (await api('/api/v1/admin/products/typewriter-study')).data
  report.checks.push('Authentication, wrong password feedback and no scene on the listing')
  await capture('products-1440')
  await page.getByRole('button', { name: '商品分类', exact: true }).click()
  await page.getByLabel('分类名称', { exact: true }).fill('管理验证分类')
  await page.getByLabel('排序', { exact: true }).fill('33')
  await page.getByRole('button', { name: '保存分类', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('分类已保存')
  category = (await api('/api/v1/admin/categories')).data.find((c) => c.name === '管理验证分类')
  await capture('categories-1440')
  await page.getByRole('button', { name: '商品与展示配置', exact: true }).click()
  await page.getByRole('button', { name: '编辑机械打字机', exact: true }).click()
  await page.getByRole('button', { name: '下架商品', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('已下架')
  expect((await api('/api/v1/products/typewriter-study')).status).toBe(404)
  await page.getByLabel('商品名称', { exact: true }).fill('打字机管理验证')
  await page.getByLabel('商品分类', { exact: true }).selectOption(String(category.id))
  await page
    .getByLabel('商品介绍', { exact: true })
    .fill('管理员编辑与预览验证，完成后恢复原配置。')
  await tab('镜头')
  await page.getByLabel('最近距离', { exact: true }).fill('')
  await expect(page.getByRole('button', { name: '保存修改', exact: true })).toBeDisabled()
  await tab('基本信息')
  await tab('镜头')
  await expect(page.getByLabel('最近距离', { exact: true })).toHaveValue('')
  await page
    .getByLabel('最近距离', { exact: true })
    .fill(String(original.presentation.camera.minDistance))
  await tab('部件热点')
  await page.getByLabel('部件说明', { exact: true }).first().fill('管理端填写的按键观察说明。')
  const parts = page.locator('section[aria-label="部件热点"] article')
  const partCount = await parts.count()
  const boundPart = original.presentation.guide.find((step) => step.hotspotId)?.hotspotId
  const boundIndex = original.presentation.hotspots.findIndex((part) => part.id === boundPart)
  if (boundIndex < 0) throw new Error('Fixture has no guide-bound hotspot')
  await expect(parts.nth(boundIndex).getByRole('button', { name: /^删除/ })).toBeDisabled()
  await parts.first().getByRole('button', { name: /^复制/ }).click()
  await expect(parts).toHaveCount(partCount + 1)
  await parts.last().getByRole('button', { name: /^上移/ }).click()
  await parts
    .nth(partCount - 1)
    .getByRole('button', { name: /^删除/ })
    .click()
  await expect(parts).toHaveCount(partCount)
  await page.getByRole('button', { name: '新增部件', exact: true }).click()
  await expect(page.getByRole('button', { name: '保存修改', exact: true })).toBeDisabled()
  await parts.last().getByLabel('部件名称', { exact: true }).fill('临时观察点')
  await parts
    .last()
    .getByLabel('绑定节点', { exact: true })
    .fill(original.presentation.hotspots[0].node)
  await parts.last().getByLabel('部件说明', { exact: true }).fill('用于检验表单，不保存此条。')
  await expect(page.getByRole('button', { name: '保存修改', exact: true })).toBeEnabled()
  await parts.last().getByRole('button', { name: /^删除/ }).click()
  await tab('外观')
  const hex = page.getByLabel('十六进制颜色', { exact: true }).first()
  await hex.fill('#BAD')
  await expect(page.getByRole('button', { name: '保存修改', exact: true })).toBeDisabled()
  await hex.fill(original.presentation.finishes[0].color)
  const finishes = page.locator('section[aria-label="外观配置"] article')
  const finishCount = await finishes.count()
  await page.getByRole('button', { name: '新增外观', exact: true }).click()
  await finishes.last().getByLabel('外观名称', { exact: true }).fill('临时外观')
  await finishes.last().getByRole('button', { name: /^复制/ }).click()
  await expect(finishes).toHaveCount(finishCount + 2)
  await finishes.last().getByRole('button', { name: /^上移/ }).click()
  await finishes.last().getByRole('button', { name: /^删除/ }).click()
  await finishes.last().getByRole('button', { name: /^删除/ }).click()
  await expect(finishes).toHaveCount(finishCount)
  const block = await draftConfig()
  const editor = page.getByLabel('完整展示配置 JSON', { exact: true })
  await editor.fill('{ invalid')
  await expect(page.getByRole('button', { name: '保存修改', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: '应用到表单', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('原表单未被覆盖')
  page.once('dialog', (dialog) => dialog.dismiss())
  await tab('基本信息', false)
  await expect(editor).toBeVisible()
  await page.getByRole('button', { name: '放弃 JSON 输入', exact: true }).click()
  const missing = structuredClone(block)
  missing.hotspots[0].node = 'missing-node'
  await editor.fill(JSON.stringify(missing, null, 2))
  await page.getByRole('button', { name: '应用到表单', exact: true }).click()
  await page.getByRole('button', { name: '预览当前配置', exact: true }).click()
  await expect(page.locator('.ad-preview .workbench')).toHaveAttribute('data-status', 'error', {
    timeout: 30000,
  })
  await expect(page.getByRole('button', { name: '打开目录', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: '重新加载', exact: true }).click()
  await expect(page.locator('.ad-preview .workbench')).toHaveAttribute('data-status', 'error', {
    timeout: 30000,
  })
  await page.getByRole('button', { name: '返回编辑', exact: true }).click()
  await tab('高级配置')
  await page.getByLabel('完整展示配置 JSON', { exact: true }).fill(JSON.stringify(block, null, 2))
  await page.getByRole('button', { name: '应用到表单', exact: true }).click()
  await page.getByRole('button', { name: '预览当前配置', exact: true }).click()
  await expect(page.locator('.ad-preview .workbench')).toHaveAttribute('data-status', 'ready', {
    timeout: 30000,
  })
  await expect(page.locator('canvas')).toHaveCount(1)
  const untouched = (await api('/api/v1/admin/products/typewriter-study')).data
  expect(untouched.item.name).toBe(original.item.name)
  await page.getByRole('button', { name: '细节', exact: true }).click()
  await page.locator('.wb-panel').getByRole('button', { name: '键盘', exact: true }).click()
  await expect(page.locator('.wb-panel')).toContainText('管理端填写的按键观察说明')
  await page.getByRole('button', { name: '结构与动作', exact: true }).click()
  await page.getByRole('button', { name: '演示按键联动', exact: true }).click()
  await capture('preview-1440')
  await page.getByRole('button', { name: '返回编辑', exact: true }).click()
  await expect(page.locator('canvas')).toHaveCount(0)
  await tab('基本信息')
  await expect(page.getByLabel('商品名称', { exact: true })).toHaveValue('打字机管理验证')
  // Capture is a user interaction with the real camera, and must not persist yet.
  await tab('镜头')
  await page.getByRole('button', { name: '为默认取景采集镜头', exact: true }).click()
  await readyPreview()
  const canvas = page.locator('canvas'),
    bounds = await canvas.boundingBox()
  const beforeCamera = await realCamera()
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
  await page.mouse.down({ button: 'right' })
  await page.mouse.move(bounds.x + bounds.width / 2 + 45, bounds.y + bounds.height / 2 + 12, {
    steps: 8,
  })
  await page.mouse.up({ button: 'right' })
  const actualCamera = await realCamera()
  expect(actualCamera).not.toEqual(beforeCamera)
  await page.getByRole('button', { name: '使用此取景并返回', exact: true }).click()
  await expect(page.locator('canvas')).toHaveCount(0)
  const captured = await draftConfig()
  captured.camera.position.forEach((value, index) =>
    expect(value).toBeCloseTo(actualCamera[index], 4),
  )
  expect(captured.camera.target).not.toEqual(original.presentation.camera.target)
  expect(captured.views.find((v) => v.id === 'perspective').position).toEqual(
    captured.camera.position,
  )
  expect((await api('/api/v1/admin/products/typewriter-study')).data.presentation.camera).toEqual(
    original.presentation.camera,
  )
  expect(captured.actions).toEqual(
    JSON.parse(
      JSON.stringify(block.actions, (_key, value) => (value === null ? undefined : value)),
    ),
  )
  // A named capture changes its view only; context recovery reuses the Canvas.
  await tab('镜头')
  await page.getByRole('button', { name: '新增视角', exact: true }).click()
  await page.getByLabel('视角名称', { exact: true }).last().fill('取景验证视角')
  await page.getByRole('button', { name: '为此视角采集镜头', exact: true }).last().click()
  await readyPreview()
  await page.evaluate(() => {
    window.__captureCanvas = document.querySelector('canvas')
    window.__captureLoss = window.__captureCanvas
      .getContext('webgl2')
      .getExtension('WEBGL_lose_context')
    if (!window.__captureLoss) throw new Error('Context loss extension unavailable')
    window.__captureLoss.loseContext()
  })
  await expect(page.locator('.ad-preview .workbench')).toHaveAttribute('data-status', 'error')
  await expect(page.getByRole('button', { name: '使用此取景并返回', exact: true })).toBeDisabled()
  await page.evaluate(() => window.__captureLoss.restoreContext())
  await readyPreview()
  expect(
    await page.evaluate(() => document.querySelector('canvas') === window.__captureCanvas),
  ).toBe(true)
  await page.getByRole('group', { name: '商品展示区', exact: true }).press('ArrowRight')
  const namedCamera = await realCamera()
  await page.getByRole('button', { name: '使用此取景并返回', exact: true }).click()
  const named = await draftConfig()
  expect(named.camera).toEqual(captured.camera)
  named.views
    .find((v) => v.label === '取景验证视角')
    .position.forEach((value, index) => expect(value).toBeCloseTo(namedCamera[index], 4))
  await tab('导览')
  await expect(page.getByLabel('结构状态', { exact: true }).first()).toHaveValue('')
  const guideCount = await page.locator('section[aria-label="导览配置"] article').count()
  await page.getByRole('button', { name: '新增步骤', exact: true }).click()
  const newStep = page.locator('section[aria-label="导览配置"] article').last()
  await newStep.getByLabel('导览标题', { exact: true }).fill('取景演示')
  await newStep.getByLabel('导览说明', { exact: true }).fill('观察刚才采集的镜头。')
  await newStep
    .getByLabel('观察视角', { exact: true })
    .selectOption(named.views.find((v) => v.label === '取景验证视角').id)
  await newStep.getByRole('button', { name: /^复制/ }).click()
  await page
    .locator('section[aria-label="导览配置"] article')
    .last()
    .getByRole('button', { name: /^删除/ })
    .click()
  await expect(page.locator('section[aria-label="导览配置"] article')).toHaveCount(guideCount + 1)
  report.checks.push(
    'Hotspot add/copy/reorder/delete and reference guard; invalid color; named-view capture; context recovery disables capture and keeps Canvas; guide form references and duplication',
  )
  await tab('基本信息')
  await page.getByRole('button', { name: '保存修改', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('已保存')
  await page.getByRole('button', { name: '上架商品', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('已上架')
  expect((await api('/api/v1/products/typewriter-study')).data.name).toBe('打字机管理验证')
  expect((await api('/api/v1/products/typewriter-study')).data.presentation.camera).toEqual(
    captured.camera,
  )
  const visitor = await context.newPage()
  await visitor.goto(base + '/?product=typewriter-study')
  await expect(visitor.locator('.workbench')).toHaveAttribute('data-status', 'ready', {
    timeout: 30000,
  })
  ;(await realCamera(visitor)).forEach((value, index) =>
    expect(value).toBeCloseTo(captured.camera.position[index], 4),
  )
  const viewport = visitor.getByRole('group', { name: '商品展示区', exact: true })
  await viewport.press('ArrowLeft')
  await viewport.press('Home')
  await visitor.waitForTimeout(800)
  ;(await realCamera(visitor)).forEach((value, index) =>
    expect(value).toBeCloseTo(captured.camera.position[index], 4),
  )
  await expect(visitor.locator('canvas')).toHaveCount(1)
  await visitor.close()
  report.checks.push(
    'Saved capture is used by the real public scene and Home/reset restores the same camera',
  )
  report.checks.push(
    'Form editing; empty numeric preservation across sections; explicit JSON apply/discard; real camera panning and capture; preview/capture do not persist; canonical save preserves actions',
  )
  report.checks.push(
    'Category creation; unlisted editing; invalid JSON; unsaved real Three preview; single Canvas; save and publish',
  )
  report.checks.push(
    'Missing model node fails visibly; preview retry retains the unlisted local configuration',
  )
  // Concurrency is exercised using the same real API in a second writer.
  await page.getByLabel('商品介绍', { exact: true }).fill('保留我的未保存输入')
  const concurrent = (await api('/api/v1/admin/products/typewriter-study')).data
  const edit = {
    ...concurrent.item,
    presentation: concurrent.presentation,
    description: '另一窗口已更新',
  }
  expect((await api('/api/v1/admin/products/typewriter-study', 'PUT', edit)).status).toBe(200)
  await page.getByRole('button', { name: '保存修改', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('其他窗口修改')
  await expect(page.getByLabel('商品介绍', { exact: true })).toHaveValue('保留我的未保存输入')
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: '重新读取', exact: true }).click()
  await expect(page.getByLabel('商品介绍', { exact: true })).toHaveValue('另一窗口已更新')
  await page.getByLabel('商品介绍', { exact: true }).fill('会话过期时的输入')
  await api('/api/v1/admin/session/logout', 'POST')
  await page.getByRole('button', { name: '保存修改', exact: true }).click()
  await expect(page.getByRole('heading', { name: '重新登录', exact: true })).toBeVisible()
  await login()
  await expect(page.getByLabel('商品介绍', { exact: true })).toHaveValue('会话过期时的输入')
  await page.getByRole('button', { name: '保存修改', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('已保存')
  report.checks.push(
    'Conflict preserves input; reread recovery; logout/expired session preserves input and login can resume saving',
  )
  await capture('editor-1440')
  for (const [section, name] of [
    ['部件热点', 'hotspots'],
    ['外观', 'finishes'],
    ['镜头', 'camera'],
    ['动作', 'actions'],
    ['导览', 'guide'],
    ['高级配置', 'advanced'],
  ]) {
    await tab(section)
    await capture(name + '-1440')
  }
  await tab('基本信息')
  for (const width of [1280, 1920, 390, 320]) {
    await page.setViewportSize({ width, height: width < 500 ? 844 : width === 1280 ? 720 : 1080 })
    await capture('editor-' + width)
    await tab('镜头')
    await capture('camera-' + width)
    await tab('导览')
    await capture('guide-' + width)
    await tab('基本信息')
  }
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.getByRole('button', { name: '下架商品', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('已下架')
  expect((await api('/api/v1/products/typewriter-study')).status).toBe(404)
  report.checks.push(
    'Desktop 1280/1440/1920 and mobile 390/320, no document overflow, explicit unlisting',
  )
  await page.getByRole('button', { name: '返回商品列表', exact: true }).click()
  await page.getByRole('button', { name: '新建商品', exact: true }).click()
  await page.getByLabel('配置起点', { exact: true }).selectOption('form-01')
  await page.getByRole('button', { name: '使用此配置开始', exact: true }).click()
  await page.getByLabel('商品名称', { exact: true }).fill('未保存音箱验证')
  await page.getByLabel('商品标识', { exact: true }).fill('unsaved-speaker-check')
  await tab('动作')
  await page.getByLabel('完整行程（秒）', { exact: true }).fill('3.5')
  await tab('导览')
  await page.getByLabel('停留进度（%）', { exact: true }).first().fill('35.5')
  const v3 = await draftConfig()
  expect(v3.version).toBe(3)
  expect(v3.actions.find((action) => action.kind === 'progress').motion.duration).toBe(3.5)
  expect(v3.guide.find((step) => step.progress).progress.value).toBeCloseTo(0.355, 9)
  await page.getByRole('button', { name: '预览当前配置', exact: true }).click()
  await readyPreview()
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await expect(page.getByRole('button', { name: '使用此取景并返回', exact: true })).toBeDisabled()
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await expect(page.getByRole('button', { name: '使用此取景并返回', exact: true })).toBeEnabled()
  await api('/api/v1/admin/session/logout', 'POST')
  expect((await api('/api/v1/admin/session')).status).toBe(401)
  await page.evaluate(() => window.dispatchEvent(new Event('trees-admin-expired')))
  await expect(page.locator('canvas')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: '重新登录', exact: true })).toBeVisible()
  await login()
  await tab('基本信息')
  await expect(page.getByLabel('商品名称', { exact: true })).toHaveValue('未保存音箱验证')
  expect((await api('/api/v1/products/unsaved-speaker-check')).status).toBe(404)
  report.checks.push(
    'Explicit template selection; v3 duration and normalized guide progress forms; simulated visibility gating; session-expiry notification unmounts preview and retains unsaved draft',
  )
  expect(report.errors).toEqual([])
  report.passed = true
} finally {
  if (original) {
    // Restore precisely the owned test edits, keeping the latest optimistic revision.
    const current = (await api('/api/v1/admin/products/typewriter-study')).data
    const restore = {
      ...original.item,
      revision: current.item.revision,
      presentation: original.presentation,
    }
    expect((await api('/api/v1/admin/products/typewriter-study', 'PUT', restore)).status).toBe(200)
    const fresh = (await api('/api/v1/admin/products/typewriter-study')).data
    expect(
      (
        await api('/api/v1/admin/products/typewriter-study/visibility', 'PUT', {
          revision: fresh.item.revision,
          listed: original.item.listed,
        })
      ).status,
    ).toBe(200)
  }
  if (category) {
    const latest = (await api('/api/v1/admin/categories')).data.find((c) => c.id === category.id)
    if (latest)
      expect(
        (
          await api(
            '/api/v1/admin/categories/' + latest.id + '?revision=' + latest.revision,
            'DELETE',
          )
        ).status,
      ).toBe(204)
  }
  await writeFile(output + '/browser.json', JSON.stringify(report, null, 2))
  await browser.close()
}
console.log(JSON.stringify(report, null, 2))
