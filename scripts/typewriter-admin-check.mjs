/* global fetch */
import { chromium, expect } from '@playwright/test'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
const base = process.env.CHECK_URL || 'http://127.0.0.1:5181'
const settings = Object.fromEntries(
  (await readFile('server/.env.local', 'utf8'))
    .split(/\r?\n/)
    .filter((line) => /^TREES_ADMIN_/.test(line))
    .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
)
const output = 'artifacts/typewriter-migration/admin'
await mkdir(output, { recursive: true })
const original = await (await fetch(base + '/api/v1/products/typewriter-study')).json()
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const report = { passed: false, checks: [], errors: [] }
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: 'reduce',
  })
  page.on('pageerror', (error) => report.errors.push(error.message))
  await page.goto(base + '/admin')
  await page
    .getByLabel('管理员账号', { exact: true })
    .fill(settings.TREES_ADMIN_USERNAME || 'admin')
  await page.getByLabel('密码', { exact: true }).fill(settings.TREES_ADMIN_PASSWORD || '123456')
  await page.getByRole('button', { name: '登录管理端', exact: true }).click()
  await page.getByRole('button', { name: '编辑机械打字机', exact: true }).click()
  await expect(page.locator('canvas')).toHaveCount(0)
  await page.getByRole('button', { name: '高级配置', exact: true }).click()
  const before = JSON.parse(
    await page.getByLabel('完整展示配置 JSON', { exact: true }).inputValue(),
  )
  expect(before.source.adapter).toBe('typewriter-v1')
  expect(before.hotspots).toHaveLength(572)
  expect(before.actions.find((a) => a.id === 'explore-layout').motion.program.type).toBe(
    'typewriter-layout-v1',
  )
  await page.getByRole('button', { name: '动作', exact: true }).click()
  await expect(page.getByText('已注册的多阶段展示', { exact: false })).toBeVisible()
  await page.getByRole('button', { name: '镜头', exact: true }).click()
  await page.getByRole('button', { name: '为默认取景采集镜头', exact: true }).click()
  await expect(page.locator('.workbench')).toHaveAttribute('data-status', 'ready', {
    timeout: 90000,
  })
  await expect(page.locator('canvas')).toHaveCount(1)
  const canvas = await page.locator('canvas').boundingBox()
  await page.mouse.move(canvas.x + canvas.width * 0.6, canvas.y + canvas.height * 0.55)
  await page.mouse.down({ button: 'right' })
  await page.mouse.move(canvas.x + canvas.width * 0.6 + 45, canvas.y + canvas.height * 0.55 + 10, {
    steps: 8,
  })
  await page.mouse.up({ button: 'right' })
  await page.getByRole('button', { name: '结构与动作', exact: true }).click()
  await page.getByRole('button', { name: '分层展开', exact: true }).click()
  await expect(page.getByRole('button', { name: '分层展开', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await page.getByRole('button', { name: '使用此取景并返回', exact: true }).click()
  await expect(page.locator('canvas')).toHaveCount(0)
  await page.getByRole('button', { name: '高级配置', exact: true }).click()
  const after = JSON.parse(await page.getByLabel('完整展示配置 JSON', { exact: true }).inputValue())
  expect(after.camera).not.toEqual(before.camera)
  expect(after.camera.position).toEqual(after.views.find((v) => v.id === 'perspective').position)
  expect(after.camera.target).toEqual(after.views.find((v) => v.id === 'perspective').target)
  expect(after.source).toEqual(before.source)
  expect(after.actions).toEqual(before.actions)
  expect(after.hotspots).toEqual(before.hotspots)
  expect(after.stage).toEqual(before.stage)
  const current = await (await fetch(base + '/api/v1/products/typewriter-study')).json()
  expect(current).toEqual(original)
  page.on('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: '退出登录', exact: true }).click()
  await expect(page.getByRole('button', { name: '登录管理端', exact: true })).toBeVisible()
  report.checks.push(
    'Real registered asset loads in editor and preview; numeric camera capture preserves 572 parts, program, materials and stage; no DB write; preview unloads',
  )
  expect(report.errors).toEqual([])
  report.passed = true
} finally {
  await browser.close()
  await writeFile(output + '/report.json', JSON.stringify(report, null, 2) + '\n')
}
console.log(JSON.stringify(report))
