import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  HalfFloatType,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  Triangle,
  Texture,
  Vector3,
  UnsignedByteType,
} from 'three'
import {
  MathNode,
  MeshBasicNodeMaterial,
  QuadMesh,
  RenderTarget,
  TextureNode,
  UniformNode,
  type WebGPURenderer,
} from 'three/webgpu'
import { mrt } from 'three/tsl'
import { createHybridCoordinator, createTracingScene } from './coordinator'

interface NetworkInitialization {
  initUNetFromURL(
    url: string,
    backend: unknown,
    options: unknown,
  ): Promise<{
    tileExecute(inputs: Record<string, unknown>): () => void
    dispose(): void
  }>
}
const mocks = vi.hoisted(() => ({
  drivers: [] as object[],
  denoisers: [] as object[],
  networks: [] as object[],
  useNetwork: false,
  unetFailure: false,
  buildFailure: false,
}))
vi.mock('oidn-web', () => ({
  parseTZA: vi.fn(() => new Map()),
  UNet: class {
    prepare = vi.fn(async () => {
      if (mocks.unetFailure) throw new Error('UNet compile failure')
    })
    tileExecute = vi.fn(() => () => {})
    dispose = vi.fn()
    constructor() {
      mocks.networks.push(this)
    }
  },
}))
vi.mock('three-gpu-pathtracer/webgpu', () => {
  class Driver {
    target = new Texture()
    pause = false
    maxSamples = 128
    counts = { min: 0, max: 0, avg: 0 }
    read: (() => Promise<{ min: number; max: number; avg: number }>) | null = null
    setScene = vi.fn(() => {
      if (mocks.buildFailure) throw new Error('BVH build failure')
    })
    updateTransforms = vi.fn()
    updateMaterials = vi.fn()
    updateCamera = vi.fn()
    updateLights = vi.fn()
    updateEnvironment = vi.fn()
    reset = vi.fn()
    renderSample = vi.fn()
    dispose = vi.fn()
    constructor() {
      mocks.drivers.push(this)
    }
    getSampleCountsAsync() {
      return this.read?.() ?? Promise.resolve({ ...this.counts })
    }
  }
  class Denoiser {
    texture: Texture | null = null
    complete = false
    running = false
    init = vi.fn()
    setScene = vi.fn()
    denoise = vi.fn(async () => {
      this.running = true
      if (mocks.useNetwork) {
        const network = await this.options.initUNetFromURL(
          '/models/denoise/rt_hdr_alb_nrm.tza',
          { device: { shared: true } },
          { aux: true, hdr: true },
        )
        network.tileExecute({})
      }
    })
    reset = vi.fn(() => {
      this.running = false
      this.complete = false
      this.texture = null
    })
    dispose = vi.fn()
    constructor(private options: NetworkInitialization) {
      mocks.denoisers.push(this)
    }
  }
  return {
    WebGPUPathTracer: Driver,
    OIDNDenoiser: Denoiser,
    RenderToScreenNodeMaterial: class extends MeshBasicNodeMaterial {
      texture = null
      fromTexture = null
    },
  }
})

