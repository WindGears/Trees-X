/* global window, URL, btoa */
import { chromium } from '@playwright/test'
import { readFile, writeFile, mkdir, access } from 'node:fs/promises'
import { resolve } from 'node:path'
import { digest, jsonText, packageAsset } from './asset-package.mjs'

const source = resolve(process.argv[2] || 'artifacts/kimi-imports/typewriter')
const output = resolve(process.argv[3] || 'artifacts/typewriter-migration/export-v1')
try {
  await access(output)
  throw new Error('Use a new output directory; the source and previous exports are preserved.')
} catch (error) {
  if (error.code !== 'ENOENT') throw error
}
const html = await readFile(resolve(source, 'index.html'), 'utf8')
const exporter = await readFile('node_modules/three/examples/jsm/exporters/GLTFExporter.js', 'utf8')
const runtime = new Map([
  ['/__export/GLTFExporter.js', exporter.replace("from 'three';", "from './three.module.js';")],
  ['/__export/three.module.js', await readFile('node_modules/three/build/three.module.js')],
  ['/__export/three.core.js', await readFile('node_modules/three/build/three.core.js')],
])
const browser = await chromium.launch({ channel: 'msedge', headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  await page.route('**/__export/**', (route) => {
    const body = runtime.get(new URL(route.request().url()).pathname)
    return body ? route.fulfill({ body, contentType: 'text/javascript' }) : route.abort()
  })
  await page.route('**/typewriter/?*', (route) =>
    route.fulfill({
      body: html.replace(
        'window.__TYPEWRITER={',
        'window.__EXPORT_MATERIALS=M;window.__TYPEWRITER={',
      ),
      contentType: 'text/html',
    }),
  )
  await page.goto('http://127.0.0.1:5183/typewriter/?s=0&freeze=1')
  await page.waitForFunction(() => window.__APP?.loaded, null, { timeout: 90000 })
  const data = await page.evaluate(async () => {
    const T = await import('/__export/three.module.js')
    const { GLTFExporter } = await import('/__export/GLTFExporter.js')
    const units = window.__TYPEWRITER.getParts()
    const root = new T.Group()
    root.name = 'typewriter-product'
    root.userData.source =
      'User-owned Kimi mechanical study; reference contours and inferred assembly, not factory CAD.'
    root.userData.parts = units.length
    const names = new Map(
      Object.entries(window.__EXPORT_MATERIALS).map(([name, material]) => [material.uuid, name]),
    )
    const materials = new Map(),
      rig = [],
      geometry = new Set()
    let meshes = 0,
      triangles = 0
    for (const unit of units) {
      const part = new T.Group()
      part.name = 'part-' + String(unit.id).padStart(3, '0')
      part.position.copy(unit.p0)
      part.quaternion.copy(unit.q0)
      part.userData.partId = unit.id
      part.userData.group = unit.g
      part.userData.originalName = unit.name
      root.add(part)
      unit.refs.forEach((ref, index) => {
        const original = ref.batch.material
        let material = materials.get(original.uuid)
        if (!material) {
          material = original.clone()
          material.name = names.get(original.uuid) || 'decal-' + materials.size
          material.userData.sourceEnvMapIntensity = original.envMapIntensity
          materials.set(original.uuid, material)
        }
        const mesh = new T.Mesh(ref.batch.geo, material)
        mesh.name = part.name + '-surface-' + index
        ref.local.decompose(mesh.position, mesh.quaternion, mesh.scale)
        part.add(mesh)
        geometry.add(mesh.geometry.uuid)
        meshes++
        triangles += (mesh.geometry.index?.count ?? mesh.geometry.attributes.position.count) / 3
      })
      rig.push({
        node: part.name,
        id: unit.id,
        name: unit.name,
        group: unit.g,
        index: unit.index,
        phase: [...unit.phase],
        position: unit.p0.toArray(),
        exploded: unit.pE.toArray(),
        flat: unit.pk.toArray(),
        quaternion: unit.q0.toArray(),
        explodedQuaternion: unit.qE.toArray(),
        flatQuaternion: unit.qk.toArray(),
        anchor: unit.localBounds.getCenter(new T.Vector3()).toArray(),
        description: unit.note,
        code: unit.code,
        confidence: unit.confidence,
        family: unit.family,
        provenance: unit.provenance || 'Reference-photo observation and parametric reconstruction',
      })
    }
    const buffer = await new GLTFExporter().parseAsync(root, {
      binary: true,
      onlyVisible: false,
      maxTextureSize: Infinity,
    })
    const bytes = new Uint8Array(buffer)
    let text = ''
    for (let i = 0; i < bytes.length; i += 32768)
      text += String.fromCharCode(...bytes.subarray(i, i + 32768))
    return {
      glb: btoa(text),
      rig: { version: 1, type: 'typewriter-layout-v1', parts: rig },
      counts: {
        parts: units.length,
        meshes,
        uniqueGeometry: geometry.size,
        materials: materials.size,
        triangles,
      },
    }
  })
  if (data.counts.parts !== 572) throw new Error('Unexpected source part count')
  await mkdir(output, { recursive: true })
  const model = Buffer.from(data.glb, 'base64')
  await writeFile(resolve(output, 'source.glb'), model)
  await writeFile(resolve(output, 'rig.json'), await jsonText(data.rig))
  const provenance = {
    author: 'User-owned Kimi project (confirmed by owner on 2026-10-09)',
    source: 'https://k3-typewriter.ok.kimi.link/',
    license:
      'Owner-authorized project reuse; reference-photo contours and inferred mechanical study. Three.js MIT.',
    redistribution:
      'No public redistribution performed in this import; retain source references and owner record.',
  }
  const record = {
    source: provenance.source,
    sourceHtmlSha256: digest(await readFile(resolve(source, 'index.source.html'))),
    modelSha256: digest(model),
    modelBytes: model.length,
    ...data.counts,
    production:
      'Direct Three.js geometry export. No remeshing, vertex reduction, texture resizing or Blender scene changes.',
    customShading:
      'Enamel grain and metallic machining shader hooks must be restored by the registered runtime adapter.',
    referenceNotes:
      'TM 37-305; AMES General Catalog #10 (1960), Underwood p213–235; Smith-Corona portable references; Todd McLellan, Things Come Apart. Not factory service CAD.',
  }
  await writeFile(resolve(output, 'production.json'), await jsonText(record))
  await packageAsset(resolve(output, 'source.glb'), resolve(output, 'bundle'), {
    id: 'kimi-typewriter',
    version: 1,
    maxTriangles: Math.ceil(data.counts.triangles),
    provenance,
    extras: [{ path: 'rig.json', source: resolve(output, 'rig.json'), role: 'motion' }],
  })
  console.log(JSON.stringify(record, null, 2))
} finally {
  await browser.close()
}
