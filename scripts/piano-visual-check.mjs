import { chromium, expect } from '@playwright/test'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import sharp from 'sharp'
const base = process.env.CHECK_URL || 'http://127.0.0.1:5181'
const output = process.env.PIANO_VISUAL_OUTPUT || 'artifacts/piano-migration/visual'
const coverOnly = process.env.PIANO_COVER_ONLY === '1'
const product = JSON.parse(
  await readFile('server/src/main/resources/presentations/piano-kimi-v1.json', 'utf8'),
)
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const report = { passed: false, captures: [], errors: [], checks: [] }
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: 'reduce',
  })
  page.on('pageerror', (e) => report.errors.push(e.message))
  await page.goto(base + '/?product=piano-cfx', { waitUntil: 'domcontentloaded', timeout: 90000 })
  const ready = () =>
    expect(page.locator('.workbench')).toHaveAttribute('data-status', 'ready', { timeout: 120000 })
  await ready()
  if (coverOnly) {
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
      throw new Error('No real Three renderer')
    })
    const cover = await sharp(Buffer.from(url.split(',')[1], 'base64'))
      .resize(960, 720, { fit: 'cover' })
      .png()
      .toBuffer()
    await mkdir('public/covers/workbench', { recursive: true })
    await writeFile('public/covers/workbench/piano-cfx-real.png', cover)
    await writeFile(
      'public/covers/workbench/piano-cfx-real.json',
      JSON.stringify(
        {
          source:
            'Actual recovered piano GLB / unique Tres renderer, no image generation or DOM overlays',
          sourceUrl: 'https://k3-piano-cfx.ok.kimi.link/sound-path.html',
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
    report.checks.push('Actual model cover at 960 × 720')
  } else {
    const capture = async (name) => {
      await ready()
      await page.evaluate(() => document.fonts.ready)
      await page.mouse.move(1, 1)
      await page.waitForTimeout(250)
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
    await page.getByLabel('查找部件', { exact: true }).fill('键盘框架')
    await page.locator('.wb-part-list button').first().click()
    await capture('keyboard-closeup')
    await page.getByRole('button', { name: '返回全景', exact: true }).click()
    await page.getByRole('button', { name: '结构与动作', exact: true }).click()
    const chapters = ['剖切', '击弦机构', '弦列与铁板', '音板与弦桥', '制音器与踏板', '全部平铺']
    for (const label of chapters) {
      await page
        .locator('.wb-piano-chapters')
        .getByRole('button', { name: label, exact: true })
        .click()
      await expect(
        page.locator('.wb-piano-chapters').getByRole('button', { name: label, exact: true }),
      ).toHaveAttribute('aria-pressed', 'true')
      await page.locator('.wb-piano-view').click()
      await capture('chapter-' + chapters.indexOf(label))
    }
    await page.getByRole('button', { name: '商品目录', exact: true }).click()
    await expect(page.locator('.wb-catalog-list img')).toHaveCount(3)
    await expect
      .poll(() =>
        page
          .locator('.wb-catalog-list img')
          .evaluateAll((imgs) => imgs.every((i) => i.complete && i.naturalWidth > 0)),
      )
      .toBe(true)
    await capture('catalog')
    await page.getByRole('button', { name: '关闭目录', exact: true }).click()
    await page.getByRole('button', { name: '导览', exact: true }).click()
    await page.getByRole('button', { name: '开始导览', exact: true }).click()
    for (let i = 1; i < product.presentation.guide.length; i++)
      await page.getByRole('button', { name: '下一步', exact: true }).click()
    await capture('guide-return')
    for (const [width, height] of [
      [390, 844],
      [320, 760],
    ]) {
      await page.setViewportSize({ width, height })
      await page.getByRole('button', { name: '结构与动作', exact: true }).click()
      await capture('actions-' + width)
      await page.getByRole('button', { name: '收起面板', exact: true }).click()
    }
    report.checks.push(
      'Five viewport sizes, closeup, six chapters, catalog and guide return; no horizontal overflow',
    )
  }
  expect(report.errors).toEqual([])
  report.passed = true
} finally {
  await browser.close()
  await writeFile(output + '/report.json', JSON.stringify(report, null, 2) + '\n')
}
console.log(JSON.stringify(report))
