import {
  BufferAttribute,
  BufferGeometry,
  HalfFloatType,
  InstancedMesh,
  Light,
  Material,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NearestFilter,
  NoToneMapping,
  Scene,
  UnsignedByteType,
  Vector2,
  Texture,
  type Object3D,
} from 'three'
import { MeshBasicNodeMaterial, QuadMesh, RenderTarget, type WebGPURenderer } from 'three/webgpu'
import { diffuseColor, mix, mrt, normalView, texture, uniform, vec4 } from 'three/tsl'
import type {
  DenoisingDriver,
  HybridCoordinatorOptions,
  HybridSnapshot,
  RefinementChange,
  RefinementPhase,
  RefinementStatus,
  TracingDriver,
  TracingScene,
} from './refinementTypes'

const WEIGHTS_BYTES = 1841160
const WEIGHTS_SHA = 'e586ef2ff48d7fbb7611986405220ed8fc5c13ca79bfc40be4dc742fbf959e1a'
const WEIGHTS_URL = '/models/denoise/rt_hdr_alb_nrm.tza'
const DENOISE_TIMEOUT_MS = 180000

/** Derived scene owns its attribute/BVH buffers, never loader geometry or maps. */
export function createTracingScene(source: Scene): TracingScene {
  const geometries = new Map<BufferGeometry, BufferGeometry>(),
    replacementMaterials = new Map<Material, MeshStandardMaterial>(),
    pairs: { original: Object3D; copy: Object3D }[] = [],
    instanceMeshes: InstancedMesh[] = []
  let disposed = false
  function geometry(original: BufferGeometry) {
    let copy = geometries.get(original)
    if (copy) return copy
    copy = original.clone()
    geometries.set(original, copy)
    const position = copy.getAttribute('position'),
      uv = copy.getAttribute('uv')
    if (!position || position.itemSize !== 3) throw new Error('追踪几何缺少三维位置')
    if (uv && (uv.itemSize !== 2 || uv.count !== position.count))
      throw new Error('追踪几何 UV 不完整')
    if (!copy.index) {
      const indices =
        position.count > 65535 ? new Uint32Array(position.count) : new Uint16Array(position.count)
      for (let i = 0; i < indices.length; i++) indices[i] = i
      copy.setIndex(new BufferAttribute(indices, 1))
    }
    if (!copy.getAttribute('normal')) copy.computeVertexNormals()
    if (!copy.getAttribute('tangent')) {
      if (uv) copy.computeTangents()
      else
        copy.setAttribute('tangent', new BufferAttribute(new Float32Array(position.count * 4), 4))
    }
    return copy
  }
  function material(original: Material): Material {
    if (!(original instanceof MeshBasicMaterial)) return original
    let copy = replacementMaterials.get(original)
    if (!copy) {
      copy = new MeshStandardMaterial({
        name: original.name,
        color: original.color,
        map: original.map,
        transparent: original.transparent,
        opacity: original.opacity,
        alphaTest: original.alphaTest,
        side: original.side,
        depthWrite: original.depthWrite,
        roughness: 0.72,
      })
      replacementMaterials.set(original, copy)
    }
    return copy
  }
  function clone(original: Object3D): Object3D | null {
    if (original.userData.traceExclude === true) return null
    const copy = original.clone(false)
    pairs.push({ original, copy })
    if (original instanceof Mesh && copy instanceof Mesh) {
      copy.geometry = geometry(original.geometry)
      const tracingMaterial = original.userData.traceMaterial as unknown
      copy.material =
        tracingMaterial instanceof Material
          ? tracingMaterial
          : Array.isArray(original.material)
            ? original.material.map(material)
            : material(original.material)
    }
    if (copy instanceof InstancedMesh) instanceMeshes.push(copy)
    for (const child of original.children) {
      const cloned = clone(child)
      if (cloned) copy.add(cloned)
    }
    return copy
  }
  function dispose() {
    if (disposed) return
    disposed = true
    instanceMeshes.forEach((mesh) => mesh.dispose())
    geometries.forEach((item) => item.dispose())
    replacementMaterials.forEach((item) => item.dispose())
    pairs.length = 0
    geometries.clear()
    replacementMaterials.clear()
  }
  try {
    const scene = clone(source)
    if (!(scene instanceof Scene)) throw new Error('追踪场景无法创建')
    return {
      scene,
      sync() {
        if (disposed) return
        for (const { original, copy } of pairs) {
          copy.position.copy(original.position)
          copy.quaternion.copy(original.quaternion)
          copy.scale.copy(original.scale)
          copy.matrix.copy(original.matrix)
          copy.matrixAutoUpdate = original.matrixAutoUpdate
          copy.visible = original.visible
          if (original instanceof Light && copy instanceof Light) {
            copy.color.copy(original.color)
            copy.intensity = original.intensity
          }
          if (original instanceof InstancedMesh && copy instanceof InstancedMesh) {
            copy.instanceMatrix.array.set(original.instanceMatrix.array)
            copy.instanceMatrix.needsUpdate = true
            if (original.instanceColor && copy.instanceColor) {
              copy.instanceColor.array.set(original.instanceColor.array)
              copy.instanceColor.needsUpdate = true
            }
          }
        }
        for (const [original, copy] of replacementMaterials) {
          if (original instanceof MeshBasicMaterial) {
            copy.color.copy(original.color)
            copy.map = original.map
            copy.opacity = original.opacity
          }
        }
        scene.environment = source.environment
        scene.environmentIntensity = source.environmentIntensity
        scene.environmentRotation.copy(source.environmentRotation)
        const background = source.userData.traceBackground as unknown
        scene.background = background instanceof Texture ? background : source.background
        scene.backgroundIntensity = source.backgroundIntensity
        scene.backgroundBlurriness = source.backgroundBlurriness
        scene.backgroundRotation.copy(source.backgroundRotation)
        scene.updateMatrixWorld(true)
      },
      dispose() {
        dispose()
        scene.clear()
      },
    }
  } catch (error) {
    dispose()
    throw error
  }
}

