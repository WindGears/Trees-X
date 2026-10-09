/* global parent, URL */
import { chromium } from '@playwright/test'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  AnimationMixer,
  DataTexture,
  InterpolateLinear,
  LoopOnce,
  PropertyBinding,
  Quaternion,
  RGBAFormat,
  UnsignedByteType,
} from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import sharp from 'sharp'
import { digest, jsonText } from './asset-package.mjs'

const sourceDirectory = resolve('artifacts/kimi-imports/piano-cfx')
const bundleDirectory = resolve('public/models/bundles/kimi-piano/v1')
const output = resolve(
  process.env.PIANO_SOURCE_OUTPUT || 'artifacts/piano-migration/source-consistency',
)
const sourceUrl = process.env.PIANO_SOURCE_URL || 'http://127.0.0.1:5183/piano-cfx/sound-path.html'
const tolerances = {
  position: 0.00003,
  scale: 0.00003,
  quaternionRadians: 0.00005,
  morphVertex: 0.00005,
  opacity: 0.000002,
}
const report = {
  passed: false,
  source: 'https://k3-piano-cfx.ok.kimi.link/sound-path.html',
  localSource: sourceUrl,
  method:
    'Original r160 source poses compared with the actual recovered GLB evaluated by Three AnimationMixer, plus visible morph vertex probes and stored opacity samples.',
  tolerances,
  samples: [],
  errors: [],
  limitations: [
    'The 101 comparison points use source times 0..7 at 0.07 intervals; they align with the exported 0.01 sampling grid. This verifies stored sampled motion, not exact analytic equivalence at arbitrary times.',
    'Source initialization probes and all 701 forward evaluations match the export sequence. Source hidden flat transforms retain history before chapter 6; morph vertex comparisons exclude hidden surfaces.',
    'Local TRS, selected morph vertices and material opacity are checked. This is not a screenshot, shading, camera, normal-vector, mechanical-accuracy or performance comparison.',
  ],
}
let browser, gltf, mixer, action
const resources = { geometries: new Set(), materials: new Set(), textures: new Set() }
const worst = Object.fromEntries(Object.keys(tolerances).map((key) => [key, { error: 0 }]))
const recordError = (kind, error, node, progress) => {
  if (!Number.isFinite(error))
    throw new Error('Nonfinite source comparison: ' + kind + ' / ' + node)
  if (error > worst[kind].error) worst[kind] = { error, node, progress }
  return error
}
const sampleCurve = (curve, progress) => {
  const frame = Math.min(700, Math.max(0, progress * 700)),
    lower = Math.floor(frame),
    upper = Math.min(700, lower + 1)
  return curve[lower] + (curve[upper] - curve[lower]) * (frame - lower)
}

