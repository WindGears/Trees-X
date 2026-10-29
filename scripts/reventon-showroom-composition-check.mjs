import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium, expect } from '@playwright/test'
import { paintReflectionFootprint } from './reventon-showroom/paint-footprint.mjs'
import {
  attachShowroomBridge,
  showroomState,
  selectShowroomView,
  cameraError,
  flushShowroomGpu,
  seekShowroomMotion,
} from './reventon-showroom/browser.mjs'

const output = 'artifacts/car-showroom/composition-r13'
const url =
  'http://127.0.0.1:5181/?product=reventon&renderPipeline=realtime&indirectLighting=ddgi&assetLoading=streaming&reventonAsset=runtime-v2&carQuality=studio&carKeyShadow=1&carShowroom=cold-studio&carFloor=cycles&carFloorLight=local&carFloorReflection=planar&carStudioFinish=balanced&carStudioPaint=graphite&carAntialias=msaa&carStudioTrim=satin&carCabinLight=local'
const views = [
  { id: 'baseline', label: '现有默认镜头' },
  { id: 'low', label: '降低机位', position: [4, 1.45, -5.5], target: [0, 0.7, -0.2] },
  { id: 'close', label: '低机位近景', position: [3.25, 1.4, -4.65], target: [0, 0.68, -0.2] },
  { id: 'side', label: '偏侧近景', position: [4.1, 1.35, -4.3], target: [0, 0.7, -0.2] },
]
await mkdir(output, { recursive: true })
const report = { passed: false, visualPassed: false, url, errors: [], shots: [] }
const browser = await chromium.launch({ channel: 'msedge', headless: true })
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1,
  })
  page.on('pageerror', (error) => report.errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') report.errors.push(message.text())
  })
  await page.goto(url)
  await expect(page.getByRole('slider', { name: '摄影棚照明', exact: true })).toBeVisible({
    timeout: 240000,
  })
  await attachShowroomBridge(page)
  await expect
    .poll(
      async () => {
        const { lighting } = await page.evaluate(showroomState)
        return (
          lighting.phase === 'ready' &&
          lighting.keyShadow?.phase === 'ready' &&
          lighting.indirectLighting.actual === 'ddgi'
        )
      },
      { timeout: 240000 },
    )
    .toBe(true)
  const initial = await page.evaluate(showroomState)
  assert.equal(initial.showroom.revision, 13)
  report.initial = initial
  const capture = async (view, stateName) => {
    const target = await selectShowroomView(page, 'perspective', view.position ? view : undefined)
    await expect
      .poll(async () => cameraError((await page.evaluate(showroomState)).camera, target), {
        timeout: 90000,
      })
      .toBeLessThan(1e-6)
    const frames = (await page.evaluate(showroomState)).lighting.frames
    await expect
      .poll(async () => (await page.evaluate(showroomState)).lighting.frames, { timeout: 90000 })
      .toBeGreaterThan(frames + 32)
    await flushShowroomGpu(page)
    const state = await page.evaluate(showroomState)
    assert.equal(state.canvases, 1)
    assert.ok(state.sameCanvas && state.sameRenderer)
    assert.deepEqual(state.output, [1440, 1000])
    assert.deepEqual(state.gpuErrors, [])
    assert.deepEqual(state.lights, initial.lights)
    assert.equal(state.environment, initial.environment)
    assert.equal(state.exposure, initial.exposure)
    assert.equal(state.sha256, initial.sha256)
    const file = `${view.id}-${stateName}.png`
    await page.screenshot({ path: `${output}/${file}` })
    report.shots.push({ view, stateName, target, file, state })
    if (process.env.TREES_PAINT_FOOTPRINT === '1' && stateName === 'whole')
      await writeFile(
        `${output}/${view.id}-footprint.json`,
        JSON.stringify(await page.evaluate(paintReflectionFootprint)),
      )
    console.log(file)
  }
  for (const view of views) await capture(view, 'whole')
  await seekShowroomMotion(page, 'open-doors', 1)
  await capture(views[2], 'doors')
  await seekShowroomMotion(page, 'explore-parts', 0.6)
  await capture(views[2], 'separated')
  await seekShowroomMotion(page, 'open-doors', 0)
  await seekShowroomMotion(page, 'explore-parts', 0)
  await capture(views[0], 'restored')
  assert.deepEqual(report.errors, [])
  report.passed = true
} catch (error) {
  report.failure = String(error)
  throw error
} finally {
  await browser.close()
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2))
  await writeFile(
    `${output}/index.html`,
    `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>r13 摄影棚取景对照</title><style>body{background:#18191b;color:#eee;font:16px/1.6 system-ui;margin:24px}main{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}img{width:100%}a{color:#add6ff}pre{white-space:pre-wrap}@media(max-width:800px){main{grid-template-columns:1fr}}</style><h1>r13 摄影棚取景对照</h1><p>相同汽车、灯光、环境和曝光，仅变更测试相机。不修改默认取景；静帧对照不代表连续观察已通过。</p><p><a href="report.json">实际状态记录</a></p><main>${report.shots.map(({ view, stateName, target, file }) => `<section><h2>${view.label} · ${stateName}</h2><img src="${file}" alt="${view.label} ${stateName}"><pre>${JSON.stringify(target)}</pre></section>`).join('')}</main></html>`,
  )
}