interface MockDriver {
  target: Texture
  pause: boolean
  maxSamples: number
  minSamples: number
  counts: { min: number; max: number; avg: number }
  read: (() => Promise<{ min: number; max: number; avg: number }>) | null
  reset: ReturnType<typeof vi.fn>
  renderSample: ReturnType<typeof vi.fn>
  dispose: ReturnType<typeof vi.fn>
  setScene: ReturnType<typeof vi.fn>
  updateCamera: ReturnType<typeof vi.fn>
  updateTransforms: ReturnType<typeof vi.fn>
}
interface MockDenoiser {
  texture: Texture | null
  complete: boolean
  reset: ReturnType<typeof vi.fn>
  denoise: ReturnType<typeof vi.fn>
  dispose: ReturnType<typeof vi.fn>
}
function fixture(reducedMotion = false) {
  const scene = new Scene(),
    camera = new PerspectiveCamera(),
    root = new Group(),
    material = new MeshStandardMaterial(),
    geometry = new BoxGeometry()
  root.add(new Mesh(geometry, material))
  root.userData.workbenchProduct = 'typewriter-study'
  scene.add(root)
  let target: RenderTarget | null = null,
    currentMRT: ReturnType<typeof mrt> | null = null
  const copies: { target: RenderTarget | null; texture: Texture | null; from: Texture | null }[] =
    []
  const renderer = {
    toneMapping: 4,
    getRenderTarget: () => target,
    setRenderTarget: vi.fn((value: RenderTarget | null) => {
      target = value
    }),
    getMRT: () => currentMRT,
    setMRT: vi.fn((value: ReturnType<typeof mrt> | null) => {
      currentMRT = value
    }),
    getDrawingBufferSize: (size: Vector3) => size.set(1440, 1000, 0),
    render: vi.fn((node: Scene | QuadMesh) => {
      if (node instanceof QuadMesh && 'texture' in node.material) {
        const material = node.material as MeshBasicNodeMaterial & {
          texture: Texture | null
          fromTexture: Texture | null
        }
        copies.push({ target, texture: material.texture, from: material.fromTexture })
      }
    }),
  }
  const request = vi.fn(),
    before = vi.fn(),
    report = vi.fn(),
    notify = vi.fn()
  const coordinator = createHybridCoordinator({
    renderer: renderer as unknown as WebGPURenderer,
    scene,
    camera,
    invalidate: request,
    beforeRaster: before,
    report,
    reducedMotion: () => reducedMotion,
  })
  return {
    scene,
    root,
    geometry,
    material,
    renderer,
    copies,
    request,
    before,
    report,
    notify,
    coordinator,
  }
}
function driver() {
  return mocks.drivers.at(-1) as MockDriver
}
function denoiser() {
  return mocks.denoisers.at(-1) as MockDenoiser
}
function presentation(item: ReturnType<typeof fixture>) {
  const quad = item.renderer.render.mock.calls
    .map(([node]) => node)
    .filter((node): node is QuadMesh => node instanceof QuadMesh)
    .at(-1)!
  const colorNode = (quad.material as MeshBasicNodeMaterial).colorNode!
  let mixNode: MathNode | undefined
  colorNode.traverse((node) => {
    if (node instanceof MathNode && node.method === MathNode.MIX) mixNode = node
  })
  expect(mixNode).toBeDefined()
  expect(mixNode!.aNode).toBeInstanceOf(TextureNode)
  expect(mixNode!.bNode).toBeInstanceOf(TextureNode)
  expect(mixNode!.cNode).toBeInstanceOf(UniformNode)
  return {
    raster: (mixNode!.aNode as TextureNode).value,
    traced: (mixNode!.bNode as TextureNode).value,
    blend: (mixNode!.cNode as UniformNode<'float', number>).value,
  }
}
async function prepare(item: ReturnType<typeof fixture>) {
  item.coordinator.ready('typewriter-study', 2)
  item.coordinator.render(item.notify)
  await vi.advanceTimersByTimeAsync(500)
  await vi.dynamicImportSettled()
}
async function finish128(item: ReturnType<typeof fixture>) {
  driver().counts = { min: 128, max: 128, avg: 128 }
  item.coordinator.render(item.notify)
  await vi.dynamicImportSettled()
}