interface ScreenMaterial extends MeshBasicNodeMaterial {
  texture: Texture | null
  fromTexture: Texture | null
}
interface Network {
  tileExecute(inputs: Record<string, unknown>): () => void
  dispose(): void
}
interface TracingRuntime {
  WebGPUPathTracer: new (renderer: WebGPURenderer) => TracingDriver
  OIDNDenoiser: new (options: {
    initUNetFromURL: (url: string, backend: unknown, options: unknown) => Promise<Network>
    auxWeightsUrl: string
    useAuxiliaryBuffers: boolean
    maxTileSize: number
  }) => DenoisingDriver
  RenderToScreenNodeMaterial: new () => ScreenMaterial
}

/** All rendering uses the injected Tres renderer; no second canvas or clock. */
export function createHybridCoordinator(options: HybridCoordinatorOptions) {
  const { renderer, scene, camera } = options,
    drawingSize = new Vector2(),
    blend = uniform(0),
    rasterTarget = new RenderTarget(1, 1, { type: HalfFloatType, samples: 4 }),
    tracedTarget = new RenderTarget(1, 1, { type: HalfFloatType }),
    guideTarget = new RenderTarget(1, 1, {
      count: 2,
      type: UnsignedByteType,
      minFilter: NearestFilter,
      magFilter: NearestFilter,
    }),
    guideMRT = mrt({ output: diffuseColor, normal: vec4(normalView.mul(0.5).add(0.5), 1) }),
    material = new MeshBasicNodeMaterial(),
    quad = new QuadMesh(material)
  guideTarget.textures[0]!.name = 'output'
  guideTarget.textures[1]!.name = 'normal'
  material.colorNode = vec4(
    mix(texture(rasterTarget.texture), texture(tracedTarget.texture), blend).rgb,
    1,
  )
  const changes = new Set<RefinementChange>(['all'])
  let started = performance.now()
  let tracer: TracingDriver | null = null,
    denoiser: DenoisingDriver | null = null,
    tracing: TracingScene | null = null,
    copyMaterial: ScreenMaterial | null = null,
    copyQuad: QuadMesh | null = null,
    library: TracingRuntime | null = null,
    loading: Promise<void> | null = null,
    loadAbort = new AbortController(),
    network: Network | null = null,
    timer: ReturnType<typeof setTimeout> | null = null,
    active = true,
    interacting = false,
    disposed = false,
    suspendedReady = false,
    frameRequested = false,
    rasterDirty = true,
    samplePending = false,
    lastSampleRead = -Infinity,
    lastReport = -Infinity,
    blendStart = 0,
    denoiseStart = 0,
    denoiseAttempt = -1,
    denoiserFailed = false,
    rasterFrames = 0,
    sampleFrames = 0,
    sampleReads = 0,
    presentations = 0,
    tracingMeshes = 0,
    firstRasterMs: number | null = null,
    firstRefinedMs: number | null = null,
    denoiseMs: number | null = null
  const state: RefinementStatus = {
    phase: 'raster',
    slug: null,
    revision: 0,
    generation: 0,
    samples: null,
    target: 128,
    realtime: false,
    error: null,
  }
  function current(token: number) {
    return !disposed && token === state.generation
  }
  function publish(force = false) {
    if (disposed && !force) return
    const now = performance.now()
    if (!force && now - lastReport < 1000 / 15) return
    lastReport = now
    options.report({ ...state, samples: state.samples ? { ...state.samples } : null })
  }
  function phase(value: RefinementPhase) {
    const changed = state.phase !== value
    state.phase = value
    publish(changed)
  }
  function stopTimer() {
    if (timer) clearTimeout(timer)
    timer = null
  }
  function requestFrame() {
    if (disposed || !active || frameRequested) return
    frameRequested = true
    // Tres invalidate is ignored while the current frame is still pending.
    // Notify the completed canvas presentation first, then request the next one.
    queueMicrotask(() => {
      frameRequested = false
      if (!disposed && active) options.invalidate()
    })
  }
  function stopDenoise() {
    denoiser?.reset()
    denoiseAttempt = -1
  }
  function fail(error: unknown, token = state.generation) {
    if (!current(token)) return
    denoiserFailed ||= state.phase === 'denoising'
    stopTimer()
    if (tracer) tracer.pause = true
    stopDenoise()
    blend.value = 0
    state.error = error instanceof Error ? error.message : String(error)
    phase('error')
    requestFrame()
  }
  function dimensions() {
    renderer.getDrawingBufferSize(drawingSize)
    const width = Math.max(1, Math.floor(drawingSize.x)),
      height = Math.max(1, Math.floor(drawingSize.y))
    if (width === rasterTarget.width && height === rasterTarget.height) return
    rasterTarget.setSize(width, height)
    tracedTarget.setSize(width, height)
    guideTarget.setSize(width, height)
    if (tracer) tracer.reset()
    state.samples = null
    blend.value = 0
  }
  function targetRender(target: RenderTarget, render: () => void) {
    const previousTarget = renderer.getRenderTarget(),
      previousMRT = renderer.getMRT(),
      previousToneMapping = renderer.toneMapping
    try {
      renderer.setMRT(null)
      renderer.setRenderTarget(target)
      renderer.toneMapping = NoToneMapping
      render()
    } finally {
      renderer.setMRT(previousMRT)
      renderer.setRenderTarget(previousTarget)
      renderer.toneMapping = previousToneMapping
    }
  }
  function presentRaster() {
    options.beforeRaster()
    dimensions()
    targetRender(rasterTarget, () => renderer.render(scene, camera))
    rasterFrames++
    rasterDirty = false
  }
  function present() {
    quad.render(renderer)
    presentations++
  }
  function clearTracing() {
    loadAbort.abort()
    loadAbort = new AbortController()
    // The adapter owns networks. OIDNDenoiser owns only its own targets/output.
    denoiser?.dispose()
    denoiser = null
    network?.dispose()
    network = null
    tracer?.dispose()
    tracer = null
    tracing?.dispose()
    tracing = null
    copyMaterial?.dispose()
    copyMaterial = null
    copyQuad = null
    tracingMeshes = 0
    changes.clear()
    changes.add('all')
    denoiseAttempt = -1
    denoiserFailed = false
  }
  async function prepare(token: number) {
    try {
      if (!library)
        library = (await import('three-gpu-pathtracer/webgpu')) as unknown as TracingRuntime
      if (!current(token) || !active || state.realtime) return
      if (!tracing) {
        const prepared = await (options.prepareTracing?.(scene) ?? createTracingScene(scene))
        if (!current(token) || !active || state.realtime) {
          prepared.dispose()
          return
        }
        tracing = prepared
        tracing.sync()
        tracing.scene.traverse((object) => {
          if (object instanceof Mesh) tracingMeshes++
        })
        tracer = new library.WebGPUPathTracer(renderer)
        Object.assign(tracer, {
          maxBounces: 12,
          maxTransparentBounces: 12,
          maxSamples: state.target,
          minSamples: 0,
          frameBudget: 1000000,
          renderScale: 1,
          dynamicLowRes: false,
          renderDelay: 0,
          fadeDuration: 0,
          stableNoise: true,
          multipleImportanceSampling: true,
          generateMissingAttributes: false,
          clampDirect: 0,
          clampIndirect: 0,
        })
        tracer.setScene(tracing.scene, camera)
        copyMaterial = new library.RenderToScreenNodeMaterial()
        copyQuad = new QuadMesh(copyMaterial)
        // The library's screen material expects legacy FullScreenQuad UVs:
        // top.y=1; QuadMesh has top.y=0. Restore that convention for this
        // top-down storage/external texture copy only, never for raster MRTs.
        copyQuad.scale.y = -1
        changes.clear()
      } else if (tracer) {
        tracing.sync()
        if (changes.has('all')) tracer.setScene(tracing.scene, camera)
        else {
          if (changes.has('pose') || changes.has('materials')) tracer.updateTransforms()
          if (changes.has('materials')) tracer.updateMaterials()
          if (changes.has('camera') || changes.has('size')) tracer.updateCamera()
          if (changes.has('lights')) tracer.updateLights()
          if (changes.has('environment')) tracer.updateEnvironment()
        }
        changes.clear()
      }
      if (!current(token) || !tracer) return
      tracer.maxSamples = state.target
      tracer.pause = false
      if (state.target === 1024 && state.samples && tracer.target && copyMaterial && copyQuad) {
        // tracedTarget may still contain the previous OIDN image. Show the
        // actual retained accumulation before the first resumed sample draws.
        copyMaterial.texture = tracer.target
        copyMaterial.fromTexture = tracer.target
        targetRender(tracedTarget, () => copyQuad!.render(renderer))
        blend.value = 1
      }
      phase('sampling')
      requestFrame()
    } catch (error) {
      if (current(token)) {
        clearTracing()
        fail(error, token)
      }
    }
  }
  function wait() {
    stopTimer()
    if (!active || disposed || !state.slug || state.realtime) return
    if (interacting) {
      phase('raster')
      return
    }
    phase('waiting')
    const token = state.generation
    timer = setTimeout(() => {
      timer = null
      if (!current(token) || !active || interacting || state.realtime) return
      phase('preparing')
      const previous = loading
      const pending = (async () => {
        await previous
        if (current(token)) await prepare(token)
      })().finally(() => {
        if (loading === pending) loading = null
      })
      loading = pending
    }, 500)
  }
  async function startDenoise(token: number) {
    if (!tracer?.target || !tracing || !library || denoiseAttempt === token) return
    denoiseAttempt = token
    denoiseStart = performance.now()
    phase('denoising')
    try {
      if (denoiserFailed) {
        denoiser?.dispose()
        network?.dispose()
        denoiser = null
        network = null
        denoiserFailed = false
      }
      if (!denoiser) {
        const { parseTZA, UNet } = await import('oidn-web')
        if (!current(token) || !active) return
        const signal = loadAbort.signal
        denoiser = new library.OIDNDenoiser({
          auxWeightsUrl: WEIGHTS_URL,
          useAuxiliaryBuffers: true,
          maxTileSize: 512,
          async initUNetFromURL(url, backend, settings) {
            // The upstream integration omits response.ok, abort and async tile errors.
            // The thin adapter keeps those failures explicit and network ownership local.
            try {
              if (url !== WEIGHTS_URL) throw new Error('拒绝非登记的降噪权重')
              const response = await fetch(url, { signal })
              if (!response.ok) throw new Error('降噪权重加载失败：' + response.status)
              const bytes = await response.arrayBuffer()
              if (bytes.byteLength !== WEIGHTS_BYTES) throw new Error('降噪权重大小不符')
              const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
                hex = Array.from(digest, (value) => value.toString(16).padStart(2, '0')).join('')
              if (hex !== WEIGHTS_SHA) throw new Error('降噪权重摘要不符')
              signal.throwIfAborted()
              if (!active || interacting) {
                denoiserFailed = true
                throw new DOMException('Paused before network upload', 'AbortError')
              }
              const device = (backend as { device: ConstructorParameters<typeof UNet>[1] }).device
              if (!device) throw new Error('降噪必须复用当前 WebGPU device')
              const unet = new UNet(parseTZA(bytes), device, {
                ...(settings as ConstructorParameters<typeof UNet>[2]),
                engine: 'wgsl',
              })
              try {
                await unet.prepare()
              } catch (error) {
                unet.dispose()
                throw error
              }
              if (disposed || signal.aborted || !active || interacting) {
                unet.dispose()
                denoiserFailed = true
                throw new DOMException('Cancelled', 'AbortError')
              }
              let released = false
              const owned: Network = {
                tileExecute(inputs) {
                  const pass = state.generation
                  return unet.tileExecute({
                    ...inputs,
                    error(reason: unknown) {
                      fail(reason, pass)
                    },
                  } as Parameters<typeof unet.tileExecute>[0])
                },
                dispose() {
                  if (!released) {
                    released = true
                    unet.dispose()
                  }
                },
              }
              network = owned
              return owned
            } catch (error) {
              if (!signal.aborted && state.phase === 'denoising') fail(error, state.generation)
              // A cancelled network has no GPU resources and cannot produce a texture.
              return { tileExecute: () => () => {}, dispose() {} }
            }
          },
        })
        denoiser.init(renderer)
      }
      if (!current(token) || !denoiser || !tracer?.target || !tracing) return
      denoiser.setScene(tracing.scene, camera)
      targetRender(guideTarget, () => {
        // RenderContexts includes MRT node identity in its cache key. Reusing
        // this node prevents every new denoise pass retaining another pipeline.
        renderer.setMRT(guideMRT)
        renderer.render(tracing!.scene, camera)
      })
      await denoiser.denoise(tracer.target, guideTarget.textures[0]!, guideTarget.textures[1]!)
      if (current(token) && active && state.phase === 'denoising') requestFrame()
    } catch (error) {
      fail(error, token)
    }
  }
  function beginBlend() {
    blendStart = performance.now()
    blend.value = state.target === 1024 || options.reducedMotion?.() ? 1 : 0
    if (state.target === 128) denoiseMs = blendStart - denoiseStart
    phase('blending')
    requestFrame()
  }
  function measure(token: number) {
    if (!tracer || samplePending || performance.now() - lastSampleRead < 1000) return
    lastSampleRead = performance.now()
    samplePending = true
    sampleReads++
    void tracer
      .getSampleCountsAsync()
      .then((counts) => {
        if (!current(token) || !active || !tracer || state.phase !== 'sampling') return
        state.samples = { min: counts.min, max: counts.max, avg: counts.avg }
        if (counts.min >= state.target) {
          tracer.pause = true
          if (state.target === 1024) beginBlend()
          else void startDenoise(token)
        } else publish()
      })
      .catch((error: unknown) => fail(error, token))
      .finally(() => {
        samplePending = false
      })
  }
  function invalidate(kind: RefinementChange = 'all') {
    if (disposed) return
    state.generation++
    state.samples = null
    state.target = 128
    state.error = null
    changes.add(kind)
    blend.value = 0
    stopDenoise()
    if (tracer) {
      tracer.pause = true
      tracer.reset()
    }
    rasterDirty = true
    if (state.realtime) phase('realtime')
    else if (!active) phase('paused')
    else wait()
    requestFrame()
  }
  return {
    render(notify: () => void) {
      if (disposed || !active) return
      try {
        if (rasterDirty) presentRaster()
        if (state.phase === 'sampling' && tracer) {
          targetRender(tracedTarget, () => tracer!.renderSample())
          // renderSample blits its raw accumulation into the bound target.
          // Only explicit refinement exposes this progressive image; the
          // default 128 pass keeps raster visible until full guided output.
          if (state.target === 1024) blend.value = 1
          sampleFrames++
          measure(state.generation)
          requestFrame()
        } else if (state.phase === 'denoising') {
          if (performance.now() - denoiseStart >= DENOISE_TIMEOUT_MS) {
            loadAbort.abort()
            fail(new Error('精细画面处理超时，请重试或仅实时展示。'))
          } else if (denoiser?.complete && denoiser.texture && copyMaterial && copyQuad) {
            copyMaterial.texture = denoiser.texture
            copyMaterial.fromTexture = denoiser.texture
            targetRender(tracedTarget, () => copyQuad!.render(renderer))
            beginBlend()
          } else requestFrame()
        }
        if (state.phase === 'blending') {
          blend.value =
            state.target === 1024 || options.reducedMotion?.()
              ? 1
              : Math.min(1, (performance.now() - blendStart) / 240)
          if (blend.value >= 1) {
            firstRefinedMs ??= performance.now() - started
            phase('ready')
          } else requestFrame()
        }
        present()
        if (
          firstRasterMs === null &&
          scene.children.some((child) => typeof child.userData.workbenchProduct === 'string')
        )
          firstRasterMs = performance.now() - started
      } catch (error) {
        fail(error)
      } finally {
        notify()
      }
    },
    invalidate,
    ready(slug: string, revision: number) {
      if (disposed) return
      interacting = false
      state.generation++
      stopTimer()
      clearTracing()
      state.slug = slug
      state.revision = revision
      state.target = 128
      state.samples = null
      state.error = null
      blend.value = 0
      rasterDirty = true
      if (state.realtime) phase('realtime')
      else if (!active) phase('paused')
      else wait()
      requestFrame()
    },
    unload() {
      if (disposed) return
      interacting = false
      state.generation++
      stopTimer()
      clearTracing()
      state.slug = null
      state.samples = null
      state.error = null
      state.target = 128
      started = performance.now()
      firstRasterMs = null
      firstRefinedMs = null
      denoiseMs = null
      blend.value = 0
      rasterDirty = true
      phase('raster')
      requestFrame()
    },
    setActive(value: boolean) {
      if (!value) interacting = false
      if (disposed || active === value) return
      if (!value) suspendedReady = state.phase === 'ready' || state.phase === 'blending'
      active = value
      state.generation++
      stopTimer()
      if (!suspendedReady) stopDenoise()
      if (tracer) tracer.pause = true
      if (!value) phase('paused')
      else if (state.realtime) phase('realtime')
      else if (suspendedReady && changes.size === 0) {
        blend.value = 1
        phase('ready')
      } else wait()
      requestFrame()
    },
    setInteracting(value: boolean) {
      if (disposed || (!active && value) || interacting === value) return
      interacting = value
      state.generation++
      stopTimer()
      stopDenoise()
      if (tracer) tracer.pause = true
      blend.value = 0
      if (!active) phase('paused')
      else if (state.realtime) phase('realtime')
      else if (value) phase('raster')
      else wait()
      requestFrame()
    },
    refine() {
      if (disposed || !state.slug) return
      state.generation++
      stopTimer()
      stopDenoise()
      state.realtime = false
      state.target = 1024
      state.error = null
      blend.value = 0
      if (tracer) {
        tracer.maxSamples = 1024
        tracer.pause = true
      }
      if (active) wait()
      else phase('paused')
      requestFrame()
    },
    retry() {
      if (disposed || !state.slug || state.phase !== 'error') return
      state.generation++
      state.error = null
      stopTimer()
      stopDenoise()
      if (loadAbort.signal.aborted) loadAbort = new AbortController()
      if (active) wait()
      else phase('paused')
      requestFrame()
    },
    setRealtime(value: boolean) {
      if (disposed || state.realtime === value) return
      state.realtime = value
      state.error = null
      state.generation++
      stopTimer()
      stopDenoise()
      if (tracer) tracer.pause = true
      blend.value = 0
      if (value) phase('realtime')
      else if (active) wait()
      else phase('paused')
      requestFrame()
    },
    snapshot(): HybridSnapshot {
      return {
        ...state,
        samples: state.samples ? { ...state.samples } : null,
        rasterFrames,
        sampleFrames,
        presentations,
        sampleReads,
        tracingMeshes,
        firstRasterMs,
        firstRefinedMs,
        denoiseMs,
        active,
        interacting,
        disposed,
      }
    },
    dispose() {
      if (disposed) return
      disposed = true
      state.generation++
      stopTimer()
      clearTracing()
      rasterTarget.dispose()
      tracedTarget.dispose()
      guideTarget.dispose()
      material.dispose()
      // QuadMesh uses a shared library geometry, not coordinator-owned vertices.
    },
  }
}

export type HybridCoordinator = ReturnType<typeof createHybridCoordinator>
