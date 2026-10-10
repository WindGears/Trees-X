/* global URL, fetch, location, TextEncoder, Blob, AbortController */
import { chromium, expect } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import sharp from 'sharp'

const base = process.env.TREES_FRONTEND_URL ?? 'http://127.0.0.1:5181'
const output = 'artifacts/glb-image-orientation'
const negative = process.env.TREES_PROVE_ORIENTATION_FAILURE === '1'
const pixels = Buffer.alloc(8 * 8 * 4)
for (let y = 0; y < 8; y++)
  for (let x = 0; x < 8; x++) {
    const color =
      y < 4 ? (x < 4 ? [240, 30, 20] : [20, 220, 50]) : x < 4 ? [20, 50, 230] : [245, 190, 20]
    pixels.set([...color, 255], (y * 8 + x) * 4)
  }
const image = await sharp(pixels, { raw: { width: 8, height: 8, channels: 4 } })
  .png()
  .toBuffer()
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const report = {
  scope:
    'Actual native Three GLTFLoader versus workbench verified-byte decoder; asymmetric external PNG, shared image sources and distinct material channels',
  errors: [],
  external: [],
  negativeMutation: negative,
}
try {
  const page = await browser.newPage({ viewport: { width: 600, height: 400 } })
  page.on('pageerror', (error) => report.errors.push(error.message))
  page.on('request', (request) => {
    if (/^https?:/.test(request.url()) && new URL(request.url()).origin !== new URL(base).origin)
      report.external.push(request.url())
  })
  // A blank same-origin harness: no application Canvas, second renderer, or large exhibit request.
  await page.route('**/__glb-orientation-check', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>GLB orientation regression</title>',
    }),
  )
  if (negative)
    await page.route('**/src/lib/workbench/glbLoader.ts', async (route) => {
      const response = await route.fetch()
      const original = await response.text()
      const body = original.replace(/imageOrientation:\s*["']none["']/, 'imageOrientation: "flipY"')
      if (original === body) throw new Error('Negative mutation did not replace the decoder option')
      await route.fulfill({ response, body })
    })
  await page.goto(base + '/__glb-orientation-check')
  const result = await page.evaluate(
    async (imageBytes) => {
      const source = await (await fetch('/src/lib/workbench/glbLoader.ts')).text()
      const moduleURL = (name) => {
        const path = [...source.matchAll(/from\s+["']([^"']+)["']/g)]
          .map((m) => m[1])
          .find((p) => p.includes(name))
        if (!path) throw new Error('Missing transformed module URL: ' + name)
        return new URL(path, location.href).href
      }
      const THREE = await import(moduleURL('/three.js'))
      const { GLTFLoader } = await import(moduleURL('GLTFLoader'))
      const { decodeGlb } = await import('/src/lib/workbench/glbLoader.ts')
      const bitmapDecodeCalls = []
      const nativeCreateImageBitmap = window.createImageBitmap.bind(window)
      let phase = 'native'
      window.createImageBitmap = (blob, options) => {
        bitmapDecodeCalls.push({ phase, options: { ...options } })
        return nativeCreateImageBitmap(blob, options)
      }
      const canvas = document.createElement('canvas')
      document.body.append(canvas)
      const renderer = new THREE.WebGLRenderer({ canvas, antialias: false })
      renderer.setSize(256, 128)
      renderer.outputColorSpace = THREE.SRGBColorSpace
      renderer.toneMapping = THREE.NoToneMapping
      const scene = new THREE.Scene()
      scene.background = new THREE.Color('#16202a')
      const camera = new THREE.OrthographicCamera(-1.15, 1.15, 0.6, -0.6, 0.1, 10)
      camera.position.z = 3
      scene.add(new THREE.AmbientLight('#ffffff', 2))
      const lamp = new THREE.DirectionalLight('#ffffff', 3)
      lamp.position.set(1, 1, 4)
      scene.add(lamp)
      const target = new THREE.WebGLRenderTarget(256, 128)
      target.texture.colorSpace = THREE.SRGBColorSpace
      const segments = [
        new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]),
        new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
        new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
        new Uint16Array([0, 1, 2, 0, 2, 3]),
      ]
      const binary = new Uint8Array(segments.reduce((sum, part) => sum + part.byteLength, 0))
      let offset = 0
      const bufferViews = segments.map((part) => {
        binary.set(new Uint8Array(part.buffer), offset)
        const view = { buffer: 0, byteOffset: offset, byteLength: part.byteLength }
        offset += part.byteLength
        return view
      })
      const fixtureDocument = {
        asset: { version: '2.0' },
        extensionsUsed: ['KHR_materials_unlit'],
        scene: 0,
        scenes: [{ nodes: [0, 1] }],
        nodes: [
          { mesh: 0, translation: [-0.53, 0, 0] },
          { mesh: 1, translation: [0.53, 0, 0] },
        ],
        meshes: [0, 1].map((material) => ({
          primitives: [
            {
              attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2, TEXCOORD_1: 2 },
              indices: 3,
              material,
            },
          ],
        })),
        buffers: [{ byteLength: binary.byteLength }],
        bufferViews,
        accessors: [
          {
            bufferView: 0,
            componentType: 5126,
            count: 4,
            type: 'VEC3',
            min: [-0.5, -0.5, 0],
            max: [0.5, 0.5, 0],
          },
          { bufferView: 1, componentType: 5126, count: 4, type: 'VEC3' },
          { bufferView: 2, componentType: 5126, count: 4, type: 'VEC2' },
          { bufferView: 3, componentType: 5123, count: 6, type: 'SCALAR' },
        ],
        images: [{ uri: 'asymmetric.png' }],
        samplers: [
          { wrapS: 33071, wrapT: 33071 },
          { wrapS: 10497, wrapT: 33071 },
          { wrapS: 33071, wrapT: 10497 },
        ],
        textures: [0, 1, 2].map((sampler) => ({ source: 0, sampler })),
        materials: [
          {
            name: 'unlit-colour',
            pbrMetallicRoughness: { baseColorTexture: { index: 0 } },
            extensions: { KHR_materials_unlit: {} },
          },
          {
            name: 'pbr-channels',
            pbrMetallicRoughness: {
              baseColorTexture: { index: 1 },
              metallicFactor: 0,
              metallicRoughnessTexture: { index: 2, texCoord: 1 },
            },
            normalTexture: { index: 2, texCoord: 1, scale: 0.2 },
            occlusionTexture: { index: 2, texCoord: 1 },
          },
        ],
      }
      const encoded = new TextEncoder().encode(JSON.stringify(fixtureDocument))
      const jsonLength = Math.ceil(encoded.byteLength / 4) * 4
      const binLength = Math.ceil(binary.byteLength / 4) * 4
      const glb = new ArrayBuffer(28 + jsonLength + binLength)
      const header = new DataView(glb)
      header.setUint32(0, 0x46546c67, true)
      header.setUint32(4, 2, true)
      header.setUint32(8, glb.byteLength, true)
      header.setUint32(12, jsonLength, true)
      header.setUint32(16, 0x4e4f534a, true)
      new Uint8Array(glb, 20, jsonLength).fill(32)
      new Uint8Array(glb, 20, encoded.byteLength).set(encoded)
      header.setUint32(20 + jsonLength, binLength, true)
      header.setUint32(24 + jsonLength, 0x004e4942, true)
      new Uint8Array(glb, 28 + jsonLength, binary.byteLength).set(binary)
      const png = new Uint8Array(imageBytes).buffer
      const imageURL = URL.createObjectURL(new Blob([png], { type: 'image/png' }))
      const manager = new THREE.LoadingManager().setURLModifier((url) =>
        url === 'asymmetric.png' ? imageURL : url,
      )
      const native = await new GLTFLoader(manager).parseAsync(glb.slice(0), '')
      phase = 'workbench'
      const bundle = {
        entry: 'fixture.glb',
        files: [
          { path: 'fixture.glb', role: 'model' },
          { path: 'asymmetric.png', role: 'texture' },
        ],
      }
      const decoded = await decodeGlb(
        bundle,
        new Map([
          ['fixture.glb', glb.slice(0)],
          ['asymmetric.png', png],
        ]),
        renderer,
        new AbortController().signal,
      )
      window.createImageBitmap = nativeCreateImageBitmap
      const texturesOf = (root) => {
        const textures = new Set()
        root.traverse((node) => {
          if (!node.isMesh) return
          for (const material of Array.isArray(node.material) ? node.material : [node.material])
            for (const texture of Object.values(material))
              if (texture?.isTexture) textures.add(texture)
        })
        return [...textures]
      }
      const metadata = (root) => {
        const result = []
        root.traverse((node) => {
          if (!node.isMesh) return
          const material = node.material
          result.push({
            name: material.name,
            maps: ['map', 'normalMap', 'metalnessMap', 'roughnessMap', 'aoMap']
              .filter((key) => material[key])
              .map((key) => ({
                key,
                colorSpace: material[key].colorSpace,
                channel: material[key].channel,
                flipY: material[key].flipY,
                width: material[key].image.width,
                height: material[key].image.height,
              })),
          })
        })
        return result
      }
      const bitmapPixels = (texture) => {
        const scratch = document.createElement('canvas')
        scratch.width = texture.image.width
        scratch.height = texture.image.height
        const context = scratch.getContext('2d')
        context.drawImage(texture.image, 0, 0)
        return [...context.getImageData(0, 0, scratch.width, scratch.height).data]
      }
      const render = async (root) => {
        scene.add(root)
        await renderer.compileAsync(scene, camera)
        renderer.setRenderTarget(target)
        renderer.render(scene, camera)
        const result = new Uint8Array(256 * 128 * 4)
        renderer.readRenderTargetPixels(target, 0, 0, 256, 128, result)
        renderer.setRenderTarget(null)
        renderer.render(scene, camera)
        root.removeFromParent()
        return result
      }
      const nativePixels = await render(native.scene)
      const customPixels = await render(decoded.root)
      let changed = 0,
        maximum = 0
      for (let i = 0; i < nativePixels.length; i++) {
        const delta = Math.abs(nativePixels[i] - customPixels[i])
        if (delta) changed++
        maximum = Math.max(maximum, delta)
      }
      const nativeTextures = texturesOf(native.scene),
        customTextures = texturesOf(decoded.root)
      const info = {
        bitmapDecodeCalls,
        native: metadata(native.scene),
        workbench: metadata(decoded.root),
        nativeBitmap: bitmapPixels(nativeTextures[0]),
        workbenchBitmap: bitmapPixels(customTextures[0]),
        sharedImageSource:
          customTextures.length > 1 &&
          customTextures.every((texture) => texture.image === customTextures[0].image),
        render: {
          changedChannels: changed,
          maxChannelDelta255: maximum,
          pixels: nativePixels.length,
        },
      }
      const closeCount = []
      for (const bitmap of new Set(customTextures.map((texture) => texture.image))) {
        const close = bitmap.close.bind(bitmap),
          index = closeCount.length
        closeCount.push(0)
        bitmap.close = () => {
          closeCount[index]++
          close()
        }
      }
      decoded.dispose()
      decoded.dispose()
      info.closeCount = closeCount
      const materials = new Set(),
        geometries = new Set()
      native.scene.traverse((node) => {
        if (node.isMesh) {
          geometries.add(node.geometry)
          materials.add(node.material)
        }
      })
      for (const geometry of geometries) geometry.dispose()
      for (const material of materials) material.dispose()
      for (const texture of nativeTextures) texture.dispose()
      for (const bitmap of new Set(nativeTextures.map((texture) => texture.image))) bitmap.close()
      native.scene.clear()
      URL.revokeObjectURL(imageURL)
      target.dispose()
      renderer.dispose()
      renderer.forceContextLoss()
      canvas.remove()
      info.canvasAfterCleanup = document.querySelectorAll('canvas').length
      return info
    },
    [...image],
  )
  report.result = { ...result, nativeBitmap: undefined, workbenchBitmap: undefined }
  expect(result.bitmapDecodeCalls.filter((call) => call.phase === 'workbench')).toEqual([
    {
      phase: 'workbench',
      options: { imageOrientation: 'none', premultiplyAlpha: 'none', colorSpaceConversion: 'none' },
    },
  ])
  expect(result.workbench).toEqual(result.native)
  expect(result.workbenchBitmap).toEqual(result.nativeBitmap)
  expect(result.nativeBitmap.slice(0, 4)).toEqual([240, 30, 20, 255])
  expect(result.render.changedChannels).toBe(0)
  expect(result.sharedImageSource).toBe(true)
  expect(result.closeCount).toEqual([1])
  expect(result.canvasAfterCleanup).toBe(0)
  expect(report.errors).toEqual([])
  expect(report.external).toEqual([])
  report.passed = true
} catch (error) {
  report.failure = String(error)
  throw error
} finally {
  await writeFile(
    output + (negative ? '/negative-report.json' : '/report.json'),
    JSON.stringify(report, null, 2),
  )
  await browser.close()
}
console.log(JSON.stringify(report, null, 2))
