import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { URL } from 'node:url'
import { chromium, expect } from '@playwright/test'
import { Color } from 'three'
import {
  attachShowroomBridge,
  showroomState,
  selectShowroomView,
  seekShowroomMotion,
  flushShowroomGpu,
  cameraError,
} from './reventon-showroom/browser.mjs'

const output = process.env.TREES_COMPACT_OUTPUT ?? 'artifacts/car-showroom/compact-room'
const paintStudies = process.env.TREES_ROOM_PAIR === 'paints'
const paintPair = paintStudies || process.env.TREES_ROOM_PAIR === 'metallic'
const roomPaint = process.env.TREES_COMPARE_PAINT ?? 'graphite'
assert.ok(['graphite', 'metallic', 'matte', 'orange', 'silver'].includes(roomPaint))
const variants = paintStudies
  ? ['graphite', 'metallic', 'matte', 'orange']
  : paintPair
    ? ['graphite', 'metallic']
    : process.env.TREES_ROOM_PAIR === 'wrap-wide'
      ? ['wrap', 'wrap-wide']
      : process.env.TREES_ROOM_PAIR === 'wrap'
        ? ['bounce', 'wrap']
        : process.env.TREES_ROOM_PAIR === 'bounce'
          ? ['rim', 'bounce']
          : process.env.TREES_ROOM_PAIR === 'stone'
            ? ['rim', 'stone']
            : process.env.TREES_ROOM_PAIR === 'rim'
              ? ['balanced', 'rim']
              : process.env.TREES_ROOM_PAIR === 'balanced'
                ? ['compact', 'balanced']
                : ['refined', 'compact']
