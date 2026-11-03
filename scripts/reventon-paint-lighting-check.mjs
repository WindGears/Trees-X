import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium, expect } from '@playwright/test'
import {
  attachShowroomBridge,
  showroomState,
  selectShowroomView,
  cameraError,
  flushShowroomGpu,
} from './reventon-showroom/browser.mjs'

const materialAudit = process.env.TREES_PAINT_AUDIT === 'material'
const lobeAudit = process.env.TREES_PAINT_AUDIT === 'lobes'
const metallicAudit = process.env.TREES_PAINT_AUDIT === 'metallic'
const surfaceAudit = process.env.TREES_PAINT_AUDIT === 'surface'
const silverAudit = process.env.TREES_PAINT_AUDIT === 'silver'
const samplingAudit = process.env.TREES_PAINT_AUDIT === 'sampling'
const normalAudit = process.env.TREES_PAINT_AUDIT === 'normals'
const studioFinish = process.env.TREES_STUDIO_FINISH ?? 'rim'
const revisions = { rim: 14, wrap: 17, 'wrap-wide': 18 }
assert.ok(Object.hasOwn(revisions, studioFinish), 'Known, frozen studio input required')
const pixelRatio = Number(process.env.TREES_PAINT_PIXEL_RATIO ?? 1)
assert.ok([1, 1.5, 2].includes(pixelRatio), 'Only explicit diagnostic pixel ratios allowed')
const paintStudy = process.env.TREES_PAINT_STUDY ?? 'graphite'
assert.ok(['graphite', 'metallic', 'matte', 'orange', 'silver'].includes(paintStudy))
const output =
  process.env.TREES_PAINT_OUTPUT ??
  (metallicAudit
    ? 'artifacts/car-showroom/paint-metallic-r14'
    : lobeAudit
      ? 'artifacts/car-showroom/paint-lobes-r14'
      : materialAudit
        ? 'artifacts/car-showroom/paint-response-r14'
        : 'artifacts/car-showroom/paint-lighting-r14')
