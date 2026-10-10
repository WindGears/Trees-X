import { chromium, expect } from '@playwright/test'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import sharp from 'sharp'

const base = process.env.CHECK_URL || 'http://127.0.0.1:5181'
const output = 'artifacts/reventon-workbench/visual'
const product = JSON.parse(
  await readFile('server/src/main/resources/presentations/reventon-workbench-v1.json', 'utf8'),
)
const report = { passed: false, captures: [], errors: [] }
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ channel: 'msedge', headless: true })
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: 'reduce',
  })
  page.on('pageerror', (error) => report.errors.push(error.message))
  await page.goto(base + '/?product=reventon', { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(
    () =>
      ['ready', 'error', 'content'].includes(document.querySelector('.workbench')?.dataset.status),
    null,
    { timeout: 180000 },
  )
  if ((await page.locator('.workbench').getAttribute('data-status')) !== 'ready')
    throw new Error(await page.locator('.wb-stage-status').innerText())
  console.log('Actual car ready for visual review')
  const capture = async (name) => {
    await page.evaluate(() => document.fonts.ready)
    await page.mouse.move(1, 1)
    await page.waitForTimeout(350)
    await page.screenshot({ path: `${output}/${name}.png`, fullPage: true })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect(await page.locator('canvas').count()).toBe(1)
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
  const coverUrl = await page.evaluate(() => {
    let component = document.querySelector('canvas').__vueParentComponent
    while (component) {
      const context =
        component.exposed?.context ??
        Reflect.ownKeys(component.provides ?? {})
          .map((key) => component.provides[key])
          .find((v) => v?.scene?.value?.isScene)
      if (context) {
        const renderer = context.renderer.instance
        renderer.render(context.scene.value, context.camera.activeCamera.value)
        return renderer.domElement.toDataURL('image/png')
      }
      component = component.parent
    }
    throw new Error('Actual renderer missing')
  })
  const cover = await sharp(Buffer.from(coverUrl.split(',')[1], 'base64'))
    .resize(960, 720, { fit: 'cover' })
    .png()
    .toBuffer()
  await writeFile('public/covers/workbench/reventon-real.png', cover)
  await writeFile(
    'public/covers/workbench/reventon-real.json',
    JSON.stringify(
      {
        source:
          'Actual Reventon GLB / unique workbench renderer, no image generation or DOM overlays',
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
  await page.getByRole('button', { name: '结构与动作', exact: true }).click()
  const panel = page.locator('.wb-car-motion')
  await capture('actions-panel')
  await panel.getByRole('button', { name: '打开双门', exact: true }).click()
  await capture('open-doors')
  await panel.getByRole('button', { name: '座舱观察', exact: true }).click()
  await capture('cabin')
  await panel.getByRole('button', { name: '展开部件', exact: true }).click()
  await panel.locator('.wb-car-views button').last().click()
  await capture('separated')
  await page.setViewportSize({ width: 390, height: 844 })
  await capture('actions-390')
  await page.setViewportSize({ width: 320, height: 760 })
  await capture('actions-320')
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.getByRole('button', { name: '商品目录', exact: true }).click()
  await capture('catalog')
  expect(report.errors).toEqual([])
  report.passed = true
} catch (error) {
  report.failure = String(error)
  throw error
} finally {
  await browser.close()
  await writeFile(output + '/report.json', JSON.stringify(report, null, 2) + '\n')
}
console.log(JSON.stringify(report))
