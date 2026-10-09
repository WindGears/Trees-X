/* global window, parent, URL, btoa */
import { chromium } from '@playwright/test'
import { readFile, writeFile, mkdir, access } from 'node:fs/promises'
import { resolve } from 'node:path'
import { digest, jsonText, packageAsset } from './asset-package.mjs'

const input = resolve('artifacts/kimi-imports/piano-cfx')
const output = resolve(process.argv[2] || 'artifacts/piano-migration/export-v1')
try {
  await access(output)
  throw new Error('Choose a new export directory; previous exports are preserved.')
} catch (error) {
  if (error.code !== 'ENOENT') throw error
}
const html = await readFile(resolve(input, 'sound-path.html'), 'utf8')
const sound = await readFile(resolve(input, 'assets/reference/sound-path.js'), 'utf8')
const flat = await readFile(resolve(input, 'assets/reference/sound-path-flat.js'), 'utf8')
const exporter = await readFile('node_modules/three/examples/jsm/exporters/GLTFExporter.js', 'utf8')
const modules = new Map([
  ['/__export/GLTFExporter.js', exporter.replace("from 'three';", "from './three.module.js';")],
  ['/__export/three.module.js', await readFile('node_modules/three/build/three.module.js')],
  ['/__export/three.core.js', await readFile('node_modules/three/build/three.core.js')],
])
const browser = await chromium.launch({ channel: 'msedge', headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.route('https://www.kimi.com/**', (r) =>
    r.fulfill({ body: '', contentType: 'text/javascript' }),
  )
  await page.route('**/__export/**', (r) => {
    const body = modules.get(new URL(r.request().url()).pathname)
    return body ? r.fulfill({ body, contentType: 'text/javascript' }) : r.abort()
  })
  await page.route('**/sound-path.js', (r) =>
    r.fulfill({
      body: sound.replace('ready:true,stats,semantic,', 'ready:true,apply,stats,semantic,'),
      contentType: 'text/javascript',
    }),
  )
  await page.route('**/sound-path-flat.js', (r) =>
    r.fulfill({
      body: flat.replace(
        'return{apply,dispose,root:displayRoot,stats};',
        'return{apply,dispose,root:displayRoot,stats,items};',
      ),
      contentType: 'text/javascript',
    }),
  )
  await page.goto('http://127.0.0.1:5183/piano-cfx/sound-path.html')
  await page.waitForFunction(() => window.__SOUND_PATH?.ready, null, { timeout: 120000 })
  const frame = page.frames().find((f) => f.url().includes('/reference.html'))
  if (!frame) throw new Error('Recovered piano scene unavailable')
  const data = await frame.evaluate(
    async () => {
      const T = await import('/__export/three.module.js')
      const { GLTFExporter } = await import('/__export/GLTFExporter.js')
      const api = window.__REFERENCE,
        study = parent.__SOUND_PATH
      const root = new T.Group()
      root.name = 'piano-study'
      const descriptors = [],
        materials = new Map(),
        partNodes = new Map(),
        materialProfiles = []
      const morphs = new Map()
      for (const item of study.flat.items)
        for (const child of item.children) if (child.morph) morphs.set(child.mesh, child)
      let meshCount = 0,
        triangles = 0,
        lineCount = 0
      const parts = api.assembly.records.map((record, i) => ({
        id: record.d.id,
        node: 'piano-part-' + String(i).padStart(3, '0'),
        name: record.d.name,
        system: record.d.system,
        description: record.d.description,
        layer: study.flat.items[i].layer,
        section: [],
        flat: [],
        restPoint: [],
      }))
      const byId = new Map(parts.map((p) => [p.id, p]))
      const cloneMaterial = (original) => {
        let saved = materials.get(original.uuid)
        if (!saved) {
          const material = original.clone()
          // r160 has no dispersion property; r185's exporter interprets undefined as enabled.
          if (material.isMeshPhysicalMaterial && material.dispersion === undefined)
            material.dispersion = 0
          material.name = 'piano-material-' + materials.size
          material.userData = { sourceEnvMapIntensity: original.envMapIntensity }
          saved = { material, original, values: [] }
          materials.set(original.uuid, saved)
        }
        return saved
      }
      const cloneNode = (original, holder, kind) => {
        let copy
        if (original.isMesh || original.isLine) {
          const list = (
            Array.isArray(original.material) ? original.material : [original.material]
          ).map(cloneMaterial)
          const geometry = morphs.has(original) ? original.geometry.clone() : original.geometry
          const material = Array.isArray(original.material)
            ? list.map((m) => m.material)
            : list[0].material
          copy = original.isMesh
            ? new T.Mesh(geometry, material)
            : new T.LineSegments(geometry, material)
          copy.name = original.isMesh ? 'piano-surface-' + meshCount++ : 'piano-edge-' + lineCount++
          copy.castShadow = original.castShadow
          copy.receiveShadow = original.receiveShadow
          copy.renderOrder = original.renderOrder
          if (original.isMesh)
            triangles += (geometry.index?.count ?? geometry.attributes.position.count) / 3
          const deform = morphs.get(original)
          if (deform) {
            geometry.attributes.position.array.set(deform.before.positions)
            geometry.morphAttributes.position = [
              new T.BufferAttribute(new Float32Array(deform.after.positions), 3),
            ]
            if (deform.before.normals && deform.after.normals) {
              geometry.attributes.normal.array.set(deform.before.normals)
              geometry.morphAttributes.normal = [
                new T.BufferAttribute(new Float32Array(deform.after.normals), 3),
              ]
            }
            geometry.morphTargetsRelative = false
            copy.updateMorphTargets()
          }
          const sourceId =
            original.userData.soundPathSource ?? original.parent?.userData.soundPathSource
          const part = byId.get(sourceId)
          if (part) {
            copy.userData.pianoPart = part.node
            part[kind].push(copy.name)
          }
          copy.userData.sectionCap = Boolean(original.userData.sectionCap)
          // Visibility and alpha are sampled together, including parent handovers.
          materialProfiles.push({ node: copy.name, original, list, values: list.map(() => []) })
        } else {
          copy = new T.Group()
          copy.name = 'piano-group-' + descriptors.length
          const part = kind === 'flat' && byId.get(original.userData.soundPathSource)
          if (part) {
            copy.name = part.node
            partNodes.set(part.id, original)
          }
        }
        copy.position.copy(original.position)
        copy.quaternion.copy(original.quaternion)
        copy.scale.copy(original.scale)
        holder.add(copy)
        descriptors.push({
          original,
          copy,
          initial: [
            ...copy.position.toArray(),
            ...copy.quaternion.toArray(),
            ...copy.scale.toArray(),
          ],
          poses: [],
          changed: false,
          morph: morphs.has(original),
        })
        for (const child of original.children) cloneNode(child, copy, kind)
      }
      study.apply(0)
      cloneNode(study.groups.values().next().value.positive.parent, root, 'section')
      cloneNode(study.flat.root, root, 'flat')
      for (const part of parts) {
        const r = api.assembly.records.find((r) => r.d.id === part.id)
        const box = new api.THREE.Box3().setFromObject(r.g)
        part.restPoint = box.isEmpty()
          ? r.g.position.toArray()
          : box.getCenter(new api.THREE.Vector3()).toArray()
      }
      for (const time of [0, 0.5, 1, 2, 3, 4, 5, 6, 6.01, 6.2, 6.6, 7]) {
        study.apply(time)
        for (const d of descriptors) {
          const pose = [
            ...d.original.position.toArray(),
            ...d.original.quaternion.toArray(),
            ...d.original.scale.toArray(),
          ]
          if (pose.some((v, i) => Math.abs(v - d.initial[i]) > 1e-9)) d.changed = true
        }
      }
      const times = Array.from({ length: 701 }, (_, i) => i / 100)
      for (const time of times) {
        study.apply(time)
        for (const d of descriptors)
          if (d.changed)
            d.poses.push(
              ...d.original.position.toArray(),
              ...d.original.quaternion.toArray(),
              ...d.original.scale.toArray(),
            )
        for (const profile of materialProfiles) {
          let visible = true,
            p = profile.original
          while (p) {
            visible = visible && p.visible
            p = p.parent
          }
          profile.list.forEach((m, i) =>
            profile.values[i].push(visible ? Math.fround(m.original.opacity) : 0),
          )
        }
      }
      const tracks = []
      for (const d of descriptors) {
        for (const [field, offset, size, Track] of [
          ['position', 0, 3, T.VectorKeyframeTrack],
          ['quaternion', 3, 4, T.QuaternionKeyframeTrack],
          ['scale', 7, 3, T.VectorKeyframeTrack],
        ]) {
          if (!d.changed) continue
          const values = times.flatMap((_, i) =>
            d.poses.slice(i * 10 + offset, i * 10 + offset + size),
          )
          if (values.every((v, i) => Math.abs(v - values[i % size]) < 1e-9)) {
            d.copy[field].fromArray(values)
            continue
          }
          tracks.push(new Track(d.copy.name + '.' + field, times, values).optimize())
        }
        if (d.morph)
          tracks.push(
            new T.NumberKeyframeTrack(
              d.copy.name + '.morphTargetInfluences',
              times,
              times.map((t) => {
                const v = Math.max(0, Math.min(1, (t - 6.1) / 0.9))
                return v * v * v * (v * (v * 6 - 15) + 10)
              }),
            ).optimize(),
          )
      }
      const curves = [],
        curveMap = new Map(),
        surfaces = []
      for (const profile of materialProfiles) {
        const ids = profile.values.map((values) => {
          const key = JSON.stringify(values)
          let id = curveMap.get(key)
          if (id == null) {
            id = curves.length
            curveMap.set(key, id)
            curves.push(values)
          }
          return id
        })
        profile.list.forEach((m) => {
          m.material.opacity = 1
          m.material.transparent = false
          m.material.depthWrite = !profile.original.isLine
        })
        surfaces.push({
          node: profile.node,
          curves: ids,
          line: Boolean(profile.original.isLine),
          castShadow: Boolean(
            profile.original.userData.soundPathCastShadow ?? profile.original.castShadow,
          ),
        })
      }
      const clip = new T.AnimationClip('piano-sound-path', 7, tracks)
      root.animations = [clip]
      const binary = await new GLTFExporter().parseAsync(root, {
        binary: true,
        onlyVisible: false,
        animations: [clip],
      })
      const bytes = new Uint8Array(binary),
        chunks = []
      for (let i = 0; i < bytes.length; i += 16384)
        chunks.push(String.fromCharCode(...bytes.subarray(i, i + 16384)))
      return {
        binary: btoa(chunks.join('')),
        rig: {
          version: 1,
          type: 'piano-sound-path-v1',
          clip: 'piano-sound-path',
          duration: 7,
          sampleStep: 0.01,
          parts,
          curves,
          surfaces,
        },
        stats: {
          units: parts.length,
          meshes: meshCount,
          lines: lineCount,
          triangles,
          materials: materials.size,
          tracks: tracks.length,
          curves: curves.length,
          morphs: morphs.size,
          section: study.stats,
          flat: { ...study.flat.stats, layout: study.flat.stats.layout.bounds },
        },
      }
    },
    { timeout: 120000 },
  )
  if (errors.length) throw new Error(errors.join('\n'))
  await mkdir(output, { recursive: true })
  const binary = Buffer.from(data.binary, 'base64')
  await writeFile(resolve(output, 'source.glb'), binary)
  await writeFile(resolve(output, 'rig.json'), await jsonText(data.rig))
  await writeFile(
    resolve(output, 'source-record.json'),
    await jsonText({
      source: 'https://k3-piano-cfx.ok.kimi.link/sound-path.html',
      sourceHtmlSha256: digest(html),
      glbSha256: digest(binary),
      glbBytes: binary.length,
      ...data.stats,
      method:
        'Offline recovery of source section geometry, full meshes, morph targets and sampled native Three animation. Source camera and renderer excluded.',
      reference:
        'User-created structural study derived from reference outlines; 823 modeled layout units, not a factory BOM. Seven source open section contours remain documented.',
      audio: 'Source supplies explanatory sound-path chapters, no audio playback assets.',
    }),
  )
  const packed = await packageAsset(resolve(output, 'source.glb'), resolve(output, 'bundle'), {
    id: 'kimi-piano',
    version: 1,
    maxTriangles: data.stats.triangles,
    extras: [{ path: 'rig.json', source: resolve(output, 'rig.json'), role: 'motion' }],
    provenance: {
      author: 'User-owned Kimi project',
      source: 'https://k3-piano-cfx.ok.kimi.link/sound-path.html',
      license: 'Owner-authorized local study use',
      redistribution:
        'Reference photograph excluded from runtime package; broader distribution conditions are not inferred.',
    },
  })
  console.log(
    JSON.stringify({
      ...data.stats,
      bytes: packed.manifest.budget.maxBytes,
      manifestSha256: packed.manifestSha256,
      output,
    }),
  )
} finally {
  await browser.close()
}
