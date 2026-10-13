/* global URL */
import { chromium, expect } from '@playwright/test'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import sharp from 'sharp'
import { bridge, readProducts, near } from './demo/browser-check.mjs'

const base = process.env.CHECK_URL || 'http://127.0.0.1:5182',
  output = process.env.HYBRID_VISUAL_OUTPUT || 'artifacts/hybrid-workbench/production-views',
  timeout = Number(process.env.HYBRID_VISUAL_TIMEOUT || 480000),
  views = (process.env.HYBRID_VISUAL_VIEWS || 'whole,paint,metal,layers,flat').split(',')
if (!Number.isFinite(timeout) || timeout < 1000) throw new Error('Invalid visual timeout')
if (new Set(views).size !== views.length) throw new Error('Duplicate visual view')
for (const view of views)
  if (!['whole', 'paint', 'metal', 'layers', 'flat'].includes(view))
    throw new Error(`Invalid visual view: ${view}`)

const started = Date.now(),
  report = {
    passed: false,
    source: 'Real production workbench, published API and immutable GLB resource bundle',
    comparisonScope:
      'These captures retain the production GPU studio, authored softbox environment, live instancing, visitor projection and focus highlight. The independent renderlab uses a shared Studio Small 05 HDR, no production ambient/studio reflection/contact-shadow approximation, and raw meshes. Its images and timing are not an identical production-scene comparison.',
    viewport: { width: 1440, height: 1000 },
    views: [],
    checks: [],
    errors: [],
    failedRequests: [],
    requests: [],
  }