describe('derived tracing scene ownership', () => {
  it('prepares shared geometry once without inventing UV or changing loader buffers', () => {
    const scene = new Scene(),
      geometry = new BufferGeometry(),
      material = new MeshStandardMaterial()
    geometry.setAttribute(
      'position',
      new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3),
    )
    const a = new Mesh(geometry, material),
      b = new Mesh(geometry, material)
    scene.add(a, b)
    const sourceDispose = vi.fn(),
      materialDispose = vi.fn()
    geometry.addEventListener('dispose', sourceDispose)
    material.addEventListener('dispose', materialDispose)
    const tracing = createTracingScene(scene),
      cloneA = tracing.scene.children[0] as Mesh,
      cloneB = tracing.scene.children[1] as Mesh,
      derivedDispose = vi.fn()
    cloneA.geometry.addEventListener('dispose', derivedDispose)
    expect(cloneA.geometry).toBe(cloneB.geometry)
    expect(cloneA.geometry).not.toBe(geometry)
    expect(cloneA.geometry.index?.count).toBe(3)
    expect(cloneA.geometry.getAttribute('normal').count).toBe(3)
    expect(cloneA.geometry.getAttribute('tangent').array).toEqual(new Float32Array(12))
    expect(cloneA.geometry.getAttribute('uv')).toBeUndefined()
    expect(geometry.index).toBeNull()
    expect(geometry.getAttribute('normal')).toBeUndefined()
    expect(geometry.getAttribute('tangent')).toBeUndefined()
    tracing.dispose()
    tracing.dispose()
    expect(derivedDispose).toHaveBeenCalledTimes(1)
    expect(sourceDispose).not.toHaveBeenCalled()
    expect(materialDispose).not.toHaveBeenCalled()
  })

  it('filters entire approximate-effect branches and borrows trace materials/background', () => {
    const scene = new Scene(),
      hidden = new Group(),
      source = new Mesh(new BoxGeometry(), new MeshBasicMaterial()),
      traceMaterial = new MeshStandardMaterial(),
      background = new Texture()
    hidden.userData.traceExclude = true
    hidden.add(new Mesh(new BoxGeometry(), new MeshBasicMaterial()))
    source.userData.traceMaterial = traceMaterial
    scene.userData.traceBackground = background
    scene.add(hidden, source)
    const disposal = vi.fn()
    traceMaterial.addEventListener('dispose', disposal)
    background.addEventListener('dispose', disposal)
    const tracing = createTracingScene(scene)
    tracing.sync()
    expect(tracing.scene.children).toHaveLength(1)
    expect((tracing.scene.children[0] as Mesh).material).toBe(traceMaterial)
    expect(tracing.scene.background).toBe(background)
    tracing.dispose()
    expect(disposal).not.toHaveBeenCalled()
  })

  it('keeps actual instance transforms, visibility and highlight colors synchronized', () => {
    const scene = new Scene(),
      mesh = new InstancedMesh(new BoxGeometry(), new MeshStandardMaterial(), 2),
      matrix = new Matrix4(),
      color = new Color()
    mesh.setColorAt(0, new Color(1, 1, 1))
    mesh.setColorAt(1, new Color(1, 1, 1))
    scene.add(mesh)
    const tracing = createTracingScene(scene),
      copy = tracing.scene.children[0] as InstancedMesh
    mesh.setMatrixAt(1, matrix.makeTranslation(2, 3, 4))
    mesh.setColorAt(1, new Color(0.2, 0.4, 0.6))
    mesh.position.set(4, 5, 6)
    mesh.visible = false
    tracing.sync()
    copy.getMatrixAt(1, matrix)
    copy.getColorAt(1, color)
    expect(matrix.elements.slice(12, 15)).toEqual([2, 3, 4])
    expect(color.r).toBeCloseTo(0.2, 6)
    expect(copy.position.toArray()).toEqual([4, 5, 6])
    expect(copy.visible).toBe(false)
    expect(copy.instanceMatrix).not.toBe(mesh.instanceMatrix)
    tracing.dispose()
  })
})

