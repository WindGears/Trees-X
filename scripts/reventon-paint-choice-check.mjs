import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium, expect } from '@playwright/test'
import {
  attachShowroomBridge,
  showroomState,
  flushShowroomGpu,
  seekShowroomMotion,
} from './reventon-showroom/browser.mjs'

const output = 'artifacts/car-showroom/paint-choice'
const url =
  'http://127.0.0.1:5181/?product=reventon&renderPipeline=realtime&indirectLighting=ddgi&assetLoading=streaming&reventonAsset=runtime-v2&carQuality=studio&carKeyShadow=1&carShowroom=cold-studio&carFloor=cycles&carFloorLight=local&carFloorReflection=planar&carStudioFinish=rim&carStudioPaint=orange&carAntialias=msaa&carStudioTrim=satin&carCabinLight=local'
const report = { passed: false, visualPassed: false, url, errors: [], captures: [] }
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ channel: 'msedge', headless: true })
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1,
  })
  page.on('pageerror', (e) => report.errors.push(e.message))
  page.on('console', (m) => {
    if (m.type() === 'error') report.errors.push(m.text())
  })
  await page.goto(url)
  await expect(page.getByRole('slider', { name: '摄影棚照明', exact: true })).toBeVisible({
    timeout: 240000,
  })
  await attachShowroomBridge(page)
  await expect
    .poll(
      async () => {
        const s = (await page.evaluate(showroomState)).lighting
        return (
          s.phase === 'ready' &&
          s.keyShadow?.phase === 'ready' &&
          s.indirectLighting.actual === 'ddgi'
        )
      },
      { timeout: 240000 },
    )
    .toBe(true)
  async function settle() {
    const frame = (await page.evaluate(showroomState)).lighting.frames
    await expect
      .poll(async () => (await page.evaluate(showroomState)).lighting.frames, { timeout: 90000 })
      .toBeGreaterThan(frame + 40)
    await flushShowroomGpu(page)
  }
  async function snapshot(id) {
    await settle()
    const state = await page.evaluate(showroomState)
    const actual = await page.evaluate(() => {
      const scene = window.__demo.scene.scene.value
      const root = scene.children.find((n) => n.userData.workbenchProduct)
      const paints = new Map(),
        transforms = []
      root.traverse((n) => {
        transforms.push([
          n.uuid,
          ...n.position.toArray(),
          ...n.quaternion.toArray(),
          ...n.scale.toArray(),
        ])
        if (!n.isMesh) return
        for (const m of Array.isArray(n.material) ? n.material : [n.material]) {
          if (m.userData.source_vpb_material_id !== 20159) continue
          paints.set(m.uuid, {
            name: m.name,
            color: m.color.getHexString(),
            metalness: m.metalness,
            roughness: m.roughness,
            clearcoat: m.clearcoat,
          })
        }
      })
      return {
        root: root.uuid,
        paints: [...paints.values()],
        transforms,
        finishId: window.__demo.store.finishId,
        capability: window.__demo.store.carPaintAvailable,
        horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1,
      }
    })
    assert.equal(state.canvases, 1)
    assert.equal(state.sameRenderer && state.sameCanvas, true)
    assert.deepEqual(state.gpuErrors, [])
    assert.equal(actual.capability, true)
    assert.equal(actual.horizontalOverflow, false)
    assert.equal(actual.paints.length, 4)
    const file = `${id}.png`
    await page.screenshot({ path: `${output}/${file}` })
    const capture = { id, file, state, actual }
    report.captures.push(capture)
    console.log(id)
    return capture
  }
  const initial = await snapshot('orange-whole')
  await page.getByRole('button', { name: '外观', exact: true }).click()
  const choices = page.getByRole('region', { name: '汽车材质方案' })
  await expect(choices.getByRole('button', { name: '亮橙', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await seekShowroomMotion(page, 'open-doors', 0.6)
  await seekShowroomMotion(page, 'explore-parts', 0.35)
  const before = await snapshot('orange-open')
  for (const [label, color, metalness, clearcoat] of [
    ['亮银金属', 'b7bcc3', 1, 0],
    ['亮橙', 'e96708', 0.2, 1],
  ]) {
    await choices.getByRole('button', { name: label, exact: true }).click()
    await expect(choices.getByRole('button', { name: label, exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    const result = await snapshot(label === '亮橙' ? 'orange-return' : 'silver-open')
    assert.deepEqual(result.actual.transforms, before.actual.transforms)
    assert.deepEqual(result.state.motion, before.state.motion)
    assert.deepEqual(result.state.camera, before.state.camera)
    assert.equal(result.actual.root, initial.actual.root)
    for (const p of result.actual.paints) {
      assert.equal(p.color, color)
      assert.equal(p.metalness, metalness)
      assert.equal(p.clearcoat, clearcoat)
    }
  }
  await choices.getByRole('button', { name: '亮银金属', exact: true }).click()
  await seekShowroomMotion(page, 'open-doors', 0)
  await seekShowroomMotion(page, 'explore-parts', 0)
  await page.getByRole('button', { name: '外观', exact: true }).click()
  await snapshot('silver-whole')
  await page.evaluate(() => window.__demo.store.restore())
  const restored = await snapshot('restored-orange')
  assert.deepEqual(restored.actual.paints, initial.actual.paints)
  for (const [width, height] of [
    [1280, 720],
    [1920, 1080],
    [390, 844],
    [320, 720],
  ]) {
    await page.setViewportSize({ width, height })
    await page.evaluate(() => {
      if (window.__demo.store.panel !== 'appearance') window.__demo.store.openPanel('appearance')
    })
    await expect(choices.getByRole('button', { name: '亮银金属', exact: true })).toBeVisible()
    await choices.getByRole('button', { name: '亮银金属', exact: true }).click()
    await expect(choices.getByRole('button', { name: '亮银金属', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await snapshot(`layout-${width}`)
  }
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
    `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>亮橙与亮银</title><style>body{background:#16171a;color:#eee;font:16px/1.6 system-ui;margin:24px}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,520px),1fr));gap:20px}img{width:100%}a{color:#bcdfff}</style><h1>亮橙与亮银金属</h1><p>亮橙为主方向；亮银是抛光装甲金属的美术演绎，非原厂配方。打开外观面板即可切换，动作与镜头保留。整体摄影棚画质仍待验收。</p><p><a href="${url}">进入亮橙实机</a> · <a href="${url.replace('carStudioPaint=orange', 'carStudioPaint=silver')}">进入亮银实机</a> · <a href="report.json">验证记录</a></p><main>${report.captures.map((c) => `<section><h2>${c.id}</h2><img src="${c.file}" loading="lazy" alt="${c.id}"></section>`).join('')}</main></html>`,
  )
}
