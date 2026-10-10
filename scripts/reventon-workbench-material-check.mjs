/* global createImageBitmap, ImageBitmap, fetch */
import { chromium, expect } from '@playwright/test'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import sharp from 'sharp'

const base = process.env.CHECK_URL || 'http://127.0.0.1:5181'
const output = 'artifacts/reventon-workbench/material-fix'
const report = { passed: false, errors: [], checks: [] }
await mkdir(output, { recursive: true })
const glb = await readFile('public/models/reventon/reventon.glb')
const gltfDocument = JSON.parse(glb.toString('utf8', 20, 20 + glb.readUInt32LE(12)))
const imagePaths = Object.fromEntries(
  gltfDocument.materials.map((material) => [
    material.name,
    Object.fromEntries(
      Object.entries({
        map: material.pbrMetallicRoughness?.baseColorTexture,
        normalMap: material.normalTexture,
        roughnessMap: material.pbrMetallicRoughness?.metallicRoughnessTexture,
        metalnessMap: material.pbrMetallicRoughness?.metallicRoughnessTexture,
        aoMap: material.occlusionTexture,
      })
        .filter(([, reference]) => reference)
        .map(([key, reference]) => [
          key,
          gltfDocument.images[gltfDocument.textures[reference.index].source].uri,
        ]),
    ),
  ]),
)
const browser = await chromium.launch({ channel: 'msedge', headless: true })
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: 'reduce',
  })
  page.on('pageerror', (error) => report.errors.push(error.message))
  await page.addInitScript(() => {
    window.__bitmapOptions = []
    const nativeDecode = window.createImageBitmap.bind(window)
    window.createImageBitmap = (...args) => {
      window.__bitmapOptions.push(args[1] ?? {})
      return nativeDecode(...args)
    }
  })
  await page.goto(base + '/?product=reventon', { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(
    () => ['ready', 'error'].includes(document.querySelector('.workbench')?.dataset.status),
    null,
    { timeout: 180000 },
  )
  if ((await page.locator('.workbench').getAttribute('data-status')) !== 'ready')
    throw new Error(await page.locator('.wb-stage-status').innerText())
  expect(await page.locator('.workbench').getAttribute('data-status')).toBe('ready')
  const materialCheck = await page.evaluate(async (imagePaths) => {
    let component = document.querySelector('canvas').__vueParentComponent
    let context
    while (component && !context) {
      context =
        component.exposed?.context ??
        Reflect.ownKeys(component.provides ?? {})
          .map((key) => component.provides[key])
          .find((value) => value?.scene?.value?.isScene)
      component = component.parent
    }
    if (!context) throw new Error('Actual car context missing')
    window.__materialContext = context
    const root = context.scene.value.children.find((node) => node.userData.workbenchProduct)
    const metadata = [],
      examples = [],
      repairs = []
    const visited = new Set()
    root.traverse((node) => {
      if (!node.isMesh) return
      const materials = Array.isArray(node.material) ? node.material : [node.material]
      for (const material of materials) {
        if (/\/ (18581|18110|18821|18981|19061|19141)$/.test(material.name))
          repairs.push({
            name: material.name,
            colour: material.color.toArray(),
            hasColourMap: Boolean(material.map),
            hasNormal: Boolean(material.normalMap),
            hasRoughness: Boolean(material.roughnessMap),
            hasAO: Boolean(material.aoMap),
            transparent: material.transparent,
            forceSinglePass: material.forceSinglePass,
            depthWrite: material.depthWrite,
            polygonOffset: material.polygonOffset,
            alphaTest: material.alphaTest,
          })
        for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap']) {
          const texture = material[key]
          if (!texture) continue
          const attribute = texture.channel ? 'uv' + texture.channel : 'uv'
          metadata.push({
            material: material.name,
            key,
            channel: texture.channel,
            hasUV: Boolean(node.geometry.getAttribute(attribute)),
            flipY: texture.flipY,
            colorSpace: texture.colorSpace,
            imageBitmap: texture.image instanceof ImageBitmap,
          })
          if (
            examples.length < 6 &&
            /\/ (door_1|fixed) \/ (18581|19771|19851)$/.test(material.name) &&
            !visited.has(imagePaths[material.name][key])
          ) {
            visited.add(imagePaths[material.name][key])
            examples.push({ material: material.name, key, texture })
          }
        }
      }
    })
    const bitmapChecks = []
    const pixels = (image) => {
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = 64
      const draw = canvas.getContext('2d')
      draw.drawImage(image, 0, 0, 64, 64)
      return draw.getImageData(0, 0, 64, 64).data
    }
    const actualOptions = window.__bitmapOptions.slice()
    for (const { material, key, texture } of examples) {
      const image = await createImageBitmap(
        await (await fetch('/models/reventon/' + imagePaths[material][key])).blob(),
        { premultiplyAlpha: 'none', colorSpaceConversion: 'none' },
      )
      const expected = pixels(image),
        actual = pixels(texture.image)
      let different = 0,
        max = 0
      for (let i = 0; i < actual.length; i++) {
        const delta = Math.abs(actual[i] - expected[i])
        if (delta) different++
        max = Math.max(max, delta)
      }
      image.close()
      bitmapChecks.push({ material, key, name: texture.name, different, max })
    }
    return { slug: root.userData.workbenchProduct, actualOptions, metadata, bitmapChecks, repairs }
  }, imagePaths)
  report.materials = materialCheck
  expect(materialCheck.slug).toBe('reventon')
  expect(materialCheck.actualOptions.length).toBe(75)
  expect(materialCheck.actualOptions.every((o) => o.imageOrientation === 'none')).toBe(true)
  expect(materialCheck.metadata.every((m) => m.hasUV && !m.flipY && m.imageBitmap)).toBe(true)
  expect(materialCheck.bitmapChecks.length).toBeGreaterThan(0)
  expect(materialCheck.bitmapChecks.every((c) => c.different === 0)).toBe(true)
  report.checks.push(
    'All 75 images decode without vertical inversion; each material UV channel exists',
  )
  report.checks.push('Actual cabin/door colour, normal and AO bitmaps equal native PNG decoding')
  await page.getByRole('button', { name: '结构与动作', exact: true }).click()
  const panel = page.locator('.wb-car-motion')
  await panel.getByRole('button', { name: '打开双门', exact: true }).click()
  await panel.getByRole('button', { name: '座舱观察', exact: true }).click()
  await page.screenshot({ path: output + '/cabin-verified.png' })
  report.surfaceSamples = await page.evaluate(async () => {
    const context = window.__materialContext
    const text = await (await fetch('/src/lib/workbench/glbLoader.ts')).text()
    const path = [...text.matchAll(/from\s+["']([^"']+)["']/g)]
      .map((match) => match[1])
      .find((path) => path.includes('/three.js'))
    const { Raycaster, Vector2 } = await import(path)
    const root = context.scene.value.children.find((node) => node.userData.workbenchProduct)
    const rect = document.querySelector('canvas').getBoundingClientRect()
    const ray = new Raycaster()
    return [
      [709, 658],
      [758, 686],
      [456, 162],
      [359, 386],
      [565, 399],
      [673, 459],
    ].map(([x, y]) => {
      ray.setFromCamera(
        new Vector2(
          ((x - rect.left) / rect.width) * 2 - 1,
          -((y - rect.top) / rect.height) * 2 + 1,
        ),
        context.camera.activeCamera.value,
      )
      const hits = ray.intersectObject(root, true).slice(0, 3)
      return {
        x,
        y,
        hits: hits.map(({ object, face, uv, distance }) => ({
          mesh: object.name,
          material: (Array.isArray(object.material)
            ? object.material[face.materialIndex]
            : object.material
          ).name,
          uv: uv?.toArray(),
          distance,
        })),
      }
    })
  })
  const trim = materialCheck.repairs.filter((m) => /\/ 18581$/.test(m.name))
  const decals = materialCheck.repairs.filter((m) => !/\/ 18581$/.test(m.name))
  expect(trim.length).toBeGreaterThan(0)
  expect(trim.every((m) => !m.hasColourMap && m.hasNormal && m.hasRoughness && m.hasAO)).toBe(true)
  expect(
    trim.every((m) => m.colour.every((v, i) => Math.abs(v - [0.025, 0.026, 0.028][i]) < 1e-8)),
  ).toBe(true)
  expect(decals.length).toBeGreaterThan(0)
  expect(
    decals.every(
      (m) =>
        m.transparent &&
        m.hasColourMap &&
        m.forceSinglePass &&
        !m.depthWrite &&
        m.polygonOffset &&
        m.alphaTest === 0.02,
    ),
  ).toBe(true)
  report.checks.push(
    'Clean suede retains original normal, roughness and AO; transparent trim retains authored colour/alpha maps',
  )

  // Restore only the original dirt colour temporarily, using the same camera,
  // lights and renderer. Pixel differences prove the shipped correction is visible.
  const originals = Object.fromEntries(
    gltfDocument.materials
      .filter((m) => /\/ 18581$/.test(m.name))
      .map((m) => [
        m.name,
        {
          image: imagePaths[m.name].map,
          colour: m.pbrMetallicRoughness.baseColorFactor ?? [1, 1, 1, 1],
        },
      ]),
  )
  const clean = await page.locator('canvas').screenshot()
  await writeFile(output + '/cabin-clean-canvas.png', clean)
  await page.evaluate(async (originals) => {
    const context = window.__materialContext
    const text = await (await fetch('/src/lib/workbench/glbLoader.ts')).text()
    const path = [...text.matchAll(/from\s+["']([^"']+)["']/g)]
      .map((m) => m[1])
      .find((p) => p.includes('/three.js'))
    const { Texture, SRGBColorSpace } = await import(path)
    const root = context.scene.value.children.find((node) => node.userData.workbenchProduct)
    const overrides = []
    const visited = new Set()
    const surfaces = []
    root.traverse((node) => {
      if (!node.isMesh) return
      for (const material of Array.isArray(node.material) ? node.material : [node.material])
        if (originals[material.name] && !visited.has(material)) {
          visited.add(material)
          surfaces.push(material)
        }
    })
    for (const material of surfaces) {
      const source = originals[material.name]
      const bitmap = await createImageBitmap(
        await (await fetch('/models/reventon/' + source.image)).blob(),
        { imageOrientation: 'none', premultiplyAlpha: 'none', colorSpaceConversion: 'none' },
      )
      const map = new Texture(bitmap)
      map.channel = material.normalMap.channel
      map.wrapS = material.normalMap.wrapS
      map.wrapT = material.normalMap.wrapT
      map.flipY = false
      map.colorSpace = SRGBColorSpace
      map.anisotropy = context.renderer.instance.capabilities.getMaxAnisotropy()
      map.needsUpdate = true
      overrides.push({ material, color: material.color.clone(), map, bitmap })
      material.map = map
      material.color.fromArray(source.colour)
      material.needsUpdate = true
    }
    window.__dirtOverrides = overrides
    const renderer = context.renderer.instance
    await renderer.compileAsync(context.scene.value, context.camera.activeCamera.value)
    renderer.render(context.scene.value, context.camera.activeCamera.value)
  }, originals)
  const dirty = await page.locator('canvas').screenshot()
  await writeFile(output + '/cabin-source-dirt-canvas.png', dirty)
  await page.evaluate(async () => {
    const context = window.__materialContext
    for (const { material, color, map, bitmap } of window.__dirtOverrides) {
      material.map = null
      material.color.copy(color)
      material.needsUpdate = true
      map.dispose()
      bitmap.close()
    }
    window.__dirtOverrides = undefined
    const renderer = context.renderer.instance
    await renderer.compileAsync(context.scene.value, context.camera.activeCamera.value)
    renderer.render(context.scene.value, context.camera.activeCamera.value)
  })
  const a = await sharp(clean).removeAlpha().raw().toBuffer()
  const b = await sharp(dirty).removeAlpha().raw().toBuffer()
  let changed = 0,
    max = 0
  for (let i = 0; i < a.length; i++) {
    const delta = Math.abs(a[i] - b[i])
    if (delta > 4) changed++
    max = Math.max(max, delta)
  }
  report.visibleRepair = { changedChannels: changed, totalChannels: a.length, max }
  expect(changed).toBeGreaterThan(10000)
  report.checks.push('Real cabin pixel comparison detects removal of the source dirt colour')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: output + '/cabin-390.png' })
  expect(await page.locator('canvas').count()).toBe(1)
  expect(report.errors).toEqual([])
  report.passed = true
} catch (error) {
  report.failure = String(error)
  throw error
} finally {
  await writeFile(output + '/report.json', JSON.stringify(report, null, 2) + '\n')
  await browser.close()
}
console.log(JSON.stringify({ passed: report.passed, checks: report.checks, errors: report.errors }))