describe('hybrid renderer control and cancellation', () => {
  beforeEach(() => {
    mocks.drivers.length = 0
    mocks.denoisers.length = 0
    mocks.networks.length = 0
    mocks.useNetwork = false
    mocks.unetFailure = false
    mocks.buildFailure = false
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('shows real raster immediately and waits for a full 500ms idle interval', async () => {
    const item = fixture()
    item.coordinator.ready('typewriter-study', 2)
    item.coordinator.render(item.notify)
    expect(item.notify).toHaveBeenCalledTimes(1)
    expect(item.coordinator.snapshot().rasterFrames).toBe(1)
    expect(mocks.drivers).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(499)
    item.coordinator.invalidate('camera')
    await vi.advanceTimersByTimeAsync(499)
    expect(mocks.drivers).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(1)
    await vi.dynamicImportSettled()
    expect(item.coordinator.snapshot().phase).toBe('sampling')
    expect(driver().minSamples).toBe(0)
    item.coordinator.dispose()
  })

  it('reads actual minimum sample counts at most once per second and ignores a late old-product result', async () => {
    const item = fixture()
    await prepare(item)
    let resolve!: (counts: { min: number; max: number; avg: number }) => void
    driver().read = () =>
      new Promise((done) => {
        resolve = done
      })
    for (let i = 0; i < 30; i++) item.coordinator.render(item.notify)
    expect(item.coordinator.snapshot().sampleReads).toBe(1)
    item.coordinator.ready('piano-study', 3)
    resolve({ min: 1024, max: 1024, avg: 1024 })
    await vi.dynamicImportSettled()
    expect(item.coordinator.snapshot()).toMatchObject({
      slug: 'piano-study',
      phase: 'waiting',
      samples: null,
    })
    expect(mocks.denoisers).toHaveLength(0)
    item.coordinator.dispose()
  })

  it('does not show partial denoise tiles and only settles after a complete 240ms blend', async () => {
    const item = fixture()
    await prepare(item)
    expect(presentation(item).blend).toBe(0)
    await finish128(item)
    expect(item.coordinator.snapshot().phase).toBe('denoising')
    expect(presentation(item).blend).toBe(0)
    const filter = denoiser()
    filter.texture = new Texture()
    item.coordinator.render(item.notify)
    expect(item.coordinator.snapshot().phase).toBe('denoising')
    expect(presentation(item).blend).toBe(0)
    expect(item.copies).toEqual([])
    filter.complete = true
    item.coordinator.render(item.notify)
    expect(item.coordinator.snapshot().phase).toBe('blending')
    await vi.advanceTimersByTimeAsync(239)
    item.coordinator.render(item.notify)
    expect(item.coordinator.snapshot().phase).toBe('blending')
    await vi.advanceTimersByTimeAsync(1)
    item.coordinator.render(item.notify)
    expect(item.coordinator.snapshot().phase).toBe('ready')
    expect(presentation(item).blend).toBe(1)
    expect(item.copies.at(-1)!.texture).toBe(filter.texture)
    expect(item.copies.at(-1)!.from).toBe(filter.texture)
    expect(presentation(item).traced).toBe(item.copies.at(-1)!.target!.texture)
    const samples = item.coordinator.snapshot().sampleFrames,
      requested = item.request.mock.calls.length
    item.coordinator.render(item.notify)
    expect(item.coordinator.snapshot().sampleFrames).toBe(samples)
    expect(item.request).toHaveBeenCalledTimes(requested)
    item.coordinator.dispose()
  })

  it.each([false, true])(
    'presents raw continued accumulation without stale OIDN or reset (reduced motion=%s)',
    async (reducedMotion) => {
      const item = fixture(reducedMotion)
      await prepare(item)
      await finish128(item)
      const oldDriver = driver(),
        oldFilter = denoiser()
      const filtered = new Texture()
      oldFilter.texture = filtered
      oldFilter.complete = true
      item.coordinator.render(item.notify)
      await vi.advanceTimersByTimeAsync(240)
      item.coordinator.render(item.notify)
      expect(presentation(item).blend).toBe(1)
      expect(item.copies.at(-1)!.texture).toBe(filtered)
      const accumulationOutput = item.copies.at(-1)!.target!
      oldDriver.reset.mockClear()
      item.coordinator.refine()
      expect(oldFilter.reset).toHaveBeenCalled()
      expect(item.coordinator.snapshot()).toMatchObject({ target: 1024, samples: { min: 128 } })
      item.coordinator.render(item.notify)
      expect(presentation(item).blend).toBe(0)
      await vi.advanceTimersByTimeAsync(500)
      await vi.dynamicImportSettled()
      expect(driver()).toBe(oldDriver)
      expect(oldDriver.reset).not.toHaveBeenCalled()
      expect(oldDriver.maxSamples).toBe(1024)
      expect(item.copies.at(-1)).toEqual({
        target: accumulationOutput,
        texture: oldDriver.target,
        from: oldDriver.target,
      })
      expect(item.copies.at(-1)!.texture).not.toBe(filtered)
      // Emulate the verified upstream renderSample blit: its real raw target is
      // drawn into the renderer target bound by the coordinator, never OIDN.
      const rawMaterial = new MeshBasicNodeMaterial({ map: oldDriver.target }),
        rawQuad = new QuadMesh(rawMaterial)
      oldDriver.renderSample.mockImplementation(() => {
        expect(item.renderer.getRenderTarget()).toBe(accumulationOutput)
        expect(rawMaterial.map).toBe(oldDriver.target)
        rawQuad.render(item.renderer as unknown as WebGPURenderer)
      })
      item.coordinator.render(item.notify)
      expect(presentation(item).blend).toBe(1)
      expect(presentation(item).traced).toBe(accumulationOutput.texture)
      expect(oldDriver.renderSample).toHaveBeenCalled()
      expect(oldFilter.denoise).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(1000)
      oldDriver.counts = { min: 1024, max: 1024, avg: 1024 }
      item.coordinator.render(item.notify)
      await vi.dynamicImportSettled()
      expect(item.coordinator.snapshot().phase).toBe('blending')
      expect(presentation(item).blend).toBe(1)
      item.coordinator.render(item.notify)
      expect(item.coordinator.snapshot().phase).toBe('ready')
      expect(presentation(item).blend).toBe(1)
      expect(oldDriver.pause).toBe(true)
      expect(oldFilter.denoise).toHaveBeenCalledTimes(1)
      const samples = item.coordinator.snapshot().sampleFrames,
        requests = item.request.mock.calls.length
      await vi.advanceTimersByTimeAsync(1200)
      expect(item.coordinator.snapshot().sampleFrames).toBe(samples)
      expect(item.request).toHaveBeenCalledTimes(requests)
      item.coordinator.setInteracting(true)
      item.coordinator.invalidate('camera')
      oldFilter.texture = filtered
      oldFilter.complete = true
      item.coordinator.render(item.notify)
      expect(presentation(item).blend).toBe(0)
      expect(item.coordinator.snapshot()).toMatchObject({
        phase: 'raster',
        target: 128,
        samples: null,
      })
      expect(item.copies.at(-1)!.texture).toBe(oldDriver.target)
      expect(oldFilter.denoise).toHaveBeenCalledTimes(1)
      rawMaterial.dispose()
      item.coordinator.dispose()
    },
  )

  it('cancels preparation that finishes after a product switch and releases only that stale result', async () => {
    const item = fixture(),
      original = createTracingScene(item.scene)
    let resolve!: (value: typeof original) => void
    const dispose = vi.spyOn(original, 'dispose')
    const custom = createHybridCoordinator({
      renderer: item.renderer as unknown as WebGPURenderer,
      scene: item.scene,
      camera: new PerspectiveCamera(),
      invalidate: item.request,
      beforeRaster: item.before,
      report: item.report,
      prepareTracing: () =>
        new Promise((done) => {
          resolve = done
        }),
    })
    custom.ready('old', 1)
    await vi.advanceTimersByTimeAsync(500)
    await vi.dynamicImportSettled()
    custom.ready('new', 2)
    resolve(original)
    await vi.dynamicImportSettled()
    expect(dispose).toHaveBeenCalledTimes(1)
    expect(custom.snapshot().slug).toBe('new')
    expect(mocks.drivers).toHaveLength(0)
    custom.dispose()
    item.coordinator.dispose()
  })

  it('pauses hidden/offscreen work and never presents a completed stale filter after reentry', async () => {
    const item = fixture()
    await prepare(item)
    await finish128(item)
    const filter = denoiser(),
      frames = item.coordinator.snapshot().presentations
    item.coordinator.setActive(false)
    filter.texture = new Texture()
    filter.complete = true
    item.coordinator.render(item.notify)
    await vi.advanceTimersByTimeAsync(3000)
    expect(item.coordinator.snapshot()).toMatchObject({ phase: 'paused', presentations: frames })
    expect(driver().pause).toBe(true)
    item.coordinator.setActive(true)
    expect(item.coordinator.snapshot().phase).toBe('waiting')
    item.coordinator.dispose()
  })

  it('keeps original loader resources alive and cleanup is idempotent after repeated switches', async () => {
    const item = fixture(),
      sourceDisposed = vi.fn()
    item.geometry.addEventListener('dispose', sourceDisposed)
    item.material.addEventListener('dispose', sourceDisposed)
    await prepare(item)
    const oldDriver = driver()
    item.coordinator.unload()
    item.coordinator.dispose()
    item.coordinator.dispose()
    expect(oldDriver.dispose).toHaveBeenCalledTimes(1)
    expect(sourceDisposed).not.toHaveBeenCalled()
    const requests = item.request.mock.calls.length
    item.coordinator.ready('after-dispose', 4)
    item.coordinator.invalidate('pose')
    await vi.advanceTimersByTimeAsync(1000)
    expect(item.request).toHaveBeenCalledTimes(requests)
  })

  it('advances Tres pending frames before scheduling the next sample and reaches zero when ready', async () => {
    const item = fixture()
    let frames = 1
    item.request.mockImplementation(() => {
      if (frames === 0) frames = 1
    })
    item.notify.mockImplementation(() => {
      frames = Math.max(0, frames - 1)
    })
    await prepare(item)
    expect(frames).toBe(1)
    await finish128(item)
    expect(frames).toBe(1)
    denoiser().texture = new Texture()
    denoiser().complete = true
    item.coordinator.render(item.notify)
    await vi.dynamicImportSettled()
    expect(frames).toBe(1)
    await vi.advanceTimersByTimeAsync(240)
    item.coordinator.render(item.notify)
    await vi.dynamicImportSettled()
    expect(item.coordinator.snapshot().phase).toBe('ready')
    expect(frames).toBe(0)
    const calls = item.renderer.render.mock.calls.length
    await vi.advanceTimersByTimeAsync(1000)
    expect(item.renderer.render).toHaveBeenCalledTimes(calls)
    expect(frames).toBe(0)
    item.coordinator.dispose()
  })

  it('preserves a settled image across hiding when the real pose and projection are unchanged', async () => {
    const item = fixture()
    await prepare(item)
    await finish128(item)
    denoiser().texture = new Texture()
    denoiser().complete = true
    item.coordinator.render(item.notify)
    await vi.advanceTimersByTimeAsync(240)
    item.coordinator.render(item.notify)
    const samples = item.coordinator.snapshot().sampleFrames
    item.coordinator.setActive(false)
    item.coordinator.setActive(true)
    expect(item.coordinator.snapshot().phase).toBe('ready')
    await vi.advanceTimersByTimeAsync(1000)
    item.coordinator.render(item.notify)
    expect(item.coordinator.snapshot().sampleFrames).toBe(samples)
    item.coordinator.dispose()
  })

  it('restores renderer target, MRT and tone mapping even when a raster pass throws', () => {
    const item = fixture()
    item.renderer.render.mockImplementationOnce(() => {
      throw new Error('raster failure')
    })
    item.coordinator.ready('typewriter-study', 2)
    item.coordinator.render(item.notify)
    expect(item.renderer.getRenderTarget()).toBeNull()
    expect(item.renderer.toneMapping).toBe(4)
    expect(item.coordinator.snapshot()).toMatchObject({ phase: 'error', error: 'raster failure' })
    expect(item.coordinator.snapshot().firstRasterMs).toBeNull()
    item.coordinator.dispose()
  })

  it('reuses the actual guide MRT through repeated pose and denoise passes and restores borrowed render state', async () => {
    const item = fixture(),
      previousTarget = new RenderTarget(640, 480),
      previousMRT = mrt({})
    await prepare(item)
    item.renderer.setRenderTarget(previousTarget)
    item.renderer.setMRT(previousMRT)
    item.renderer.setMRT.mockClear()
    for (let cycle = 0; cycle < 5; cycle++) {
      if (cycle > 0) {
        item.root.position.x = cycle * 0.25
        item.coordinator.invalidate('pose')
        item.coordinator.render(item.notify)
        await vi.advanceTimersByTimeAsync(1000)
        await vi.dynamicImportSettled()
      }
      await finish128(item)
      expect(item.coordinator.snapshot().phase).toBe('denoising')
      expect(item.renderer.getRenderTarget()).toBe(previousTarget)
      expect(item.renderer.getMRT()).toBe(previousMRT)
      expect(item.renderer.toneMapping).toBe(4)
      denoiser().texture = new Texture()
      denoiser().complete = true
      item.coordinator.render(item.notify)
      await vi.advanceTimersByTimeAsync(240)
      item.coordinator.render(item.notify)
      expect(item.coordinator.snapshot().phase).toBe('ready')
    }
    const guideNodes = item.renderer.setMRT.mock.calls
      .map(([node]) => node)
      .filter((node) => node !== null && node !== previousMRT)
    expect(guideNodes).toHaveLength(5)
    expect(new Set(guideNodes).size).toBe(1)
    expect(Object.keys(guideNodes[0]!.outputNodes)).toEqual(['output', 'normal'])
    expect(guideNodes[0]!.outputNodes.normal).toBe(guideNodes[4]!.outputNodes.normal)
    expect(item.renderer.getRenderTarget()).toBe(previousTarget)
    expect(item.renderer.getMRT()).toBe(previousMRT)
    item.coordinator.dispose()
    previousTarget.dispose()
  })

  it('only marks a successfully presented product frame and resets timing at unload', async () => {
    const item = fixture()
    delete item.root.userData.workbenchProduct
    item.coordinator.render(item.notify)
    expect(item.coordinator.snapshot().firstRasterMs).toBeNull()
    await vi.advanceTimersByTimeAsync(100)
    item.root.userData.workbenchProduct = 'typewriter-study'
    item.coordinator.invalidate('all')
    item.coordinator.render(item.notify)
    expect(item.coordinator.snapshot().firstRasterMs).toBe(100)
    item.coordinator.ready('typewriter-study', 2)
    expect(item.coordinator.snapshot().firstRasterMs).toBe(100)
    item.coordinator.unload()
    expect(item.coordinator.snapshot().firstRasterMs).toBeNull()
    item.coordinator.dispose()
  })

  it('keeps offscreen raster 4x MSAA without multisampling tracing or data guides', async () => {
    const item = fixture()
    await prepare(item)
    await finish128(item)
    const targets = item.renderer.setRenderTarget.mock.calls
      .map(([target]) => target)
      .filter((target) => target !== null)
    const raster = targets.find(
      (target) => target!.texture.type === HalfFloatType && target!.samples === 4,
    )
    const raw = targets.find(
      (target) => target!.texture.type === HalfFloatType && target!.samples === 0,
    )
    const guides = targets.find((target) => target!.textures.length === 2)
    expect(raster).toBeDefined()
    expect(raw).toBeDefined()
    expect(guides!.texture.type).toBe(UnsignedByteType)
    expect(guides!.samples).toBe(0)
    item.coordinator.dispose()
  })

  it('matches the upstream screen material top-down read using real QuadMesh UVs', async () => {
    const item = fixture()
    await prepare(item)
    await finish128(item)
    denoiser().texture = new Texture()
    denoiser().complete = true
    item.coordinator.render(item.notify)
    const quads = item.renderer.render.mock.calls
      .map(([node]) => node)
      .filter((node) => node instanceof QuadMesh) as QuadMesh[]
    const copy = quads.find((quad) => quad.scale.y !== 1)!
    expect(copy).toBeDefined()
    copy.updateMatrixWorld(true)
    const position = copy.geometry.getAttribute('position'),
      uv = copy.geometry.getAttribute('uv')
    const a = new Vector3().fromBufferAttribute(position, 0).applyMatrix4(copy.matrixWorld),
      b = new Vector3().fromBufferAttribute(position, 1).applyMatrix4(copy.matrixWorld),
      c = new Vector3().fromBufferAttribute(position, 2).applyMatrix4(copy.matrixWorld),
      barycentric = Triangle.getBarycoord(new Vector3(0, 0.75, 0), a, b, c, new Vector3())!
    const interpolatedY =
      uv.getY(0) * barycentric.x + uv.getY(1) * barycentric.y + uv.getY(2) * barycentric.z
    // Raw OIDN textures are top-down. A screen point near the top must read a
    // near-top row under the actual library's fixed `1.0 - coord.y` WGSL.
    expect(1 - interpolatedY).toBeCloseTo(0.125, 9)
    const source = readFileSync(
      new URL(
        '../../../../node_modules/three-gpu-pathtracer/src/webgpu/materials/RenderToScreenMaterial.js',
        import.meta.url,
      ),
      'utf8',
    )
    expect(source).toMatch(/vec2f\(\s*coord\.x,\s*1\.0\s*-\s*coord\.y\s*\)/)
    const composite = quads.at(-1)!
    expect(composite.scale.y).toBe(1)
    item.coordinator.dispose()
  })

  it('does not reset accumulation for DOM-only presentation requests', async () => {
    const item = fixture()
    await prepare(item)
    await finish128(item)
    denoiser().texture = new Texture()
    denoiser().complete = true
    item.coordinator.render(item.notify)
    await vi.advanceTimersByTimeAsync(240)
    item.coordinator.render(item.notify)
    const before = item.coordinator.snapshot(),
      resets = driver().reset.mock.calls.length
    for (let i = 0; i < 10; i++) {
      item.scene.userData.domLabel = 'Label ' + i
      item.request()
      item.coordinator.render(item.notify)
    }
    expect(item.coordinator.snapshot()).toMatchObject({
      generation: before.generation,
      samples: before.samples,
      phase: 'ready',
      sampleFrames: before.sampleFrames,
      rasterFrames: before.rasterFrames,
    })
    expect(driver().reset).toHaveBeenCalledTimes(resets)
    item.coordinator.dispose()
  })

  it('cleans failed BVH resources before retrying the same target', async () => {
    const item = fixture()
    mocks.buildFailure = true
    await prepare(item)
    const failed = driver()
    expect(item.coordinator.snapshot()).toMatchObject({
      phase: 'error',
      error: 'BVH build failure',
      tracingMeshes: 0,
      target: 128,
    })
    expect(failed.dispose).toHaveBeenCalledTimes(1)
    mocks.buildFailure = false
    item.coordinator.retry()
    await vi.advanceTimersByTimeAsync(500)
    await vi.dynamicImportSettled()
    expect(driver()).not.toBe(failed)
    expect(item.coordinator.snapshot()).toMatchObject({
      phase: 'sampling',
      target: 128,
      error: null,
    })
    item.coordinator.dispose()
  })

  it('reports weight HTTP failure and can retry without silently upgrading to 1024', async () => {
    const item = fixture()
    mocks.useNetwork = true
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('Missing', { status: 404 })),
    )
    await prepare(item)
    await finish128(item)
    expect(item.coordinator.snapshot()).toMatchObject({
      phase: 'error',
      target: 128,
      error: '降噪权重加载失败：404',
    })
    expect(mocks.networks).toHaveLength(0)
    item.coordinator.retry()
    await vi.advanceTimersByTimeAsync(1000)
    await vi.dynamicImportSettled()
    item.coordinator.render(item.notify)
    await vi.dynamicImportSettled()
    expect(mocks.denoisers).toHaveLength(2)
    expect(item.coordinator.snapshot()).toMatchObject({ phase: 'error', target: 128 })
    item.coordinator.dispose()
  })

  it('releases a partially prepared UNet when compilation rejects', async () => {
    const item = fixture()
    mocks.useNetwork = true
    mocks.unetFailure = true
    const weights = new Uint8Array(
      readFileSync(
        new URL('../../../../public/models/denoise/rt_hdr_alb_nrm.tza', import.meta.url),
      ),
    ).buffer
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(weights)),
    )
    await prepare(item)
    await finish128(item)
    await vi.waitFor(() => expect(item.coordinator.snapshot().phase).toBe('error'))
    expect(item.coordinator.snapshot().error).toBe('UNet compile failure')
    expect(mocks.networks).toHaveLength(1)
    const network = mocks.networks[0] as { dispose: ReturnType<typeof vi.fn> }
    expect(network.dispose).toHaveBeenCalledTimes(1)
    item.coordinator.dispose()
    expect(network.dispose).toHaveBeenCalledTimes(1)
  })

  it('times out an unfinished denoise pass, returns raster and preserves the retry target', async () => {
    const item = fixture()
    await prepare(item)
    await finish128(item)
    await vi.advanceTimersByTimeAsync(180000)
    item.coordinator.render(item.notify)
    expect(item.coordinator.snapshot()).toMatchObject({ phase: 'error', target: 128 })
    expect(item.coordinator.snapshot().error).toContain('超时')
    expect(denoiser().reset).toHaveBeenCalled()
    const samples = item.coordinator.snapshot().sampleFrames
    item.coordinator.render(item.notify)
    expect(item.coordinator.snapshot().sampleFrames).toBe(samples)
    item.coordinator.retry()
    expect(item.coordinator.snapshot()).toMatchObject({
      phase: 'waiting',
      target: 128,
      error: null,
    })
    item.coordinator.dispose()
  })

  it('does not start tracing while the pointer is held still and waits 500ms after release', async () => {
    const item = fixture()
    item.coordinator.ready('typewriter-study', 2)
    item.coordinator.render(item.notify)
    item.coordinator.setInteracting(true)
    await vi.advanceTimersByTimeAsync(3000)
    expect(mocks.drivers).toHaveLength(0)
    expect(item.coordinator.snapshot()).toMatchObject({ phase: 'raster', interacting: true })
    item.coordinator.invalidate('camera')
    await vi.advanceTimersByTimeAsync(1000)
    expect(mocks.drivers).toHaveLength(0)
    item.coordinator.setInteracting(false)
    await vi.advanceTimersByTimeAsync(499)
    expect(mocks.drivers).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(1)
    await vi.dynamicImportSettled()
    expect(item.coordinator.snapshot()).toMatchObject({ phase: 'sampling', interacting: false })
    item.coordinator.dispose()
  })

  it('rejects old completed denoise output immediately when interaction starts', async () => {
    const item = fixture()
    await prepare(item)
    await finish128(item)
    const previous = denoiser()
    item.coordinator.setInteracting(true)
    previous.texture = new Texture()
    previous.complete = true
    item.coordinator.render(item.notify)
    expect(item.coordinator.snapshot()).toMatchObject({ phase: 'raster', interacting: true })
    expect(previous.reset).toHaveBeenCalled()
    item.coordinator.dispose()
  })

  it('does not carry a held drag into the next product when its pointer end never arrives', async () => {
    const item = fixture()
    await prepare(item)
    const previous = driver()
    item.coordinator.setInteracting(true)
    item.coordinator.unload()
    expect(item.coordinator.snapshot()).toMatchObject({ slug: null, interacting: false })
    expect(previous.dispose).toHaveBeenCalledTimes(1)
    item.coordinator.ready('piano-cfx', 3)
    item.coordinator.render(item.notify)
    await vi.advanceTimersByTimeAsync(499)
    expect(mocks.drivers).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    await vi.dynamicImportSettled()
    expect(item.coordinator.snapshot()).toMatchObject({
      slug: 'piano-cfx',
      revision: 3,
      interacting: false,
      phase: 'sampling',
    })
    expect(driver()).not.toBe(previous)
    item.coordinator.dispose()
  })

  it('cancels held input on hide, ignores late starts while hidden and refines only after reentry idle', async () => {
    const item = fixture()
    item.coordinator.ready('typewriter-study', 2)
    item.coordinator.setInteracting(true)
    item.coordinator.setActive(false)
    item.coordinator.setInteracting(true)
    expect(item.coordinator.snapshot()).toMatchObject({ phase: 'paused', interacting: false })
    await vi.advanceTimersByTimeAsync(2000)
    expect(mocks.drivers).toHaveLength(0)
    item.coordinator.setActive(true)
    await vi.advanceTimersByTimeAsync(499)
    expect(mocks.drivers).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(1)
    await vi.dynamicImportSettled()
    expect(item.coordinator.snapshot()).toMatchObject({ phase: 'sampling', interacting: false })
    item.coordinator.dispose()
  })
})
