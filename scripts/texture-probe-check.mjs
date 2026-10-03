/* global URL */
import { chromium, expect } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import sharp from 'sharp'

const output = '.impeccable/review/asset-ingestion',
  base = 'http://127.0.0.1:5181'
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const report = {
  scope: 'one actual car material/mesh; baseColor only; original UV, normal/AO and EXR retained',
  errors: [],
  external: [],
  textures: [],
}
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  page.on('pageerror', (e) => report.errors.push(e.message))
  page.on('request', (r) => {
    if (/^https?:/.test(r.url()) && new URL(r.url()).origin !== new URL(base).origin)
      report.external.push(r.url())
  })
  const captures = []
  for (const variant of ['original', 'ktx2']) {
    const fixture = JSON.parse(
      await readFile(`artifacts/asset-pipeline/probe-${variant}.json`, 'utf8'),
    )
    await page.route('**/api/v1/products/form-01', (route) => route.fulfill({ json: fixture }))
    await page.goto(base + '/?product=form-01')
    await page.waitForFunction(
      () => ['ready', 'error'].includes(document.querySelector('.workbench')?.dataset.status),
      null,
      { timeout: 90000 },
    )
    if ((await page.locator('.workbench').getAttribute('data-status')) === 'error')
      throw new Error(`${variant}: ${await page.locator('[role="alert"]').allTextContents()}`)
    const info = await page.evaluate(() => {
      let c = document.querySelector('canvas').__vueParentComponent
      while (c) {
        const context =
          c.exposed?.context ??
          Reflect.ownKeys(c.provides ?? {})
            .map((k) => c.provides[k])
            .find((v) => v?.scene?.value?.isScene)
        if (context) {
          const scene = context.scene.value,
            node = scene.getObjectByName('Car_Material_Probe'),
            tex = node.material.map
          return {
            compressed: Boolean(tex.isCompressedTexture),
            format: tex.format,
            colorSpace: tex.colorSpace,
            width: tex.image.width,
            height: tex.image.height,
            mipmaps: tex.mipmaps.length,
            environment: Boolean(scene.environment),
            geometry: node.geometry.attributes.position.count,
            memory: { ...context.renderer.instance.info.memory },
          }
        }
        c = c.parent
      }
      throw new Error('Missing actual scene')
    })
    expect(info.compressed).toBe(variant === 'ktx2')
    expect(info.width).toBe(4096)
    expect(info.height).toBe(4096)
    report.textures.push({ variant, ...info })
    await page.waitForTimeout(300)
    const capture = await page.screenshot({ path: `${output}/car-material-${variant}.png` })
    captures.push(await sharp(capture).removeAlpha().raw().toBuffer({ resolveWithObject: true }))
    await page.unroute('**/api/v1/products/form-01')
  }
  let sum = 0,
    maximum = 0,
    changed = 0
  for (let i = 0; i < captures[0].data.length; i++) {
    const delta = Math.abs(captures[0].data[i] - captures[1].data[i])
    sum += delta
    maximum = Math.max(maximum, delta)
    if (delta) changed++
  }
  report.difference = {
    method:
      'full 1440x1000 screenshot RGB absolute difference; includes background, not a perceptual quality score',
    meanChannelDelta255: sum / captures[0].data.length,
    maxChannelDelta255: maximum,
    changedChannels: changed,
  }
  expect(report.errors).toEqual([])
  expect(report.external).toEqual([])
  report.passed = true
  report.qualityScope =
    'Manual screenshot review required; no whole-car replacement or lossless claim'
} catch (error) {
  report.failure = String(error)
  throw error
} finally {
  await writeFile(output + '/texture-probe.json', JSON.stringify(report, null, 2))
  await browser.close()
}
console.log(JSON.stringify(report, null, 2))
