import { chromium, expect } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import {
  attachShowroomBridge,
  showroomState,
  selectShowroomView,
  seekShowroomMotion,
  flushShowroomGpu,
  cameraError,
} from './reventon-showroom/browser.mjs'
const out = process.env.TREES_CABIN_AUDIT_OUTPUT ?? 'artifacts/car-showroom/cabin-audit'
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const report = { diagnosticOnly: true, passed: false, visualPassed: false, errors: [], shots: [] }
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1,
  })
  page.on('pageerror', (e) => report.errors.push(e.message))
  page.on('console', (m) => {
    if (m.type() === 'error') report.errors.push(m.text())
  })
  await page.goto(
    'http://127.0.0.1:5181/?product=reventon&renderPipeline=realtime&indirectLighting=ddgi&assetLoading=streaming&reventonAsset=runtime-v2&carQuality=studio&carKeyShadow=1&carShowroom=cold-studio&carFloor=cycles&carFloorLight=local&carFloorReflection=planar&carStudioFinish=refined&carStudioPaint=graphite&carAntialias=msaa&carStudioTrim=satin',
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
  await seekShowroomMotion(page, 'open-doors', 1)
  const target = await selectShowroomView(page, 'car-cabin')
  await expect
    .poll(async () => cameraError((await page.evaluate(showroomState)).camera, target), {
      timeout: 90000,
    })
    .toBeLessThan(1e-6)
  report.materials = await page.evaluate(() => {
    const root = window.__demo.scene.scene.value.children.find((n) => n.userData.workbenchProduct),
      entries = new Map()
    root.traverse((n) => {
      if (!n.isMesh) return
      for (const runtime of Array.isArray(n.material) ? n.material : [n.material]) {
        if (!/^Reventon \/ /.test(runtime.name)) continue
        let m = runtime
        while (m.source?.isMaterial) m = m.source
        if (entries.has(m.uuid)) continue
        entries.set(m.uuid, {
          m,
          map: m.map,
          color: m.color?.clone(),
          ao: m.aoMapIntensity,
          emissive: m.emissive?.clone(),
          intensity: m.emissiveIntensity,
        })
      }
    })
    window.__cabinEntries = [...entries.values()]
    window.__cabinLights = []
    window.__demo.scene.scene.value.traverse((n) => {
      if (n.isLight && n.userData.carShowroomLight)
        window.__cabinLights.push({ light: n, intensity: n.intensity })
    })
    return window.__cabinEntries.map(({ m }) => ({
      name: m.name,
      color: m.color?.toArray(),
      metalness: m.metalness,
      roughness: m.roughness,
      ao: m.aoMapIntensity,
      aoMap: !!m.aoMap,
      map: !!m.map,
      ior: m.ior,
      specularIntensity: m.specularIntensity,
      specularMap: !!m.specularIntensityMap,
    }))
  })
  assert.equal(report.materials.filter((m) => /\/ (18661|19771)$/.test(m.name)).length, 4)
  for (const variant of [
    'source',
    'leather-gain',
    'ao-off',
    'leather-emissive-mask',
    'native-gi',
    'uniform-leather',
    'uniform-leather-fill',
    'source-fill',
    'restored',
  ]) {
    await page.evaluate((variant) => {
      window.__carLighting.setSignals(true, variant !== 'native-gi', true)
      for (const e of window.__cabinLights)
        e.light.intensity =
          e.intensity *
          (variant.includes('fill') && e.light.userData.carShowroomLight === 'fill' ? 4 : 1)
      for (const e of window.__cabinEntries) {
        const m = e.m
        m.color?.copy(e.color)
        m.aoMapIntensity = e.ao
        m.emissive?.copy(e.emissive)
        m.emissiveIntensity = e.intensity
        const hadMap = !!m.map
        m.map = e.map
        const leather = /\/ (18661|19771)$/.test(m.name)
        if (variant === 'leather-gain' && leather)
          m.color.multiplyScalar(m.name.endsWith('18661') ? 8 : 16)
        if (variant === 'ao-off') m.aoMapIntensity = 0
        if (variant === 'leather-emissive-mask' && leather) {
          m.emissive.setRGB(0.2, 0, 0)
          m.emissiveIntensity = 1
        }
        if (variant.includes('uniform-leather') && leather) {
          m.map = null
          m.color.setRGB(0.035, 0.035, 0.035)
        }
        if (hadMap !== !!m.map) m.needsUpdate = true
      }
    }, variant)
    const frames = (await page.evaluate(showroomState)).lighting.frames
    await expect
      .poll(async () => (await page.evaluate(showroomState)).lighting.frames, { timeout: 90000 })
      .toBeGreaterThan(frames + 48)
    await flushShowroomGpu(page)
    await page.screenshot({ path: `${out}/${variant}.png` })
    const state = await page.evaluate(showroomState)
    assert.equal(state.canvases, 1)
    assert.ok(state.sameRenderer)
    assert.deepEqual(state.gpuErrors, [])
    report.shots.push({ variant, state })
    console.log(variant)
  }
  assert.equal(
    await page.evaluate(
      () =>
        window.__cabinEntries.every(
          (e) =>
            e.m.map === e.map &&
            e.m.color.equals(e.color) &&
            e.m.aoMapIntensity === e.ao &&
            e.m.emissive.equals(e.emissive) &&
            e.m.emissiveIntensity === e.intensity,
        ) && window.__cabinLights.every((e) => e.light.intensity === e.intensity),
    ),
    true,
  )
  assert.deepEqual(report.errors, [])
  report.passed = true
} finally {
  await browser.close()
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2))
  const labels = {
    source: '原始材质',
    'leather-gain': '皮革底色倍率（未通过）',
    'ao-off': '关闭材质 AO（诊断）',
    'leather-emissive-mask': '目标皮革位置标记（诊断）',
    'native-gi': '关闭间接光修正（诊断）',
    'uniform-leather': '常量皮革底色（诊断）',
    'uniform-leather-fill': '常量皮革＋侧灯增强（非匹配烘焙）',
    'source-fill': '原材质＋侧灯增强（非匹配烘焙）',
    restored: '精确复原',
  }
  await writeFile(
    `${out}/index.html`,
    `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>座舱暗部诊断</title>
<style>body{margin:24px;background:#18191b;color:#eee;font:16px/1.6 system-ui}main{max-width:1440px;margin:auto}img{width:100%;height:auto}figure{margin:32px 0}a{color:#a9d5ff}</style>
<main><h1>座舱暗部诊断</h1><p>以下是隔离实验，不是已通过画质的成品。侧灯实验未同步更新灯板、烘焙及完整 DDGI，不作物理一致对照。</p><p>工程检查：${report.passed ? '通过' : '未通过'}；视觉：未通过。</p><a href="report.json">原始记录</a>
${report.shots.map(({ variant }) => `<figure><figcaption>${labels[variant]}</figcaption><img loading="lazy" src="${variant}.png" alt="${labels[variant]}"></figure>`).join('\n')}</main></html>`,
  )
}
/* global window */
import assert from 'node:assert/strict'