const url = `http://127.0.0.1:5181/?product=reventon&renderPipeline=realtime&indirectLighting=ddgi&assetLoading=streaming&reventonAsset=runtime-v2&carQuality=studio&carKeyShadow=1&carShowroom=cold-studio&carFloor=cycles&carFloorLight=local&carFloorReflection=planar&carStudioFinish=${studioFinish}&carStudioPaint=${paintStudy}&carAntialias=msaa&carStudioTrim=satin&carCabinLight=local`
await mkdir(output, { recursive: true })
const report = { passed: false, visualPassed: false, url, pixelRatio, errors: [], shots: [] }
const browser = await chromium.launch({ channel: 'msedge', headless: true })
let page
try {
  page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: pixelRatio,
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
  report.initial = await page.evaluate(showroomState)
  assert.equal(report.initial.showroom.revision, revisions[studioFinish])
  report.materials = await page.evaluate(() => {
    const root = window.__demo.scene.scene.value.children.find(
        (node) => node.userData.workbenchProduct,
      ),
      materials = new Set()
    root.traverse((node) => {
      if (!node.isMesh) return
      for (const material of Array.isArray(node.material) ? node.material : [node.material])
        if (
          /^Reventon \/ .* \/ 20159$/.test(material.name) &&
          material.userData.source_vpb_material_id === 20159
        )
          materials.add(material)
    })
    window.__paintAudit = [...materials].map((material) => ({
      material,
      ao: Object.getOwnPropertyDescriptor(material, 'aoMapIntensity'),
      source: material.source ?? material,
      color: (material.source ?? material).color.clone(),
      roughness: (material.source ?? material).roughness,
      clearcoat: (material.source ?? material).clearcoat,
      metalness: (material.source ?? material).metalness,
      specularIntensity: (material.source ?? material).specularIntensity,
      sourceSide: (material.source ?? material).side,
      runtimeSide: material.side,
      sourceFlatShading: (material.source ?? material).flatShading,
      runtimeFlatShading: material.flatShading,
    }))
    window.__paintGeometryAudit = []
    root.traverse((node) => {
      if (!node.isMesh) return
      const slots = Array.isArray(node.material) ? node.material : [node.material]
      if (!slots.length || !slots.every((m) => materials.has(m))) return
      window.__paintGeometryAudit.push({ mesh: node, original: node.geometry, derived: null })
    })
    return [...materials].map((m) => ({
      name: m.name,
      color: m.color.toArray(),
      metalness: m.metalness,
      roughness: m.roughness,
      clearcoat: m.clearcoat,
      clearcoatRoughness: m.clearcoatRoughness,
      aoMap: m.aoMap?.uuid ?? null,
      aoMapIntensity: m.aoMapIntensity,
      map: m.map?.uuid ?? null,
      roughnessMap: m.roughnessMap?.uuid ?? null,
    }))
  })
  assert.ok(report.materials.length > 0, 'Actual paint materials required')
  const modes = normalAudit
    ? [
        'baseline',
        'native-beauty',
        'paint-flat-native',
        'paint-flat',
        'paint-weighted-native',
        'paint-weighted',
        'restored',
      ]
    : samplingAudit
      ? ['baseline', 'native-beauty', 'restored']
      : silverAudit
        ? ['baseline', 'silver-026', 'silver-032', 'silver-038', 'restored']
        : surfaceAudit
          ? ['baseline', 'native-beauty', 'paint-front-only', 'paint-no-specular', 'restored']
          : metallicAudit
            ? ['baseline', 'metallic-base', 'slate-dielectric', 'slate-metallic', 'restored']
            : lobeAudit
              ? [
                  'baseline',
                  'native-baseline',
                  'no-coat',
                  'black-base',
                  'black-base-no-coat',
                  'restored',
                ]
              : materialAudit
                ? ['baseline', 'slate-color', 'roughness-low', 'roughness-high', 'restored']
                : ['baseline', 'no-ssr', 'no-gi', 'native-beauty', 'paint-no-ao', 'restored']
  for (const mode of modes) {
    const isolateLobes =
      ((lobeAudit || surfaceAudit) && !['baseline', 'restored'].includes(mode)) ||
      ['paint-flat-native', 'paint-weighted-native'].includes(mode)
    const flags = {
      ssr: !isolateLobes && !['no-ssr', 'native-beauty'].includes(mode),
      gi: !isolateLobes && !['no-gi', 'native-beauty'].includes(mode),
    }
    await page.evaluate(
      ({ mode, flags }) => {
        for (const entry of window.__paintGeometryAudit) {
          if (mode.startsWith('paint-weighted')) {
            if (!entry.derived) {
              entry.derived = entry.original.clone()
              entry.derived.computeVertexNormals()
              for (const name of Object.keys(entry.original.attributes)) {
                if (name === 'normal') continue
                const before = entry.original.attributes[name].array
                const after = entry.derived.attributes[name].array
                if (before.length !== after.length || before.some((v, i) => v !== after[i]))
                  throw new Error('Normal diagnostic changed source attribute: ' + name)
              }
              if (entry.original.index?.array.some((v, i) => v !== entry.derived.index.array[i]))
                throw new Error('Normal diagnostic changed topology')
            }
            entry.mesh.geometry = entry.derived
          } else entry.mesh.geometry = entry.original
        }
        for (const entry of window.__paintAudit) {
          entry.source.color.copy(entry.color)
          entry.source.roughness = entry.roughness
          entry.source.clearcoat = entry.clearcoat
          entry.source.metalness = entry.metalness
          entry.source.specularIntensity = entry.specularIntensity
          entry.source.side = entry.sourceSide
          const flat = mode === 'paint-flat' || mode === 'paint-flat-native'
          entry.source.flatShading = flat || entry.sourceFlatShading
          const runtimeFlat = flat || entry.runtimeFlatShading
          if (entry.material.flatShading !== runtimeFlat) {
            entry.material.flatShading = runtimeFlat
            entry.material.needsUpdate = true
          }
          const side = mode === 'paint-front-only' ? 0 : entry.runtimeSide
          if (entry.material.side !== side) {
            entry.material.side = side
            entry.material.needsUpdate = true
          }
          if (mode === 'paint-front-only') entry.source.side = 0
          if (mode === 'paint-no-specular') {
            entry.source.metalness = 0
            entry.source.clearcoat = 0
            entry.source.specularIntensity = 0
          }
          if (['metallic-base', 'slate-metallic'].includes(mode)) entry.source.metalness = 0.65
          if (['slate-dielectric', 'slate-metallic'].includes(mode))
            entry.source.color.set('#7b7e83')
          if (['no-coat', 'black-base-no-coat'].includes(mode)) entry.source.clearcoat = 0
          if (['black-base', 'black-base-no-coat'].includes(mode))
            entry.source.color.setRGB(0, 0, 0)
          if (mode === 'slate-color') entry.source.color.set('#7b7e83')
          if (mode === 'roughness-low') entry.source.roughness = 0.12
          if (mode === 'roughness-high') entry.source.roughness = 0.45
          if (mode.startsWith('silver-')) entry.source.roughness = Number(mode.slice(7)) / 100
          if (entry.ao) Object.defineProperty(entry.material, 'aoMapIntensity', entry.ao)
          else delete entry.material.aoMapIntensity
          if (mode === 'paint-no-ao')
            Object.defineProperty(entry.material, 'aoMapIntensity', {
              configurable: true,
              get: () => 0,
              set: () => {},
            })
        }
        window.__carLighting.setSignals(flags.ssr, flags.gi, true)
      },
      { mode, flags },
    )
    for (const view of ['perspective', 'side']) {
      const target = await selectShowroomView(
        page,
        'perspective',
        view === 'side' ? { position: [6, 1.55, -0.3], target: [0, 0.7, -0.3] } : undefined,
      )
      await expect
        .poll(async () => cameraError((await page.evaluate(showroomState)).camera, target), {
          timeout: 90000,
        })
        .toBeLessThan(1e-6)
      const frames = (await page.evaluate(showroomState)).lighting.frames
      await expect
        .poll(async () => (await page.evaluate(showroomState)).lighting.frames, { timeout: 90000 })
        .toBeGreaterThan(frames + 40)
      await flushShowroomGpu(page)
      const state = await page.evaluate(showroomState)
      assert.equal(state.lighting.signals.ssr, flags.ssr)
      assert.equal(state.lighting.signals.ssgi, flags.gi)
      assert.equal(state.sameRenderer && state.sameCanvas, true)
      assert.equal(state.canvases, 1)
      assert.deepEqual(state.output, [1440 * pixelRatio, 1000 * pixelRatio])
      assert.deepEqual(state.gpuErrors, [])
      assert.deepEqual(state.lights, report.initial.lights)
      assert.equal(state.environment, report.initial.environment)
      const materialInputs = await page.evaluate(() =>
        window.__paintAudit.map(({ material: m }) => ({
          name: m.name,
          color: m.color.toArray(),
          roughness: m.roughness,
          metalness: m.metalness,
          clearcoat: m.clearcoat,
          specularIntensity: m.specularIntensity,
          side: m.side,
          flatShading: m.flatShading,
          aoMapIntensity: m.aoMapIntensity,
        })),
      )
      const geometryInputs = await page.evaluate(() =>
        window.__paintGeometryAudit.map(({ mesh, original, derived }) => ({
          name: mesh.name,
          original: mesh.geometry === original,
          derived: mesh.geometry === derived,
          vertices: mesh.geometry.attributes.position.count,
          indices: mesh.geometry.index?.count ?? null,
        })),
      )
      assert.ok(geometryInputs.length > 0)
      assert.ok(
        geometryInputs.every((entry) =>
          mode.startsWith('paint-weighted') ? entry.derived : entry.original,
        ),
      )
      if (mode === 'paint-no-ao') assert.ok(materialInputs.every((m) => m.aoMapIntensity === 0))
      if (['no-coat', 'black-base-no-coat'].includes(mode))
        assert.ok(materialInputs.every((m) => m.clearcoat === 0))
      if (['black-base', 'black-base-no-coat'].includes(mode))
        assert.ok(materialInputs.every((m) => m.color.every((c) => c === 0)))
      if (lobeAudit) assert.ok(materialInputs.every((m) => m.specularIntensity === 1))
      if (mode === 'paint-front-only') assert.ok(materialInputs.every((m) => m.side === 0))
      if (['paint-flat', 'paint-flat-native'].includes(mode))
        assert.ok(materialInputs.every((m) => m.flatShading === true))
      if (mode === 'paint-no-specular')
        assert.ok(
          materialInputs.every(
            (m) => m.specularIntensity === 0 && m.metalness === 0 && m.clearcoat === 0,
          ),
        )
      if (['metallic-base', 'slate-metallic'].includes(mode))
        assert.ok(materialInputs.every((m) => m.metalness === 0.65))
      if (['slate-dielectric', 'slate-metallic'].includes(mode))
        assert.ok(materialInputs.every((m, i) => m.color[0] > report.materials[i].color[0]))
      if (mode === 'roughness-low') assert.ok(materialInputs.every((m) => m.roughness === 0.12))
      if (mode === 'roughness-high') assert.ok(materialInputs.every((m) => m.roughness === 0.45))
      if (mode.startsWith('silver-'))
        assert.ok(materialInputs.every((m) => m.roughness === Number(mode.slice(7)) / 100))
      if (mode === 'slate-color')
        assert.ok(materialInputs.every((m, i) => m.color[0] > report.materials[i].color[0]))
      const file = `${mode}-${view}.png`
      await page.screenshot({ path: `${output}/${file}` })
      report.shots.push({ mode, view, file, state, materialInputs, geometryInputs })
      console.log(file)
    }
  }
  for (const view of ['perspective', 'side']) {
    const baseline = report.shots.find((shot) => shot.mode === 'baseline' && shot.view === view)
    const restored = report.shots.find((shot) => shot.mode === 'restored' && shot.view === view)
    assert.deepEqual(restored.materialInputs, baseline.materialInputs)
    assert.deepEqual(restored.geometryInputs, baseline.geometryInputs)
    assert.deepEqual(restored.state.camera, baseline.state.camera)
    assert.equal(restored.state.exposure, baseline.state.exposure)
  }
  assert.deepEqual(report.errors, [])
  report.passed = true
  if (normalAudit)
    report.interpretation =
      'Diagnostic only: flat shading replaces authored interpolated normals; area weighting recomputes normals on detached geometry copies without changing positions, UVs or topology. This is not an approved material/asset replacement. Native modes disable SSR/GI correction, not all auxiliary computation. Existing DDGI/shadow proxy ownership is unchanged; do not infer physically complete relighting or motion quality from these stills.'
  if (lobeAudit)
    report.interpretation =
      'Native isolation disables SSR/GI corrections together. Black base removes dielectric diffuse; no-coat also changes base throughput. Tone mapping, bloom, AO and native shadow remain, so screenshots are not additive radiance components. Specular intensity stays 1 to retain the same supported material branch.'
} catch (error) {
  report.failure = String(error)
  throw error
} finally {
  if (page && !page.isClosed())
    await page
      .evaluate(() => {
        for (const entry of window.__paintGeometryAudit ?? []) {
          entry.mesh.geometry = entry.original
          entry.derived?.dispose()
          entry.derived = null
        }
      })
      .catch((error) => {
        report.passed = false
        report.errors.push('Diagnostic cleanup: ' + String(error))
      })
  await browser.close()
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2))
  await writeFile(
    `${output}/index.html`,
    `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>r${revisions[studioFinish]} 车漆隔离</title><style>body{background:#18191b;color:#eee;font:16px/1.6 system-ui;margin:24px}main{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}img{width:100%}a{color:#add6ff}@media(max-width:800px){main{grid-template-columns:1fr}}</style><h1>r${revisions[studioFinish]} 车漆隔离</h1><p>仅用于定位来源，不是最终方案。flat 为面法线，weighted 为副本面积加权法线；二者均非正式资产修改。native-beauty及native后缀关闭SSR和GI修正，仍保留灯光、自阴影和后期。</p><a href="report.json">输入与实际状态</a><main>${report.shots.map(({ mode, view, file }) => `<section><h2>${mode} · ${view}</h2><img src="${file}" alt="${mode} ${view}"></section>`).join('')}</main></html>`,
  )
}