let stage = 'initialization'
const progress = (next, detail) => {
  stage = next
  console.log(`[hybrid visual ${Math.round((Date.now() - started) / 1000)}s] ${next}`, detail ?? '')
}
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const failOnErrors = () => {
  if (report.errors.length) throw new Error(`Browser error: ${report.errors[0].message}`)
  if (report.failedRequests.length)
    throw new Error(`Network request failed: ${report.failedRequests[0].url}`)
}
await mkdir(output, { recursive: true })
let browser, page
try {
  const { products } = await readProducts(base),
    metadata = products.find((item) => item.product.slug === 'typewriter-study')
  if (!metadata) throw new Error('Published typewriter absent')
  const presentation = metadata.product.presentation,
    actionId = presentation.structureActionId
  if (!presentation.actions.some((action) => action.id === actionId && action.kind === 'progress'))
    throw new Error('Actual typewriter structure progress action absent')
  for (const id of ['perspective', 'structure', 'knoll'])
    if (!presentation.views.some((view) => view.id === id))
      throw new Error(`Missing real view ${id}`)
  for (const id of ['part-095', 'part-046'])
    if (!presentation.hotspots.some((hotspot) => hotspot.id === id))
      throw new Error(`Missing real hotspot ${id}`)
  report.published = {
    slug: metadata.product.slug,
    name: metadata.product.name,
    presentationVersion: presentation.version,
    presentationDigest: digest(presentation),
    manifestUrl: metadata.manifestUrl,
    manifestSha256: presentation.source.bundle.sha256,
    bundle: `${metadata.manifest.id}@${metadata.manifest.version}`,
  }
  browser = await chromium.launch({ channel: 'msedge', headless: true })
  page = await browser.newPage({ viewport: report.viewport, deviceScaleFactor: 1 })
  page.on('pageerror', (error) => report.errors.push({ stage, message: error.message }))
  page.on('console', (message) => {
    if (message.type() === 'error') report.errors.push({ stage, message: message.text() })
  })
  page.on('response', (response) => {
    if (response.status() >= 400)
      report.errors.push({ stage, message: `${response.status()} ${response.url()}` })
  })
  page.on('requestfailed', (request) =>
    report.failedRequests.push({ stage, url: request.url(), reason: request.failure()?.errorText }),
  )
  page.on('request', (request) => {
    if (/^https?:/.test(request.url())) report.requests.push(request.url())
  })
  progress('Load actual hybrid workbench')
  await page.goto(new URL('/?product=typewriter-study&renderPipeline=hybrid', base).href)
  await expect(page.locator('.workbench')).toHaveAttribute('data-slug', 'typewriter-study')
  await expect
    .poll(
      async () => {
        failOnErrors()
        const state = await page.locator('.workbench').getAttribute('data-status')
        if (state === 'error' || state === 'content')
          throw new Error(`Workbench failed to produce a real raster frame: ${state}`)
        return state
      },
      { timeout, intervals: [500, 1000] },
    )
    .toBe('ready')
  await expect(page.locator('canvas')).toHaveCount(1)
  await expect(page.locator('.wb-stage')).toHaveAttribute('data-render-backend', 'webgpu')
  await bridge(page, true)
  // This is disposable test-window access to the real Vue exposure. No app debug
  // collector, injected model, alternate renderer or mocked API is installed.
  await page.evaluate(() => {
    const seen = new Set()
    const visit = (vnode) => {
      if (!vnode || typeof vnode !== 'object' || seen.has(vnode)) return undefined
      seen.add(vnode)
      const component = vnode.component
      if (component) {
        // Tres renders its scene subtree outside the normal DOM VNode children.
        // Read the parent's retained template ref to the actual scene exposure.
        for (const exposed of [component.exposed, component.refs?.sceneHost]) {
          const hybrid = exposed?.hybrid?.value ?? exposed?.hybrid
          if (hybrid?.snapshot && exposed.realtime && exposed.checkpoint) return exposed
        }
        const found = visit(component.subTree)
        if (found) return found
      }
      for (const child of Array.isArray(vnode.children) ? vnode.children : []) {
        const found = visit(child)
        if (found) return found
      }
      return visit(vnode.suspense?.activeBranch)
    }
    const exposed = visit(document.querySelector('#app')?._vnode)
    if (!exposed) throw new Error('Real WorkbenchScene exposure absent')
    window.__hybridVisualExposure = exposed
  })
  const refinement = () =>
    page.evaluate(() => {
      const exposed = window.__hybridVisualExposure,
        hybrid = exposed.hybrid?.value ?? exposed.hybrid
      return hybrid.snapshot()
    })
  const actual = () =>
    page.evaluate(() => {
      const test = window.__demo,
        context = test.scene,
        scene = context.scene.value,
        renderer = context.renderer.instance,
        camera = context.camera.activeCamera.value,
        roots = scene.children.filter((node) => node.userData.workbenchProduct),
        root = roots[0]
      if (!root || roots.length !== 1) throw new Error('Unique real product root absent')
      root.updateMatrixWorld(true)
      const parts = [],
        poses = [],
        materialRecords = new Map(),
        lights = [],
        traceExcluded = []
      let meshes = 0,
        instances = 0,
        triangles = 0
      root.traverse((node) => {
        if (Number.isInteger(node.userData.partId)) parts.push(node.name)
        poses.push([
          node.name,
          node.visible,
          ...node.position.toArray(),
          ...node.quaternion.toArray(),
          ...node.scale.toArray(),
          ...(node.morphTargetInfluences ?? []),
        ])
        if (!node.isMesh) return
        meshes++
        const count = node.isInstancedMesh ? node.count : 1
        if (node.isInstancedMesh) {
          instances += node.count
          poses.push([`${node.name}:instance-matrices`, ...node.instanceMatrix.array])
          if (node.instanceColor)
            poses.push([`${node.name}:instance-colors`, ...node.instanceColor.array])
        }
        triangles +=
          ((node.geometry.index?.count ?? node.geometry.attributes.position.count) / 3) * count
        for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
          if (materialRecords.has(material.uuid)) continue
          const textures = []
          for (const [key, value] of Object.entries(material))
            if (value?.isTexture)
              textures.push({
                channel: key,
                uuid: value.uuid,
                source: value.source?.uuid,
                name: value.name,
                size: [value.image?.width ?? null, value.image?.height ?? null],
                colorSpace: value.colorSpace,
                uvChannel: value.channel,
                flipY: value.flipY,
              })
          materialRecords.set(material.uuid, {
            uuid: material.uuid,
            name: material.name,
            type: material.type,
            color: material.color?.toArray(),
            roughness: material.roughness,
            metalness: material.metalness,
            clearcoat: material.clearcoat,
            clearcoatRoughness: material.clearcoatRoughness,
            opacity: material.opacity,
            transparent: material.transparent,
            transmission: material.transmission,
            emissive: material.emissive?.toArray(),
            emissiveIntensity: material.emissiveIntensity,
            envMapIntensity: material.envMapIntensity,
            textures,
          })
        }
      })
      scene.traverse((node) => {
        if (node.isLight)
          lights.push({
            name: node.name,
            type: node.type,
            position: node.position.toArray(),
            quaternion: node.quaternion.toArray(),
            color: node.color.toArray(),
            intensity: node.intensity,
            width: node.width,
            height: node.height,
          })
        if (node.userData.traceExclude) traceExcluded.push({ name: node.name, type: node.type })
      })
      const size = camera.position.clone(),
        drawingBuffer = renderer.getDrawingBufferSize(size),
        device = renderer.backend?.device
      return {
        roots: roots.map((node) => node.userData.workbenchProduct),
        rootUuid: root.uuid,
        source: root.userData.sourceKind,
        adapter: root.userData.adapter,
        bundle: root.userData.assetBundle,
        sourceTriangles: root.userData.triangles,
        semanticParts: parts.length,
        parts,
        meshes,
        instances,
        triangles,
        poses,
        materials: [...materialRecords.values()],
        camera: {
          position: camera.position.toArray(),
          quaternion: camera.quaternion.toArray(),
          fov: camera.fov,
          near: camera.near,
          far: camera.far,
          aspect: camera.aspect,
          zoom: camera.zoom,
          view: camera.view ? { ...camera.view } : null,
          projectionMatrix: camera.projectionMatrix.toArray(),
          viewMatrix: camera.matrixWorldInverse.toArray(),
        },
        motion: Object.fromEntries(
          Object.entries(test.motion.states.value).map(([id, state]) => [
            id,
            { progress: state.progress, target: state.target, playing: state.playing },
          ]),
        ),
        selectedPart: test.store.selectedPart,
        guideStep: test.store.guideStep,
        revision: test.store.revision,
        sameCanvas: document.querySelector('canvas') === test.canvas,
        sameRenderer: renderer === test.renderer,
        renderer: {
          nativeWebGPU: Boolean(
            renderer.isWebGPURenderer && renderer.backend?.isWebGPUBackend && device?.queue,
          ),
          adapterInfo: device?.adapterInfo
            ? {
                vendor: device.adapterInfo.vendor,
                architecture: device.adapterInfo.architecture,
                device: device.adapterInfo.device,
                description: device.adapterInfo.description,
              }
            : null,
          pixelRatio: renderer.getPixelRatio(),
          drawingBuffer: [drawingBuffer.x, drawingBuffer.y],
          memory: { ...renderer.info.memory },
          toneMapping: renderer.toneMapping,
          exposure: renderer.toneMappingExposure,
        },
        stage: {
          environment: scene.environment?.uuid ?? null,
          environmentIntensity: scene.environmentIntensity,
          background: scene.background?.uuid ?? scene.background?.getHexString?.() ?? null,
          traceBackground: scene.userData.traceBackground?.uuid ?? null,
          lights,
          traceExcluded,
        },
      }
    })
  const validate = (snapshot) => {
    expect(snapshot.roots).toEqual(['typewriter-study'])
    expect(snapshot.source).toBe('glb')
    expect(snapshot.adapter).toBe('typewriter-v1')
    expect(snapshot.bundle).toBe(`${metadata.manifest.id}@${metadata.manifest.version}`)
    expect(snapshot.semanticParts).toBe(572)
    expect(snapshot.instances).toBeGreaterThan(0)
    expect(snapshot.triangles).toBe(snapshot.sourceTriangles)
    expect(snapshot.sameCanvas && snapshot.sameRenderer).toBe(true)
    expect(snapshot.renderer.nativeWebGPU).toBe(true)
    expect(Object.values(snapshot.motion).every((state) => !state.playing)).toBe(true)
  }
  const capture = async (name) => {
    failOnErrors()
    await expect(page.locator('canvas')).toHaveCount(1)
    const snapshot = await actual(),
      state = await refinement(),
      png = await page.locator('canvas').screenshot(),
      stats = await sharp(png).stats()
    validate(snapshot)
    expect(Math.max(...stats.channels.slice(0, 3).map((channel) => channel.stdev))).toBeGreaterThan(
      3,
    )
    await writeFile(`${output}/${name}.canvas.png`, png)
    await page.screenshot({ path: `${output}/${name}.png`, fullPage: true })
    await writeFile(
      `${output}/${name}.json`,
      `${JSON.stringify({ ...snapshot, refinement: state }, null, 2)}\n`,
    )
    return {
      snapshot,
      state,
      bytes: png.length,
      channelStdDev: stats.channels.slice(0, 3).map((channel) => channel.stdev),
    }
  }
  const waitRefined = async (view, previousGeneration) => {
    let lastLog = 0
    await expect
      .poll(
        async () => {
          failOnErrors()
          const state = await refinement()
          if (state?.phase === 'error') throw new Error(`Refinement failed: ${state.error}`)
          if (Date.now() - lastLog >= 10000) {
            lastLog = Date.now()
            progress(
              `${view}: wait complete guided output`,
              state
                ? { phase: state.phase, samples: state.samples, generation: state.generation }
                : null,
            )
          }
          return Boolean(
            state?.phase === 'ready' &&
            state.target === 128 &&
            state.samples?.min >= 128 &&
            state.generation > previousGeneration,
          )
        },
        { timeout, intervals: [500, 1000] },
      )
      .toBe(true)
  }
  const imageDifference = async (view) => {
    const decode = (name) =>
        sharp(`${output}/${name}.canvas.png`)
          .removeAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true }),
      [raster, guided] = await Promise.all([decode(`${view}-raster`), decode(`${view}-guided-128`)])
    expect(guided.info).toEqual(raster.info)
    const { width, height, channels } = raster.info
    let squared = 0,
      invertedSquared = 0,
      changed = 0
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const offset = (y * width + x) * channels,
          invertedOffset = ((height - y - 1) * width + x) * channels
        let difference = 0
        for (let channel = 0; channel < channels; channel++) {
          const delta = guided.data[offset + channel] - raster.data[offset + channel],
            invertedDelta = guided.data[offset + channel] - raster.data[invertedOffset + channel]
          squared += delta * delta
          invertedSquared += invertedDelta * invertedDelta
          difference += Math.abs(delta)
        }
        if (difference > 12) changed++
      }
    return {
      width,
      height,
      rms: Math.sqrt(squared / raster.data.length),
      invertedRms: Math.sqrt(invertedSquared / raster.data.length),
      changedFraction: changed / (width * height),
    }
  }

  let rootUuid,
    preparedMemory,
    lastGeneration = -1
  for (const view of views) {
    progress(`${view}: configure actual visitor operations`)
    await page.evaluate(() => {
      window.__hybridVisualExposure.realtime(true)
      window.__demo.store.openPanel(null)
      window.__demo.store.restore()
    })
    // Allow the regular watchers and reset camera tween to settle before issuing
    // a new seek; no test code writes a Three node or a camera transform.
    await page.waitForTimeout(900)
    const expectedProgress = view === 'layers' ? 0.6 : view === 'flat' ? 1 : 0,
      hotspotId = view === 'paint' ? 'part-095' : view === 'metal' ? 'part-046' : null,
      viewId = view === 'layers' ? 'structure' : view === 'flat' ? 'knoll' : 'perspective'
    await page.evaluate(
      ({ actionId, expectedProgress, hotspotId, viewId }) => {
        const store = window.__demo.store
        store.motion('seek', actionId, expectedProgress)
        if (hotspotId) store.focus(hotspotId)
        else store.view(viewId)
      },
      { actionId, expectedProgress, hotspotId, viewId },
    )
    await page.waitForTimeout(900)
    const checkpoint = await page.evaluate(() => window.__hybridVisualExposure.checkpoint())
    if (!checkpoint) throw new Error('Actual camera checkpoint unavailable')
    expect(checkpoint.slug).toBe('typewriter-study')
    if (!hotspotId) {
      const configuredView = presentation.views.find((item) => item.id === viewId)
      near(checkpoint.position, configuredView.position)
      near(checkpoint.target, configuredView.target)
    }
    const raster = await capture(`${view}-raster`)
    expect(raster.state.realtime).toBe(true)
    near(raster.snapshot.camera.position, checkpoint.position)
    expect(checkpoint.revision).toBe(raster.snapshot.revision)
    expect(raster.snapshot.motion[actionId].progress).toBeCloseTo(expectedProgress, 7)
    expect(raster.snapshot.selectedPart).toBe(hotspotId ?? '')
    rootUuid ??= raster.snapshot.rootUuid
    expect(raster.snapshot.rootUuid).toBe(rootUuid)
    if (hotspotId) {
      const expected = await page.evaluate(
        (hotspot) => {
          const scene = window.__demo.scene,
            camera = scene.camera.activeCamera.value,
            root = scene.scene.value.children.find((node) => node.userData.workbenchProduct),
            node = root.getObjectByName(hotspot.node),
            target = camera.position.clone().fromArray(hotspot.anchor ?? [0, 0, 0])
          if (!node) throw new Error(`Actual focus node absent: ${hotspot.node}`)
          node.localToWorld(target)
          return {
            target: target.toArray(),
            position: target
              .clone()
              .add(camera.position.clone().fromArray(hotspot.cameraOffset))
              .toArray(),
          }
        },
        presentation.hotspots.find((item) => item.id === hotspotId),
      )
      near(checkpoint.position, expected.position)
      near(checkpoint.target, expected.target)
    }
    await page.evaluate(() => window.__hybridVisualExposure.realtime(false))
    await waitRefined(view, Math.max(lastGeneration, raster.state.generation))
    const guided = await capture(`${view}-guided-128`)
    preparedMemory ??= { ...guided.snapshot.renderer.memory }
    // Camera, rigid layout and existing highlight uniforms must reuse the
    // compiled guide MRT; each OIDN pass must not add another full shader set.
    for (const counter of ['programs', 'programsSize', 'geometries', 'textures', 'renderTargets'])
      expect(guided.snapshot.renderer.memory[counter], `${view}: reuse warmed ${counter}`).toBe(
        preparedMemory[counter],
      )
    expect(guided.state.realtime).toBe(false)
    expect(guided.state.samples.min).toBeGreaterThanOrEqual(128)
    expect(guided.state.denoiseMs).toBeGreaterThan(0)
    expect(guided.state.firstRasterMs).not.toBeNull()
    expect(guided.snapshot.rootUuid).toBe(rootUuid)
    expect(guided.snapshot.camera).toEqual(raster.snapshot.camera)
    expect(guided.snapshot.poses).toEqual(raster.snapshot.poses)
    expect(guided.snapshot.materials).toEqual(raster.snapshot.materials)
    expect(guided.snapshot.motion).toEqual(raster.snapshot.motion)
    expect(guided.snapshot.stage).toEqual(raster.snapshot.stage)
    const pixels = await imageDifference(view)
    expect(pixels.rms).toBeGreaterThan(0.1)
    expect(pixels.changedFraction).toBeGreaterThan(0.001)
    expect(pixels.rms, `${view}: maintain actual image orientation`).toBeLessThan(
      pixels.invertedRms,
    )
    await page.waitForTimeout(1200)
    failOnErrors()
    const idle = await refinement()
    for (const counter of ['rasterFrames', 'sampleFrames', 'presentations'])
      expect(idle[counter], `${view}: stop ${counter} after complete output`).toBe(
        guided.state[counter],
      )
    lastGeneration = guided.state.generation
    const { poses, parts, materials, ...compact } = guided.snapshot
    report.views.push({
      view,
      viewId,
      hotspotId,
      expectedProgress,
      actualCheckpoint: checkpoint,
      ...compact,
      partDigest: digest(parts),
      poseDigest: digest(poses),
      materialDigest: digest(materials),
      refinement: guided.state,
      idle,
      pixels,
      images: {
        raster: `${view}-raster.canvas.png`,
        guided: `${view}-guided-128.canvas.png`,
        interface: `${view}-guided-128.png`,
      },
      image: { bytes: guided.bytes, channelStdDev: guided.channelStdDev },
    })
    report.checks.push(
      `${view}: actual configured pose/camera, complete guided >=128 spp, stable identity and idle clock`,
    )
    progress(`${view}: captured complete output`, {
      samples: guided.state.samples,
      denoiseMs: guided.state.denoiseMs,
      generation: guided.state.generation,
    })
  }
  const origins = [...new Set(report.requests.map((url) => new URL(url).origin))]
  expect(origins).toEqual([new URL(base).origin])
  expect(report.requests.some((url) => url.includes('/models/denoise/rt_hdr_alb_nrm.tza'))).toBe(
    true,
  )
  failOnErrors()
  report.checks.push(
    `Every HTTP runtime request is same origin; ${views.length} views reuse the real product, Canvas and renderer`,
  )
  report.passed = true
} catch (error) {
  progress('Failed', error.message)
  report.failure = error.stack || String(error)
  if (page) await page.screenshot({ path: `${output}/failure.png`, fullPage: true }).catch(() => {})
} finally {
  await browser?.close()
  await writeFile(`${output}/report.json`, `${JSON.stringify(report, null, 2)}\n`)
}
console.log(
  JSON.stringify(
    { passed: report.passed, views: report.views.length, output, failure: report.failure },
    null,
    2,
  ),
)
if (!report.passed) process.exitCode = 1
