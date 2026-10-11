/* global fetch, URL, document, window, TextEncoder, AbortSignal */
import { expect } from '@playwright/test'
import { createHash } from 'node:crypto'

export const slugs = ['typewriter-study', 'piano-cfx', 'reventon']
export const viewport = { width: 1440, height: 1000 }
export const phaseLabels = {
  config: '正在读取商品信息。',
  manifest: '正在核对展示资源。',
  download: '正在读取模型与纹理。',
  parse: '正在准备三维模型。',
  materials: '正在准备材质与光照。',
  'first-frame': '即将进入展示。',
}
const adapters = {
  'typewriter-study': 'typewriter-v1',
  'piano-cfx': 'piano-v1',
  reventon: 'reventon-v1',
}

export function positiveInteger(name, fallback) {
  const value = Number(process.env[name] ?? fallback)
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`)
  return value
}

// Metadata is read from the same real public API and immutable manifest as the visitor.
// Never route/fulfill API responses, reduce textures, or install a product debug collector.
export async function readProducts(base) {
  const origin = new URL(base).origin
  const json = async (url) => {
    const response = await fetch(url, { signal: AbortSignal.timeout(60000) })
    expect(response.ok, `Real API/resource ${url}: ${response.status}`).toBe(true)
    return response.json()
  }
  const catalog = await json(new URL('/api/v1/products', base))
  expect(catalog.map((item) => item.slug).sort()).toEqual([...slugs].sort())
  const products = []
  for (const slug of slugs) {
    const product = await json(new URL(`/api/v1/products/${slug}`, base))
    expect(product.slug).toBe(slug)
    expect(product.displayStatus).toBe('formal')
    expect(product.presentation.version).toBe(3)
    const source = product.presentation.source
    expect(source.kind).toBe('glb')
    expect(source.adapter).toBe(adapters[slug])
    const manifestUrl = new URL(source.bundle.manifest, base)
    expect(manifestUrl.origin).toBe(origin)
    const response = await fetch(manifestUrl, { signal: AbortSignal.timeout(60000) })
    expect(response.ok).toBe(true)
    const bytes = Buffer.from(await response.arrayBuffer())
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(source.bundle.sha256)
    const manifest = JSON.parse(bytes.toString('utf8'))
    expect(manifest.id).toBe(source.bundle.id)
    expect(manifest.version).toBe(source.bundle.version)
    expect(manifest.files.reduce((sum, file) => sum + file.bytes, 0)).toBeLessThanOrEqual(
      manifest.budget.maxBytes,
    )
    const programs = product.presentation.actions.flatMap((action) =>
      action.motion?.program ? [action.motion.program] : [],
    )
    const rig = programs.length ? await json(new URL(programs[0].file, manifestUrl)) : null
    const expectedNodes = new Set([
      ...product.presentation.hotspots.map((hotspot) => hotspot.node),
      ...product.presentation.actions.map((action) => action.node),
      ...product.presentation.actions.flatMap((action) =>
        (action.motion?.tracks ?? []).map((track) => track.node),
      ),
      ...(rig?.parts ?? []).map((part) => part.node),
      ...(rig?.surfaces ?? []).map((surface) => surface.node),
    ])
    const poseNodes = new Set([
      ...product.presentation.hotspots.map((hotspot) => hotspot.node),
      ...product.presentation.actions.map((action) => action.node),
      ...product.presentation.actions.flatMap((action) =>
        (action.motion?.tracks ?? []).map((track) => track.node),
      ),
      ...(rig?.parts ?? []).map((part) => part.node),
    ])
    products.push({
      product,
      manifest,
      manifestUrl: manifestUrl.href,
      modelUrl: new URL(manifest.entry, manifestUrl).href,
      rig,
      expectedNodes: [...expectedNodes].sort(),
      poseNodes: [...poseNodes].sort(),
    })
  }
  return { catalog, products }
}

export function productEvidence({ product, manifest, manifestUrl, rig }) {
  return {
    slug: product.slug,
    adapter: product.presentation.source.adapter,
    manifestUrl,
    manifestSha256: product.presentation.source.bundle.sha256,
    bundle: `${manifest.id}@${manifest.version}`,
    files: manifest.files.length,
    bytes: manifest.files.reduce((sum, file) => sum + file.bytes, 0),
    budget: manifest.budget,
    semanticParts: rig?.parts.length ?? null,
  }
}

export function collectErrors(page, report) {
  page.on('pageerror', (error) => report.errors.push({ type: 'pageerror', message: error.message }))
  page.on('console', (message) => {
    if (message.type() === 'error') report.errors.push({ type: 'console', message: message.text() })
  })
  page.on('requestfailed', (request) =>
    report.failedRequests.push({ url: request.url(), reason: request.failure()?.errorText }),
  )
  page.on('request', (request) => {
    if (/^https?:/.test(request.url())) report.requestOrigins.add(new URL(request.url()).origin)
  })
}

export async function bridge(page, remember = false) {
  await page.evaluate((remember) => {
    let component = document.querySelector('canvas')?.__vueParentComponent
    let scene, motion, store
    const inspect = (current) => {
      const values = Reflect.ownKeys(current.provides ?? {}).map((key) => current.provides[key])
      const appValues = Reflect.ownKeys(current.appContext.provides).map(
        (key) => current.appContext.provides[key],
      )
      scene ??= current.exposed?.context ?? values.find((value) => value?.scene?.value?.isScene)
      motion ??= values.find(
        (value) => value?.states?.value && typeof value.snapshot === 'function',
      )
      store ??= current.setupState?.store
      if (typeof store?.motion !== 'function')
        store = appValues.find((value) => value?._s?.get('workbench'))?._s.get('workbench')
    }
    while (component) {
      inspect(component)
      component = component.parent
    }
    // Production Vue omits DOM backlinks; its real VNode/component tree remains.
    // This is a disposable test-window read, with no app debug API or alternate renderer.
    if (!scene || !motion || !store) {
      const seen = new Set()
      const visit = (vnode) => {
        if (!vnode || typeof vnode !== 'object' || seen.has(vnode)) return
        seen.add(vnode)
        const current = vnode.component
        if (current) {
          inspect(current)
          visit(current.subTree)
        }
        if (Array.isArray(vnode.children)) vnode.children.forEach(visit)
        visit(vnode.suspense?.activeBranch)
      }
      visit(document.querySelector('#app')?._vnode)
    }
    if (!scene || !motion || !store) throw new Error('Real Three/motion/Pinia bridge unavailable')
    const existing = window.__demo
    window.__demo = {
      scene,
      motion,
      store,
      canvas: remember ? document.querySelector('canvas') : existing?.canvas,
      renderer: remember ? scene.renderer.instance : existing?.renderer,
      lifecycle: existing?.lifecycle ?? { roots: [], seen: new WeakSet() },
    }
  }, remember)
}

export async function ready(page, metadata, { remember = false, timeout = 240000 } = {}) {
  const slug = metadata.product.slug
  await expect(page.locator('.workbench')).toHaveAttribute('data-slug', slug, { timeout })
  await page.waitForFunction(
    () =>
      ['ready', 'error', 'content'].includes(document.querySelector('.workbench')?.dataset.status),
    null,
    { timeout },
  )
  const status = await page.locator('.workbench').getAttribute('data-status')
  if (status !== 'ready')
    throw new Error(`${slug}: ${status}: ${await page.locator('.wb-stage-status').innerText()}`)
  await expect(page.locator('canvas')).toHaveCount(1)
  await bridge(page, remember)
  const snapshot = await sceneSnapshot(page, metadata)
  expect(snapshot.products).toEqual([slug])
  expect(snapshot.source).toBe('glb')
  expect(snapshot.adapter).toBe(metadata.product.presentation.source.adapter)
  expect(snapshot.bundle).toBe(`${metadata.manifest.id}@${metadata.manifest.version}`)
  expect(snapshot.missingNodes).toEqual([])
  expect(snapshot.duplicateRequiredNodes).toEqual([])
  expect(snapshot.meshes).toBeGreaterThan(0)
  expect(snapshot.geometries).toBeGreaterThan(0)
  expect(snapshot.triangles).toBeGreaterThan(0)
  expect(snapshot.triangles).toBeLessThanOrEqual(metadata.manifest.budget.maxTriangles)
  expect(snapshot.sourceTriangles).toBe(snapshot.triangles)
  expect(snapshot.sameCanvas).toBe(true)
  expect(snapshot.sameRenderer).toBe(true)
  if (metadata.rig) expect(snapshot.semanticParts).toBe(metadata.rig.parts.length)
  return snapshot
}

// Resource listeners and WeakRefs are test-window state only. No old scene/asset is held strongly.
export async function trackLifecycle(page) {
  return page.evaluate(() => {
    const test = window.__demo,
      root = test.scene.scene.value.children.find((node) => node.userData.workbenchProduct),
      lifecycle = test.lifecycle
    const old = lifecycle.roots.map((entry) => {
      const node = entry.root.deref()
      return {
        slug: entry.slug,
        rootId: entry.rootId,
        detached: !node || (!node.parent && node.children.length === 0),
        resources: entry.resources,
        disposed: entry.disposed,
      }
    })
    if (!lifecycle.roots.some((entry) => entry.rootId === root.uuid)) {
      const entry = {
        slug: root.userData.workbenchProduct,
        rootId: root.uuid,
        root: new WeakRef(root),
        resources: { geometry: 0, material: 0, texture: 0 },
        disposed: { geometry: 0, material: 0, texture: 0 },
      }
      const add = (resource, kind) => {
        if (!resource || lifecycle.seen.has(resource)) return
        lifecycle.seen.add(resource)
        entry.resources[kind]++
        resource.addEventListener('dispose', () => entry.disposed[kind]++)
      }
      root.traverse((node) => {
        add(node.geometry, 'geometry')
        const materials = node.material
          ? Array.isArray(node.material)
            ? node.material
            : [node.material]
          : []
        for (const material of materials) {
          add(material, 'material')
          for (const value of Object.values(material)) if (value?.isTexture) add(value, 'texture')
        }
      })
      lifecycle.roots.push(entry)
    }
    return old
  })
}

export async function sceneSnapshot(page, metadata) {
  return page.evaluate(
    async ({ expectedNodes, poseNodes, rig }) => {
      const { scene, motion, store } = window.__demo,
        roots = scene.scene.value.children.filter((node) => node.userData.workbenchProduct),
        root = roots[0]
      if (!root) throw new Error('Actual product root missing')
      const nodes = {},
        poseNames = new Set(poseNodes),
        names = new Map(),
        poses = [],
        identities = [],
        geometries = new Set(),
        materials = new Set(),
        textures = new Set()
      let triangles = 0,
        meshes = 0,
        instances = 0,
        semanticParts = 0,
        morphMeshes = 0
      root.updateMatrixWorld(true)
      root.traverse((node) => {
        const values = node.material
          ? Array.isArray(node.material)
            ? node.material
            : [node.material]
          : []
        if (node.name) names.set(node.name, (names.get(node.name) ?? 0) + 1)
        if (poseNames.has(node.name))
          nodes[node.name] = {
            id: node.uuid,
            position: node.position.toArray(),
            quaternion: node.quaternion.toArray(),
            scale: node.scale.toArray(),
            world: node.matrixWorld.toArray(),
          }
        if (Number.isInteger(node.userData.partId) || /^piano-part-\d+$/.test(node.name))
          semanticParts++
        if (node.morphTargetInfluences?.length) morphMeshes++
        poses.push([
          node.name,
          node.visible,
          ...node.position.toArray(),
          ...node.quaternion.toArray(),
          ...node.scale.toArray(),
          ...(node.morphTargetInfluences ?? []),
          ...values.map((material) => material.opacity),
        ])
        identities.push([
          node.name,
          node.type,
          node.geometry?.attributes.position?.count ?? 0,
          node.geometry?.index?.count ?? 0,
          node.isInstancedMesh ? node.count : 0,
          values.map((material) => material.name),
        ])
        if (node.isMesh) {
          meshes++
          instances += node.isInstancedMesh ? node.count : 0
          triangles +=
            ((node.geometry.index?.count ?? node.geometry.attributes.position?.count ?? 0) / 3) *
            (node.isInstancedMesh ? node.count : 1)
        }
        if (node.geometry) geometries.add(node.geometry.uuid)
        for (const material of values) {
          materials.add(material.uuid)
          for (const value of Object.values(material))
            if (value?.isTexture) textures.add(value.uuid)
        }
      })
      const digest = async (value) =>
        Array.from(
          new Uint8Array(
            await window.crypto.subtle.digest(
              'SHA-256',
              new TextEncoder().encode(JSON.stringify(value)),
            ),
          ),
          (byte) => byte.toString(16).padStart(2, '0'),
        ).join('')
      const renderer = scene.renderer.instance,
        camera = scene.camera.activeCamera.value,
        gl = renderer.getContext(),
        debug = gl.getExtension('WEBGL_debug_renderer_info')
      return {
        products: roots.map((node) => node.userData.workbenchProduct),
        slug: root.userData.workbenchProduct,
        rootId: root.uuid,
        source: root.userData.sourceKind,
        adapter: root.userData.adapter,
        bundle: root.userData.assetBundle,
        sourceTriangles: root.userData.triangles,
        triangles,
        meshes,
        instances,
        semanticParts,
        morphMeshes,
        nodeCount: poses.length,
        geometries: geometries.size,
        materials: materials.size,
        textures: textures.size,
        missingNodes: expectedNodes.filter((name) => !names.has(name)),
        duplicateRequiredNodes: expectedNodes.filter((name) => (names.get(name) ?? 0) > 1),
        poseDigest: await digest(poses),
        identityDigest: await digest(identities),
        nodes,
        motion: Object.fromEntries(
          Object.entries(motion.states.value).map(([id, value]) => [
            id,
            { progress: value.progress, target: value.target, playing: value.playing },
          ]),
        ),
        camera: [...camera.position.toArray(), ...camera.quaternion.toArray()],
        cameraProjection: {
          fov: camera.fov,
          near: camera.near,
          far: camera.far,
          aspect: camera.aspect,
          zoom: camera.zoom,
          view: camera.view ? { ...camera.view } : null,
          projectionMatrix: camera.projectionMatrix.toArray(),
          viewMatrix: camera.matrixWorldInverse.toArray(),
        },
        selectedPart: store.selectedPart,
        guideStep: store.guideStep,
        sameCanvas: document.querySelector('canvas') === window.__demo.canvas,
        sameRenderer: renderer === window.__demo.renderer,
        renderer: {
          geometries: renderer.info.memory.geometries,
          textures: renderer.info.memory.textures,
          programs: renderer.info.programs?.length ?? 0,
          calls: renderer.info.render.calls,
          triangles: renderer.info.render.triangles,
          pixelRatio: renderer.getPixelRatio(),
          drawingBuffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
          antialias: gl.getContextAttributes()?.antialias,
          shadowEnabled: renderer.shadowMap.enabled,
          exposure: renderer.toneMappingExposure,
          environmentPresent: Boolean(scene.scene.value.environment),
        },
        device: {
          userAgent: window.navigator.userAgent,
          platform: window.navigator.platform,
          hardwareConcurrency: window.navigator.hardwareConcurrency,
          deviceMemoryGiB: window.navigator.deviceMemory ?? null,
          gpu: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : 'unavailable',
          vendor: debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : 'unavailable',
          webglVersion: gl.getParameter(gl.VERSION),
        },
        rigPartCount: rig?.parts.length ?? null,
      }
    },
    {
      expectedNodes: metadata.expectedNodes,
      poseNodes: metadata.poseNodes,
      rig: metadata.rig ? { parts: metadata.rig.parts } : null,
    },
  )
}

export function compactSnapshot(snapshot) {
  const { nodes, device, ...value } = snapshot
  return { ...value, boundNodes: Object.keys(nodes).length, device }
}

export async function choose(page, metadata) {
  const slug = metadata.product.slug
  await page.getByRole('button', { name: '商品目录', exact: true }).click()
  const item = page.locator('.wb-catalog-list button').filter({
    has: page.locator('h3', { hasText: metadata.product.name }),
  })
  // The API name only locates the UI command. ready() verifies actual root/bundle/node identity.
  if ((await item.count()) === 1) await item.click()
  else {
    const escaped = metadata.product.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    await page
      .locator('.wb-catalog-list')
      .getByRole('button', { name: new RegExp(escaped) })
      .click()
  }
  await expect(page.locator('.workbench')).toHaveAttribute('data-slug', slug)
}

export async function openPanel(page, label, selector) {
  if (!(await page.locator(selector).isVisible()))
    await page.getByRole('button', { name: label, exact: true }).click()
  await expect(page.locator(selector)).toBeVisible()
}

export async function inputPoint(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector('canvas'),
      bounds = canvas.getBoundingClientRect()
    for (const y of [0.35, 0.45, 0.55, 0.65])
      for (const x of [0.35, 0.45, 0.55, 0.65, 0.75]) {
        const point = { x: bounds.x + bounds.width * x, y: bounds.y + bounds.height * y }
        if (document.elementFromPoint(point.x, point.y) === canvas) return point
      }
    throw new Error('No unobscured actual Canvas input point')
  })
}

export async function observeWithMouse(page, index = 0) {
  const point = await inputPoint(page)
  await page.mouse.move(point.x, point.y)
  await page.mouse.down()
  await page.mouse.move(point.x + (index % 2 ? -65 : 65), point.y + 20, { steps: 8 })
  await page.mouse.up()
  await page.mouse.wheel(0, index % 2 ? -65 : 65)
}

export function near(actual, expected, tolerance = 1e-6) {
  expect(actual).toHaveLength(expected.length)
  expect(Math.max(...actual.map((value, index) => Math.abs(value - expected[index])))).toBeLessThan(
    tolerance,
  )
}

// Independently derive the same physical hotspot point from transformed scene nodes.
// Piano's semantic node can be empty, so use the current visible surface bounds from its rig.
export async function hotspotEvidence(page, metadata, hotspot) {
  const part = metadata.rig?.parts.find((entry) => entry.node === hotspot.node)
  return page.evaluate(
    ({ hotspot, part, adapter }) => {
      const scene = window.__demo.scene,
        camera = scene.camera.activeCamera.value,
        root = scene.scene.value.children.find((node) => node.userData.workbenchProduct),
        node = root.getObjectByName(hotspot.node)
      if (!node) throw new Error('Hotspot actual node missing: ' + hotspot.node)
      root.updateMatrixWorld(true)
      const world = camera.position.clone()
      if (adapter === 'piano-v1' && part && !hotspot.anchor) {
        const minimum = [Infinity, Infinity, Infinity],
          maximum = [-Infinity, -Infinity, -Infinity]
        let found = false
        for (const name of [...part.section, ...part.flat])
          root.getObjectByName(name)?.traverse((mesh) => {
            if (!mesh.isMesh) return
            for (let current = mesh; current; current = current.parent) if (!current.visible) return
            if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox()
            const box = mesh.geometry.boundingBox?.clone().applyMatrix4(mesh.matrixWorld)
            if (!box) return
            found = true
            box.min.toArray().forEach((v, i) => (minimum[i] = Math.min(minimum[i], v)))
            box.max.toArray().forEach((v, i) => (maximum[i] = Math.max(maximum[i], v)))
          })
        if (found) world.fromArray(minimum.map((v, i) => (v + maximum[i]) / 2))
        else root.children[0].localToWorld(world.fromArray(part.restPoint))
      } else node.localToWorld(world.fromArray(hotspot.anchor ?? [0, 0, 0]))
      const projected = world.clone().project(camera),
        canvas = document.querySelector('canvas'),
        expectedScreen = [
          (projected.x * 0.5 + 0.5) * canvas.clientWidth,
          (-projected.y * 0.5 + 0.5) * canvas.clientHeight,
        ],
        button = [...document.querySelectorAll('.wb-hotspot')].find(
          (element) => element.dataset.part === hotspot.id,
        ),
        line = [...document.querySelectorAll('.wb-callout-lines path')].find(
          (element) => element.dataset.part === hotspot.id,
        ),
        coordinates = line?.getAttribute('d')?.match(/[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/gi),
        actualScreen = coordinates?.slice(0, 2).map(Number)
      return {
        id: hotspot.id,
        node: hotspot.node,
        nodeId: node.uuid,
        world: world.toArray(),
        expectedCamera: world.toArray().map((value, index) => value + hotspot.cameraOffset[index]),
        actualCamera: camera.position.toArray(),
        selectedPart: window.__demo.store.selectedPart,
        labelVisible: button?.dataset.layoutVisible === 'true',
        expectedScreen,
        actualScreen,
        anchorErrorPx: actualScreen
          ? Math.max(...actualScreen.map((value, index) => Math.abs(value - expectedScreen[index])))
          : null,
      }
    },
    { hotspot, part, adapter: metadata.product.presentation.source.adapter },
  )
}
