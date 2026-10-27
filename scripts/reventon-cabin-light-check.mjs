import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium, expect } from '@playwright/test'
import {
  attachShowroomBridge,
  showroomState,
  selectShowroomView,
  focusShowroomPart,
  seekShowroomMotion,
  flushShowroomGpu,
  cameraError,
} from './reventon-showroom/browser.mjs'

const output = process.env.TREES_CABIN_LIGHT_OUTPUT ?? 'artifacts/car-showroom/cabin-local-verified'
await mkdir(output, { recursive: true })
const report = { passed: false, visualPassed: false, errors: [], runs: [] }
function materials() {
  const root = window.__demo.scene.scene.value.children.find((n) => n.userData.workbenchProduct)
  const result = new Map()
  root.traverse((n) => {
    if (!n.isMesh) return
    for (const m of Array.isArray(n.material) ? n.material : [n.material]) {
      if (!/^Reventon \/ /.test(m.name)) continue
      result.set(m.name, {
        name: m.name,
        color: m.color?.toArray(),
        roughness: m.roughness,
        coat: m.clearcoat,
        coatRoughness: m.clearcoatRoughness,
        metalness: m.metalness,
        maps: ['map', 'normalMap', 'aoMap', 'specularIntensityMap'].map((k) => ({
          slot: k,
          present: !!m[k],
          channel: m[k]?.channel,
        })),
      })
    }
  })
  return [...result.values()].sort((a, b) => a.name.localeCompare(b.name))
}
const browser = await chromium.launch({ channel: 'msedge', headless: true })
try {
  for (const variant of ['source', 'local']) {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
      deviceScaleFactor: 1,
    })
    page.on('pageerror', (e) => report.errors.push(e.message))
    page.on('console', (m) => {
      if (m.type() === 'error') report.errors.push(m.text())
    })
    await page.goto(
      'http://127.0.0.1:5181/?product=reventon&renderPipeline=realtime&indirectLighting=ddgi&assetLoading=streaming&reventonAsset=runtime-v2&carQuality=studio&carKeyShadow=1&carShowroom=cold-studio&carFloor=cycles&carFloorLight=local&carFloorReflection=planar&carStudioFinish=refined&carStudioPaint=graphite&carAntialias=msaa&carStudioTrim=satin&carCabinLight=' +
        variant,
    )
    await expect(page.getByRole('slider', { name: '灯板亮度 · 调试' })).toBeVisible({
      timeout: 240000,
    })
    await attachShowroomBridge(page)
    await expect
      .poll(
        async () => {
          const s = await page.evaluate(showroomState)
          return (
            s.lighting.phase === 'ready' &&
            s.lighting.keyShadow?.phase === 'ready' &&
            s.lighting.indirectLighting.actual === 'ddgi'
          )
        },
        { timeout: 240000 },
      )
      .toBe(true)
    const initial = await page.evaluate(showroomState),
      entries = await page.evaluate(materials),
      shots = []
    const routing = await page.evaluate(() => {
      const root = window.__demo.scene.scene.value.children.find((n) => n.userData.workbenchProduct)
      const materials = new Map()
      root.traverse((n) => {
        if (!n.isMesh) return
        for (const m of Array.isArray(n.material) ? n.material : [n.material])
          materials.set(m.name, m)
      })
      const body = [...materials.values()].find((m) => /\/ 20159$/.test(m.name))
      return {
        mode: root.userData.carStudioCabinLighting ?? 'source',
        leather: [...materials.values()]
          .filter((m) => /\/ (18661|19771)$/.test(m.name))
          .map((m) => ({
            name: m.name,
            environment: m.envNode?.value?.name,
            distinctFromBody: !!m.envNode?.value && m.envNode.value !== body?.envNode?.value,
          })),
      }
    })
    assert.equal(routing.mode, variant)
    assert.equal(routing.leather.length, 4)
    for (const entry of routing.leather) assert.equal(entry.distinctFromBody, variant === 'local')
    assert.equal(initial.lighting.signals.beautySamples, 4)
    const tires = entries.filter((m) => /\/ (15411|15491)$/.test(m.name))
    const rims = entries.filter((m) => /^Reventon \/ wheel_-?1_-?1 \/ 15731$/.test(m.name))
    assert.equal(tires.length, 4)
    assert.equal(rims.length, 4)
    tires.forEach((m) => {
      assert.equal(m.roughness, 0.68)
      assert.deepEqual(m.color, [0.012, 0.012, 0.012])
    })
    rims.forEach((m) => {
      assert.equal(m.roughness, 0.38)
      assert.equal(m.coatRoughness, 0.22)
    })
    for (const shot of ['perspective', 'wheel', 'doors', 'cabin', 'separated', 'restored']) {
      if (shot === 'doors') await seekShowroomMotion(page, 'open-doors', 1)
      if (shot === 'separated') await seekShowroomMotion(page, 'explore-parts', 0.6)
      if (shot === 'restored') {
        await seekShowroomMotion(page, 'open-doors', 0)
        await seekShowroomMotion(page, 'explore-parts', 0)
      }
      const target =
        shot === 'wheel'
          ? await focusShowroomPart(page, 'wheel_1_1')
          : await selectShowroomView(page, shot === 'cabin' ? 'car-cabin' : 'perspective')
      // Reuse the semantic focus pose but remove its emissive selection overlay
      // for a material comparison. The regular focus interaction is exercised above.
      if (shot === 'wheel') await selectShowroomView(page, 'perspective', target)
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
      assert.ok(state.sameRenderer)
      assert.deepEqual(state.gpuErrors, [])
      await page.screenshot({ path: `${output}/${variant}-${shot}.png` })
      shots.push({ shot, state })
      console.log(`${variant}: ${shot}`)
    }
    assert.deepEqual(
      await page.evaluate(materials),
      entries,
      'motions must not overwrite materials',
    )
    report.runs.push({ variant, url: page.url(), routing, initial, materials: entries, shots })
    await page.close()
  }
  const [source, candidate] = report.runs
  assert.deepEqual(
    candidate.materials,
    source.materials,
    'lighting routing must preserve all material values and maps',
  )
  assert.deepEqual(report.errors, [])
  report.passed = true
} finally {
  await browser.close()
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2))
  await writeFile(
    `${output}/index.html`,
    `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>座舱局部面积光候选</title><style>body{background:#18191b;color:#eee;font:16px/1.6 system-ui;margin:24px}main{max-width:1440px;margin:auto}.pair{display:grid;grid-template-columns:1fr 1fr;gap:12px}img{width:100%}figure{margin:0}a{color:#add6ff}@media(max-width:800px){.pair{grid-template-columns:1fr}}</style><main><h1>座舱局部面积光候选</h1><p>左：原探针高光；右：皮革局部面积光。原贴图、材质参数、车漆与玻璃不变。此处是局部改进对照，整体摄影棚仍待验收。</p><p>${report.runs.map((r) => `<a href="${r.url}">${r.variant === 'local' ? '打开候选' : '打开原版'}</a>`).join(' · ')} · <a href="report.json">原始记录</a></p>${(report.runs[0]?.shots ?? []).map(({ shot }) => `<h2>${shot}</h2><div class="pair">${['source', 'local'].map((v) => `<figure><figcaption>${v}</figcaption><img loading="lazy" src="${v}-${shot}.png" alt="${v} ${shot}"></figure>`).join('')}</div>`).join('')}</main></html>`,
  )
}