const revisions = {
  refined: 11,
  compact: 12,
  balanced: 13,
  rim: 14,
  stone: 15,
  bounce: 16,
  wrap: 17,
  'wrap-wide': 18,
}
await mkdir(output, { recursive: true })
const report = { passed: false, visualPassed: false, errors: [], runs: [] }
const browser = await chromium.launch({ channel: 'msedge', headless: true })
try {
  for (const variant of variants) {
    console.log('Starting', variant)
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
      deviceScaleFactor: 1,
    })
    page.on('pageerror', (e) => report.errors.push(e.message))
    page.on('console', (m) => {
      if (m.type() === 'error') report.errors.push(m.text())
    })
    const url = new URL(
      'http://127.0.0.1:5181/?product=reventon&renderPipeline=realtime&indirectLighting=ddgi&assetLoading=streaming&reventonAsset=runtime-v2&carQuality=studio&carKeyShadow=1&carShowroom=cold-studio&carFloor=cycles&carFloorLight=local&carFloorReflection=planar&carStudioPaint=graphite&carAntialias=msaa&carStudioTrim=satin&carCabinLight=local&carStudioFinish=' +
        variant,
    )
    if (paintPair) {
      url.searchParams.set('carStudioFinish', 'rim')
      url.searchParams.set('carStudioPaint', variant)
    } else url.searchParams.set('carStudioPaint', roomPaint)
    await page.goto(url.href)
    await expect(page.getByRole('slider', { name: '摄影棚照明', exact: true })).toBeVisible({
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
      shots = []
    assert.equal(initial.showroom.revision, paintPair ? 14 : revisions[variant])
    const materials = await page.evaluate(() => {
      const root = window.__demo.scene.scene.value.children.find(
          (n) => n.userData.workbenchProduct,
        ),
        entries = new Map()
      root.traverse((n) => {
        if (!n.isMesh) return
        for (const m of Array.isArray(n.material) ? n.material : [n.material]) {
          if (!/^Reventon \/ /.test(m.name)) continue
          entries.set(m.name, {
            name: m.name,
            color: m.color?.toArray(),
            roughness: m.roughness,
            metalness: m.metalness,
            clearcoat: m.clearcoat,
            coatRoughness: m.clearcoatRoughness,
            specularIntensity: m.specularIntensity,
            transmission: m.transmission,
            ior: m.ior,
          })
        }
      })
      return [...entries.values()].sort((a, b) => a.name.localeCompare(b.name))
    })
    for (const shot of [
      'perspective',
      'side',
      'rear',
      'top',
      'doors',
      'cabin',
      'separated',
      'restored',
    ]) {
      if (shot === 'doors') await seekShowroomMotion(page, 'open-doors', 1)
      if (shot === 'separated') await seekShowroomMotion(page, 'explore-parts', 0.6)
      if (shot === 'restored') {
        await seekShowroomMotion(page, 'open-doors', 0)
        await seekShowroomMotion(page, 'explore-parts', 0)
      }
      const custom = {
        side: { position: [6, 1.55, -0.3], target: [0, 0.7, -0.3] },
        rear: { position: [-3.9, 1.7, 5.2], target: [0, 0.7, -0.3] },
        top: { position: [0, 7, -0.4], target: [0, 0.6, -0.3] },
      }[shot]
      const target = await selectShowroomView(
        page,
        shot === 'cabin' ? 'car-cabin' : 'perspective',
        custom,
      )
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
      assert.ok(state.sameRenderer && state.sameCanvas)
      assert.deepEqual(state.output, [1440, 1000])
      assert.deepEqual(state.gpuErrors, [])
      let fixtureReadability
      if (variant === 'rim' && shot === 'perspective') {
        fixtureReadability = await page.evaluate(() => {
          const scene = window.__demo.scene.scene.value
          const camera = window.__demo.scene.camera.activeCamera.value
          const canvas = window.__demo.canvas.getBoundingClientRect()
          const intro = document.querySelector('.wb-intro').getBoundingClientRect()
          let panel
          scene.traverse((node) => {
            if (node.isMesh && node.userData.showroomLightId === 'rim') panel = node
          })
          if (!panel) throw new Error('Actual rear rim panel is required')
          const positions = panel.geometry.getAttribute('position'),
            points = []
          for (let i = 0; i < positions.count; i++) {
            const point = camera.position
              .clone()
              .fromBufferAttribute(positions, i)
              .applyMatrix4(panel.matrixWorld)
              .project(camera)
            points.push([
              canvas.left + ((point.x + 1) * canvas.width) / 2,
              canvas.top + ((1 - point.y) * canvas.height) / 2,
            ])
          }
          const rect = {
            left: Math.min(...points.map((p) => p[0])),
            right: Math.max(...points.map((p) => p[0])),
            top: Math.min(...points.map((p) => p[1])),
            bottom: Math.max(...points.map((p) => p[1])),
          }
          const overlap =
            Math.max(0, Math.min(rect.right, intro.right) - Math.max(rect.left, intro.left)) *
            Math.max(0, Math.min(rect.bottom, intro.bottom) - Math.max(rect.top, intro.top))
          return { panel: rect, intro: intro.toJSON(), overlapArea: overlap }
        })
        assert.equal(
          fixtureReadability.overlapArea,
          0,
          'Default rim panel must clear product introduction',
        )
      }
      await page.screenshot({ path: `${output}/${variant}-${shot}.png` })
      shots.push({ shot, state, fixtureReadability })
      console.log(variant, shot)
    }
    report.runs.push({ variant, url: page.url(), initial, materials, shots })
    await writeFile(`${output}/checkpoint.json`, JSON.stringify(report, null, 2))
    await page.close()
  }
  const [before] = report.runs
  for (const after of report.runs.slice(1)) {
    if (paintPair) {
      const isPaint = (m) => / \/ 20159$/.test(m.name)
      assert.deepEqual(
        before.materials.filter((m) => !isPaint(m)),
        after.materials.filter((m) => !isPaint(m)),
      )
      const paint = after.materials.filter(isPaint)
      assert.equal(paint.length, 4)
      const expected = {
        metallic: {
          color: '#7b7e83',
          metalness: 0.65,
          roughness: 0.3,
          clearcoat: 0.65,
          coatRoughness: 0.13,
        },
        matte: {
          color: '#777b79',
          metalness: 0.35,
          roughness: 0.44,
          clearcoat: 1,
          coatRoughness: 0.42,
        },
        orange: {
          color: '#e96708',
          metalness: 0.2,
          roughness: 0.32,
          clearcoat: 1,
          coatRoughness: 0.09,
        },
      }[after.variant]
      for (const material of paint) {
        assert.deepEqual(material.color, new Color(expected.color).toArray())
        for (const key of ['metalness', 'roughness', 'clearcoat', 'coatRoughness'])
          assert.equal(material[key], expected[key])
      }
      assert.deepEqual(before.initial.lights, after.initial.lights)
      assert.deepEqual(before.initial.showroom, after.initial.showroom)
    } else {
      assert.deepEqual(
        before.materials,
        after.materials,
        'room trial must preserve actual car material values',
      )
    }
    assert.equal(before.initial.sha256, after.initial.sha256)
    assert.equal(before.initial.exposure, after.initial.exposure)
    for (let i = 0; i < before.shots.length; i++)
      assert.deepEqual(
        before.shots[i].state.camera,
        after.shots[i].state.camera,
        'paired views must match',
      )
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
    `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>冷白棚候选对照</title><style>body{background:#18191b;color:#eee;font:16px/1.6 system-ui;margin:24px}.pair{display:grid;grid-template-columns:1fr 1fr;gap:12px}img{width:100%}a{color:#add6ff}@media(max-width:800px){.pair{grid-template-columns:1fr}}</style><h1>冷白棚候选对照</h1><p>顺序：${variants.join('、')}。${paintPair ? '相同汽车、摄影棚、灯光、曝光与相机，仅比较车漆参数。graphite为旧深灰，metallic为缎光金属灰，matte为原厂风格哑光灰，orange为亮橙配色演绎。全部属于美术近似，不是原厂配方、实测车漆或完整珠光模拟。' : '相同汽车、材质、曝光、相机；房间与灯位按配置比较，反射源分别重新烘焙。'}整体画质待验收。</p><p>${report.runs.map((r) => `<a href="${r.url}">${r.variant}</a>`).join(' · ')} · <a href="report.json">原始记录</a></p>${(report.runs[0]?.shots ?? []).map(({ shot }) => `<h2>${shot}</h2><div class="pair">${variants.map((v) => `<img loading="lazy" src="${v}-${shot}.png" alt="${v} ${shot}">`).join('')}</div>`).join('')}</html>`,
  )
}