await mkdir(output, { recursive: true })
try {
  const [binary, rigText, sound, flat, html] = await Promise.all([
    readFile(resolve(bundleDirectory, 'model.glb')),
    readFile(resolve(bundleDirectory, 'rig.json'), 'utf8'),
    readFile(resolve(sourceDirectory, 'assets/reference/sound-path.js'), 'utf8'),
    readFile(resolve(sourceDirectory, 'assets/reference/sound-path-flat.js'), 'utf8'),
    readFile(resolve(sourceDirectory, 'sound-path.html')),
  ])
  const rig = JSON.parse(rigText)
  report.inputs = {
    sourceHtmlSha256: digest(html),
    modelSha256: digest(binary),
    modelBytes: binary.length,
    rigSha256: digest(rigText),
  }
  const loader = new GLTFLoader()
  // Decode the actual embedded image locally; Node has no browser ImageBitmap API.
  loader.register((parser) => ({
    name: 'TREES_node_embedded_png',
    async loadTexture(index) {
      const textureDefinition = parser.json.textures[index]
      const image = parser.json.images[textureDefinition.source]
      if (image.uri || image.bufferView == null || image.mimeType !== 'image/png')
        throw new Error('Source check expects only embedded PNG textures')
      const imageBytes = await parser.getDependency('bufferView', image.bufferView)
      const { data, info } = await sharp(Buffer.from(imageBytes))
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true })
      const texture = new DataTexture(data, info.width, info.height, RGBAFormat, UnsignedByteType)
      texture.flipY = false
      texture.name = textureDefinition.name || ''
      texture.needsUpdate = true
      resources.textures.add(texture)
      return texture
    },
  }))
  report.nodeTextureDecode =
    'Actual embedded PNG decoded with sharp into a DataTexture; no GPU rendering'
  gltf = await loader.parseAsync(
    binary.buffer.slice(binary.byteOffset, binary.byteOffset + binary.byteLength),
    '',
  )
  const nodes = new Map()
  gltf.scene.traverse((node) => {
    if (node.name) {
      if (nodes.has(node.name)) throw new Error('Duplicate recovered node: ' + node.name)
      nodes.set(node.name, node)
    }
    if (node.geometry) resources.geometries.add(node.geometry)
    for (const material of node.material
      ? Array.isArray(node.material)
        ? node.material
        : [node.material]
      : []) {
      resources.materials.add(material)
      for (const value of Object.values(material))
        if (value?.isTexture) resources.textures.add(value)
    }
  })
  const clip = gltf.animations.find((item) => item.name === rig.clip)
  if (!clip || clip.duration !== 7 || !clip.tracks.length)
    throw new Error('Recovered sampled clip is missing')
  if (clip.tracks.some((track) => track.getInterpolation() !== InterpolateLinear))
    throw new Error('Recovered clip contains a non-linear sampler')
  const tracks = clip.tracks.map((track) => {
    const parsed = PropertyBinding.parseTrackName(track.name),
      node = nodes.get(parsed.nodeName)
    if (
      !node ||
      parsed.propertyIndex != null ||
      !['position', 'quaternion', 'scale', 'morphTargetInfluences'].includes(parsed.propertyName)
    )
      throw new Error('Unexpected sampled track: ' + track.name)
    return { node: parsed.nodeName, field: parsed.propertyName }
  })
  const trs = tracks.filter((track) => track.field !== 'morphTargetInfluences')
  const morphs = tracks
    .filter((track) => track.field === 'morphTargetInfluences')
    .map(({ node }) => {
      const mesh = nodes.get(node),
        count = mesh.geometry.getAttribute('position').count
      if (
        mesh.geometry.morphAttributes.position?.length !== 1 ||
        mesh.morphTargetInfluences?.length !== 1
      )
        throw new Error('Unexpected recovered morph target: ' + node)
      return {
        node,
        count,
        vertices: [
          ...new Set(
            Array.from({ length: 8 }, (_, index) => Math.floor((index * (count - 1)) / 7)),
          ),
        ],
      }
    })
  report.coverage = {
    comparisonPoints: 101,
    sourceForwardEvaluations: 701,
    animationTracks: tracks.length,
    trsChannels: trs.length,
    morphMeshes: morphs.length,
    opacitySurfaces: rig.surfaces.length,
    interpolation: 'LINEAR',
    morphProbeVertices: morphs.reduce((sum, item) => sum + item.vertices.length, 0),
  }
  mixer = new AnimationMixer(gltf.scene)
  action = mixer.clipAction(clip)
  action.setLoop(LoopOnce, 1)
  action.clampWhenFinished = true
  action.play()

  browser = await chromium.launch({ channel: 'msedge', headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await page.route('https://www.kimi.com/**', (route) =>
    route.fulfill({ body: '', contentType: 'text/javascript' }),
  )
  if (
    !sound.includes('ready:true,stats,semantic,') ||
    !flat.includes('return{apply,dispose,root:displayRoot,stats};')
  )
    throw new Error('Source instrumentation anchors changed')
  await page.route('**/sound-path.js', (route) =>
    route.fulfill({
      body: sound.replace('ready:true,stats,semantic,', 'ready:true,apply,stats,semantic,'),
      contentType: 'text/javascript',
    }),
  )
  await page.route('**/sound-path-flat.js', (route) =>
    route.fulfill({
      body: flat.replace(
        'return{apply,dispose,root:displayRoot,stats};',
        'return{apply,dispose,root:displayRoot,stats,items};',
      ),
      contentType: 'text/javascript',
    }),
  )
  const localUrl = new URL(sourceUrl)
  localUrl.searchParams.set('autoplay', '0')
  await page.goto(localUrl.href)
  await page.waitForFunction(() => window.__SOUND_PATH?.ready, null, { timeout: 120000 })
  const frame = page.frames().find((item) => item.url().includes('/reference.html'))
  if (!frame) throw new Error('Recovered source iframe unavailable')
  const samples = await frame.evaluate(
    ({ trs, morphs, surfaces }) => {
      const api = window.__REFERENCE,
        study = parent.__SOUND_PATH
      const byId = new Map(
        api.assembly.records.map((record, index) => [
          record.d.id,
          'piano-part-' + String(index).padStart(3, '0'),
        ]),
      )
      const nodes = new Map()
      let descriptors = 0,
        meshes = 0,
        lines = 0
      const visit = (node, kind) => {
        let name
        if (node.isMesh) name = 'piano-surface-' + meshes++
        else if (node.isLine) name = 'piano-edge-' + lines++
        else
          name =
            (kind === 'flat' && byId.get(node.userData.soundPathSource)) ||
            'piano-group-' + descriptors
        descriptors++
        if (nodes.has(name)) throw new Error('Duplicate source export mapping: ' + name)
        nodes.set(name, node)
        node.children.forEach((child) => visit(child, kind))
      }
      study.apply(0)
      visit(study.groups.values().next().value.positive.parent, 'section')
      visit(study.flat.root, 'flat')
      for (const request of [...trs, ...morphs, ...surfaces])
        if (!nodes.has(request.node)) throw new Error('Source mapping missing: ' + request.node)
      for (const probe of morphs)
        if (nodes.get(probe.node).geometry.attributes.position.count !== probe.count)
          throw new Error('Morph topology differs: ' + probe.node)
      const visible = (node) => {
        while (node) {
          if (!node.visible) return false
          node = node.parent
        }
        return true
      }
      // The exporter probes changed channels first. Hidden flat poses retain those values.
      for (const time of [0, 0.5, 1, 2, 3, 4, 5, 6, 6.01, 6.2, 6.6, 7]) study.apply(time)
      const result = []
      for (let index = 0; index <= 700; index++) {
        const time = index / 100
        study.apply(time)
        if (index % 7 !== 0) continue
        result.push({
          time,
          progress: index / 700,
          trs: trs.map((request) => nodes.get(request.node)[request.field].toArray()),
          morphs: morphs.map((request) => {
            const mesh = nodes.get(request.node),
              attribute = mesh.geometry.attributes.position
            return visible(mesh)
              ? request.vertices.flatMap((vertex) => [
                  attribute.getX(vertex),
                  attribute.getY(vertex),
                  attribute.getZ(vertex),
                ])
              : null
          }),
          opacity: surfaces.map((surface) => {
            const node = nodes.get(surface.node),
              materials = Array.isArray(node.material) ? node.material : [node.material]
            return materials.map((material) => (visible(node) ? Math.fround(material.opacity) : 0))
          }),
        })
      }
      return result
    },
    { trs, morphs, surfaces: rig.surfaces },
    { timeout: 120000 },
  )
  if (pageErrors.length) throw new Error(pageErrors.join('\n'))
  if (samples.length !== 101) throw new Error('Source comparison did not produce 101 points')
  const loadedQuaternion = new Quaternion(),
    sourceQuaternion = new Quaternion(),
    visibleMorphCoverage = new Map()
  for (const sample of samples) {
    action.enabled = true
    action.paused = false
    mixer.setTime(sample.time)
    const maximum = Object.fromEntries(Object.keys(tolerances).map((key) => [key, 0]))
    trs.forEach((track, index) => {
      const expected = sample.trs[index],
        node = nodes.get(track.node)
      let error,
        kind = track.field
      if (track.field === 'quaternion') {
        kind = 'quaternionRadians'
        loadedQuaternion.copy(node.quaternion).normalize()
        sourceQuaternion.fromArray(expected).normalize()
        error = 2 * Math.acos(Math.min(1, Math.abs(loadedQuaternion.dot(sourceQuaternion))))
      } else
        error = Math.max(
          ...node[track.field]
            .toArray()
            .map((value, component) => Math.abs(value - expected[component])),
        )
      maximum[kind] = Math.max(maximum[kind], recordError(kind, error, track.node, sample.progress))
    })
    morphs.forEach((probe, index) => {
      const expected = sample.morphs[index]
      if (!expected) return
      visibleMorphCoverage.set(probe.node, (visibleMorphCoverage.get(probe.node) || 0) + 1)
      const mesh = nodes.get(probe.node),
        base = mesh.geometry.getAttribute('position'),
        target = mesh.geometry.morphAttributes.position[0],
        weight = mesh.morphTargetInfluences[0]
      probe.vertices.forEach((vertex, offset) => {
        for (let axis = 0; axis < 3; axis++) {
          const field = ['getX', 'getY', 'getZ'][axis],
            start = base[field](vertex),
            end = target[field](vertex)
          const actual = mesh.geometry.morphTargetsRelative
            ? start + end * weight
            : start + (end - start) * weight
          maximum.morphVertex = Math.max(
            maximum.morphVertex,
            recordError(
              'morphVertex',
              Math.abs(actual - expected[offset * 3 + axis]),
              probe.node,
              sample.progress,
            ),
          )
        }
      })
    })
    rig.surfaces.forEach((surface, index) => {
      if (sample.opacity[index].length !== surface.curves.length)
        throw new Error('Source material slots differ: ' + surface.node)
      surface.curves.forEach((curve, slot) => {
        const error = Math.abs(
          sampleCurve(rig.curves[curve], sample.progress) - sample.opacity[index][slot],
        )
        maximum.opacity = Math.max(
          maximum.opacity,
          recordError('opacity', error, surface.node, sample.progress),
        )
      })
    })
    report.samples.push({ progress: sample.progress, sourceTime: sample.time, maximum })
  }
  report.maximum = worst
  report.visibleMorphCoverage = Object.fromEntries(visibleMorphCoverage)
  report.coverage.visibleMorphMeshes = visibleMorphCoverage.size
  report.coverage.morphVertexComparisons = [...visibleMorphCoverage].reduce(
    (sum, [node, samples]) =>
      sum + morphs.find((probe) => probe.node === node).vertices.length * samples,
    0,
  )
  for (const [kind, result] of Object.entries(worst))
    if (result.error > tolerances[kind])
      report.errors.push(
        kind +
          ' exceeds tolerance: ' +
          result.error +
          ' at ' +
          result.node +
          ' / ' +
          result.progress,
      )
  if (!visibleMorphCoverage.size) report.errors.push('No visible morph probes were compared')
  report.passed = report.errors.length === 0
} catch (error) {
  report.errors.push(error instanceof Error ? error.message : String(error))
} finally {
  action?.stop()
  mixer?.stopAllAction()
  if (gltf) {
    mixer?.uncacheRoot(gltf.scene)
    for (const clip of gltf.animations) mixer?.uncacheClip(clip)
    gltf.scene.removeFromParent()
    gltf.scene.clear()
  }
  for (const geometry of resources.geometries) geometry.dispose()
  for (const material of resources.materials) material.dispose()
  for (const texture of resources.textures) {
    texture.image?.close?.()
    texture.dispose()
  }
  report.released = Object.fromEntries(
    Object.entries(resources).map(([name, values]) => [name, values.size]),
  )
  await browser?.close()
  await writeFile(resolve(output, 'report.json'), await jsonText(report))
}
console.log(
  JSON.stringify(
    {
      passed: report.passed,
      coverage: report.coverage,
      maximum: report.maximum,
      errors: report.errors,
      report: resolve(output, 'report.json'),
    },
    null,
    2,
  ),
)
if (!report.passed) process.exitCode = 1
