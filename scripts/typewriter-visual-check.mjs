import { chromium, expect } from '@playwright/test'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import sharp from 'sharp'
const base = process.env.CHECK_URL || 'http://127.0.0.1:5181'
const output = process.env.TYPEWRITER_VISUAL_OUTPUT || 'artifacts/typewriter-migration/visual'
const fixture = process.env.TYPEWRITER_FIXTURE === '1'
const coverOnly = process.env.TYPEWRITER_COVER_ONLY === '1'
const product = JSON.parse(
  await readFile('server/src/main/resources/presentations/typewriter-kimi-v1.json', 'utf8'),
)
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const report = { fixture, passed: false, captures: [], errors: [], checks: [] }
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  if (fixture)
    await context.route('**/api/v1/products/typewriter-study', (route) =>
      route.fulfill({ json: product }),
    )
  const page = await context.newPage()
  page.on('pageerror', (error) => report.errors.push(error.message))
  await page.goto(base + '/?product=typewriter-study')
  await expect(page.locator('.workbench')).toHaveAttribute('data-status', 'ready', {
    timeout: 90000,
  })
  if (process.env.TYPEWRITER_CREATE_COVER === '1' || coverOnly) {
    const url = await page.evaluate(() => {
      let component = document.querySelector('canvas').__vueParentComponent
      while (component) {
        const context =
          component.exposed?.context ??
          Reflect.ownKeys(component.provides ?? {})
            .map((k) => component.provides[k])
            .find((v) => v?.scene?.value?.isScene)
        if (context) {
          const renderer = context.renderer.instance
          renderer.render(context.scene.value, context.camera.activeCamera.value)
          return renderer.domElement.toDataURL('image/png')
        }
        component = component.parent
      }
      throw new Error('Three renderer unavailable for cover export')
    })
    const cover = await sharp(Buffer.from(url.split(',')[1], 'base64'))
      .resize(960, 720, { fit: 'cover' })
      .png()
      .toBuffer()
    await writeFile('public/covers/workbench/typewriter-study-real.png', cover)
    await writeFile(
      'public/covers/workbench/typewriter-study-real.json',
      JSON.stringify(
        {
          source:
            'Actual migrated GLB / unique workbench renderer, no DOM overlays or generated imagery',
          slug: product.slug,
          bundle: product.presentation.source.bundle,
          bytes: cover.length,
          sha256: createHash('sha256').update(cover).digest('hex'),
          width: 960,
          height: 720,
        },
        null,
        2,
      ) + '\n',
    )
    report.checks.push('Real migrated model cover exported at 960 × 720')
  }
  if (!coverOnly) {
    const capture = async (name) => {
      // Writing a public cover reloads Vite. Wait for the replacement scene,
      // rather than capturing a transient loading frame as a finished product.
      await expect(page.locator('.workbench')).toHaveAttribute('data-status', 'ready', {
        timeout: 90000,
      })
      await page.evaluate(() => document.fonts.ready)
      await page.mouse.move(1, 1)
      await page.waitForTimeout(200)
      await page.screenshot({ path: output + '/' + name + '.png', fullPage: true })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      )
      report.captures.push(name)
    }
    for (const [width, height] of [
      [1280, 720],
      [1440, 1000],
      [1920, 1080],
      [390, 844],
      [320, 760],
    ]) {
      await page.setViewportSize({ width, height })
      await capture('whole-' + width)
    }
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.getByRole('button', { name: '细节', exact: true }).click()
    await page.getByLabel('查找部件', { exact: true }).fill('part-070')
    await page.locator('.wb-part-list button').filter({ hasText: '按键 · 24 · A' }).click()
    await page.waitForTimeout(850)
    await capture('key-closeup')
    await page.getByRole('button', { name: '返回全景', exact: true }).click()
    await page.getByRole('button', { name: '结构与动作', exact: true }).click()
    await page.getByRole('button', { name: '分层展开', exact: true }).click()
    await expect(page.getByRole('button', { name: '分层展开', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
      { timeout: 10000 },
    )
    await page.getByRole('button', { name: '展开全景', exact: true }).first().click()
    await page.waitForTimeout(850)
    await capture('layers-panel')
    await page.getByRole('button', { name: '平铺部件', exact: true }).click()
    await expect(page.getByRole('button', { name: '平铺部件', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
      { timeout: 10000 },
    )
    await page.getByRole('button', { name: '平铺俯视', exact: true }).first().click()
    await page.waitForTimeout(850)
    await capture('flat-panel')
    await page.getByRole('button', { name: '商品目录', exact: true }).click()
    await capture('catalog')
    await page.getByRole('button', { name: '关闭目录', exact: true }).click()
    await page.getByRole('button', { name: '导览', exact: true }).click()
    await page.getByRole('button', { name: '开始导览', exact: true }).click()
    for (let i = 0; i < product.presentation.guide.length - 1; i++) {
      await page.getByRole('button', { name: '下一步', exact: true }).click()
      await page.waitForTimeout(850)
    }
    await capture('guide-return')
    report.checks.push(
      'Desktop and mobile layout, closeup, layers, flat, catalog and five guide steps',
    )
  }
  expect(report.errors).toEqual([])
  report.passed = true
} finally {
  await browser.close()
  await writeFile(output + '/report.json', JSON.stringify(report, null, 2))
}
console.log(JSON.stringify(report))
