import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import sharp from 'sharp'
import { chromium, expect } from '@playwright/test'
import {
  attachShowroomBridge,
  showroomState,
  selectShowroomView,
  flushShowroomGpu,
  cameraError,
} from './reventon-showroom/browser.mjs'

// Read-only screen-to-triangle diagnostic. No production shader or asset changes.
const output = 'artifacts/car-showroom/silver-edge-r18'
await mkdir(output, { recursive: true })
const url =
  'http://127.0.0.1:5181/?product=reventon&renderPipeline=realtime&indirectLighting=ddgi&assetLoading=streaming&reventonAsset=runtime-v2&carQuality=studio&carKeyShadow=1&carShowroom=cold-studio&carFloor=cycles&carFloorLight=local&carFloorReflection=planar&carStudioFinish=wrap-wide&carStudioPaint=silver&carAntialias=msaa&carStudioTrim=satin&carCabinLight=local'
const report = { passed: false, url, errors: [], views: [] }
const browser = await chromium.launch({ channel: 'msedge', headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
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
    const frame = (await page.evaluate(showroomState)).lighting.frames
    await expect
      .poll(async () => (await page.evaluate(showroomState)).lighting.frames, { timeout: 90000 })
      .toBeGreaterThan(frame + 40)
    await flushShowroomGpu(page)
    const state = await page.evaluate(showroomState)
    assert.equal(state.showroom.revision, 18)
    assert.equal(state.sameCanvas && state.sameRenderer, true)
    assert.equal(state.canvases, 1)
    assert.deepEqual(state.gpuErrors, [])
    assert.deepEqual(state.output, [1440, 1000])
    const file = `${output}/${view}.png`
    await page.screenshot({ path: file })
    const { data, info } = await sharp(file)
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
    const luma = (x, y) => {
      const i = (y * info.width + x) * info.channels
      return data[i] * 0.2126 + data[i + 1] * 0.7152 + data[i + 2] * 0.0722
    }
    const candidates = []
    const bounds = view === 'side' ? [280, 440, 1280, 670] : [510, 460, 1220, 690]
    for (let y = bounds[1]; y < bounds[3]; y += 2)
      for (let x = bounds[0]; x < bounds[2]; x += 2) {
        const center = luma(x, y)
        const neighbors = []
        for (const dy of [-3, 0, 3])
          for (const dx of [-3, 0, 3]) if (dx || dy) neighbors.push(luma(x + dx, y + dy))
        neighbors.sort((a, b) => a - b)
        const contrast = center - (neighbors[3] + neighbors[4]) / 2
        if (contrast > 35) candidates.push({ x, y, luma: center, contrast })
      }
    candidates.sort((a, b) => b.contrast - a.contrast)
    const points = []
    for (const candidate of candidates) {
      if (points.every((p) => Math.hypot(p.x - candidate.x, p.y - candidate.y) > 10))
        points.push(candidate)
      if (points.length === 48) break
    }
    assert.ok(points.length > 0)
    const hits = await page.evaluate((points) => {
      const scene = window.__demo.scene.scene.value
      const camera = window.__demo.scene.camera.activeCamera.value
      const root = scene.children.find((node) => node.userData.workbenchProduct)
      scene.updateMatrixWorld(true)
      const rect = window.__demo.canvas.getBoundingClientRect()
      const meshes = []
      root.traverse((mesh) => {
        if (!mesh.isMesh || mesh.isInstancedMesh) return
        for (let node = mesh; node; node = node.parent) if (!node.visible) return
        meshes.push(mesh)
      })
      return points.map((pixel) => {
        const origin = camera.getWorldPosition(camera.position.clone())
        const direction = origin
          .clone()
          .set(
            ((pixel.x + 0.5 - rect.left) / rect.width) * 2 - 1,
            1 - ((pixel.y + 0.5 - rect.top) / rect.height) * 2,
            0.5,
          )
          .unproject(camera)
          .sub(origin)
          .normalize()
        const intersections = []
        for (const mesh of meshes)
          mesh.raycast(
            { ray: { origin, direction }, near: camera.near, far: camera.far },
            intersections,
          )
        intersections.sort((a, b) => a.distance - b.distance)
        const hit = intersections.find((entry) => {
          const m = Array.isArray(entry.object.material)
            ? entry.object.material[entry.face.materialIndex]
            : entry.object.material
          return !m.transparent && m.opacity === 1
        })
        if (!hit) return { ...pixel, hit: null }
        const mesh = hit.object,
          geometry = mesh.geometry
        const indices = [hit.face.a, hit.face.b, hit.face.c]
        const local = indices.map((i) =>
          origin.clone().fromBufferAttribute(geometry.attributes.position, i),
        )
        const normals = indices.map((i) =>
          origin.clone().fromBufferAttribute(geometry.attributes.normal, i).normalize(),
        )
        const projected = local.map((v) => v.clone().applyMatrix4(mesh.matrixWorld).project(camera))
        const xy = projected.map((v) => [
          rect.left + ((v.x + 1) * rect.width) / 2,
          rect.top + ((1 - v.y) * rect.height) / 2,
        ])
        const lengths = xy.map((p, i) =>
          Math.hypot(p[0] - xy[(i + 1) % 3][0], p[1] - xy[(i + 1) % 3][1]),
        )
        const area =
          Math.abs(
            (xy[1][0] - xy[0][0]) * (xy[2][1] - xy[0][1]) -
              (xy[1][1] - xy[0][1]) * (xy[2][0] - xy[0][0]),
          ) / 2
        const material = Array.isArray(mesh.material)
          ? mesh.material[hit.face.materialIndex]
          : mesh.material
        const angle = (a, b) => (Math.acos(Math.max(-1, Math.min(1, a.dot(b)))) * 180) / Math.PI
        const incoming = direction.clone().transformDirection(mesh.matrixWorld.clone().invert())
        const faceNormal = hit.face.normal.clone()
        if (faceNormal.dot(incoming) > 0) faceNormal.negate()
        const interpolated = hit.normal.clone().normalize()
        const reflected = incoming.clone().reflect(interpolated)
        return {
          ...pixel,
          mesh: mesh.name,
          material: material.name,
          face: hit.faceIndex,
          local: local.map((v) => v.toArray()),
          normals: normals.map((v) => v.toArray()),
          projected: xy,
          projectedArea: area,
          minProjectedAltitude: (2 * area) / Math.max(...lengths),
          barycentric: hit.barycoord.toArray(),
          normalSpreadDegrees: Math.max(
            angle(normals[0], normals[1]),
            angle(normals[1], normals[2]),
            angle(normals[2], normals[0]),
          ),
          normalFaceDegrees: normals.map((v) => angle(v, hit.face.normal)),
          reflectedPlaneCosine: reflected.dot(faceNormal),
          geometricViewCosine: -incoming.dot(faceNormal),
          shadingViewCosine: -incoming.dot(interpolated),
        }
      })
    }, points)
    report.views.push({ view, state, hits })
    console.log(
      view,
      JSON.stringify(
        hits
          .filter((h) => /20159$/.test(h.material))
          .map((h) => ({
            x: h.x,
            y: h.y,
            mesh: h.mesh,
            face: h.face,
            altitude: h.minProjectedAltitude,
            spread: h.normalSpreadDegrees,
          })),
      ),
    )
  }
  assert.deepEqual(report.errors, [])
  report.passed = true
  report.caveat =
    'Pixel-center opaque ray hits, not MSAA sample coverage. Candidate pixels selected by local brightness contrast; transparent surfaces and postprocessing can contribute to the same displayed pixel. This does not prove every selected line is a faulty normal.'
} finally {
  await browser.close()
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2))
}
