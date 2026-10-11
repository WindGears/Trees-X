import { ACESFilmicToneMapping, SRGBColorSpace, Vector2, WebGLRenderer } from 'three'
import { RectAreaLightNode, WebGPURenderer } from 'three/webgpu'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { RectAreaLightTexturesLib } from 'three/addons/lights/RectAreaLightTexturesLib.js'
import type { SampleCounts, WebGPUPathTracer } from 'three-gpu-pathtracer/webgpu'
import { labSettings, type LabMode, type LabPhase, type LabRequest } from './settings'
import type { LabScene } from './scene'

interface ActualDevice {
  queue: { onSubmittedWorkDone(): Promise<void> }
  adapterInfo?: { vendor?: string; architecture?: string; device?: string; description?: string }
  lost: Promise<{ message: string }>
}

export async function createLabRenderer(mode: LabMode, canvas: HTMLCanvasElement) {
  let renderer: WebGLRenderer | WebGPURenderer, device: ActualDevice | undefined
  const backend: Record<string, unknown> = {}
  if (mode === 'webgl') {
    renderer = new WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      preserveDrawingBuffer: true,
    })
    const gl = renderer.getContext(),
      debug = gl.getExtension('WEBGL_debug_renderer_info')
    if (!(gl instanceof WebGL2RenderingContext)) {
      renderer.dispose()
      throw new Error('没有真实 WebGL2 上下文')
    }
    Object.assign(backend, {
      actual: 'webgl2',
      gpu: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : null,
      version: gl.getParameter(gl.VERSION),
    })
  } else {
    renderer = new WebGPURenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    })
    try {
      await renderer.init()
      const actual = renderer.backend
      if (!('isWebGPUBackend' in actual) || actual.isWebGPUBackend !== true)
        throw new Error('WebGPU 不可用，拒绝把 WebGL fallback 标为 WebGPU')
      if (!('device' in actual) || !actual.device) throw new Error('真实 GPUDevice 未创建')
      device = actual.device as ActualDevice
      if (typeof device.queue?.onSubmittedWorkDone !== 'function')
        throw new Error('真实 WebGPU queue 不可用')
      Object.assign(backend, {
        actual: 'webgpu',
        device: Object.prototype.toString.call(actual.device),
        adapter: device.adapterInfo ? { ...device.adapterInfo } : null,
        canvasContext: Object.prototype.toString.call(renderer.getContext()),
        fallback: false,
      })
    } catch (error) {
      renderer.dispose()
      throw error
    }
  }
  renderer.toneMapping = ACESFilmicToneMapping
  renderer.toneMappingExposure = labSettings.exposure
  renderer.outputColorSpace = SRGBColorSpace
  renderer.setPixelRatio(labSettings.dpr)
  renderer.setSize(innerWidth, innerHeight, false)
  return { renderer, backend, device }
}

export type LabRenderer = Awaited<ReturnType<typeof createLabRenderer>>

export async function runLabRenderer(
  driver: LabRenderer,
  shared: LabScene,
  request: LabRequest,
  status: (phase: LabPhase, text: string) => void,
) {
  const { renderer, device } = driver
  let tracer: WebGPUPathTracer | undefined,
    disposed = false,
    raf = 0,
    renderCalls = 0,
    lastMeasurement = 0,
    counts: SampleCounts | null = null
  let checkpointing = false,
    inFlight: Promise<void> | undefined,
    controls: OrbitControls | undefined,
    rasterPending: Promise<void> | undefined,
    rasterError: unknown,
    rasterDirty = false,
    presentationCalls = 0
  const started = performance.now()
  const finishSubmission = async () => device?.queue.onSubmittedWorkDone()
  const stop = () => {
    cancelAnimationFrame(raf)
    raf = 0
    if (tracer) tracer.pause = true
  }
  const visibility = () => {
    if (document.visibilityState === 'hidden' && raf) {
      stop()
      status('paused', '页面隐藏，采样暂停；重新加载可开始新的静止比较。')
    }
    if (request.mode !== 'pathtrace' && document.visibilityState === 'visible') invalidateRaster()
  }
  const size = new Vector2()
  const snapshot = () => {
    renderer.getDrawingBufferSize(size)
    return {
      backend: driver.backend,
      rendererCount: 1,
      canvasCount: document.querySelectorAll('canvas').length,
      drawingBuffer: [size.x, size.y],
      dpr: renderer.getPixelRatio(),
      renderCalls,
      presentationCalls,
      controls: controls ? 'OrbitControls, demand rendering' : 'disabled; static accumulation',
      elapsedMs: performance.now() - started,
      samples: counts ? { ...counts } : null,
      requestedSamples: request.mode === 'pathtrace' ? request.samples : null,
      memory: { ...renderer.info.memory },
      pathtrace:
        request.mode === 'pathtrace'
          ? { ...labSettings.pathtrace, maxSamples: request.samples }
          : null,
    }
  }
  async function rasterFrame() {
    while (rasterDirty && !disposed && document.visibilityState === 'visible') {
      rasterDirty = false
      renderer.render(shared.scene, shared.camera)
      renderCalls++
      await finishSubmission()
    }
  }
  function invalidateRaster() {
    rasterDirty = true
    if (disposed || rasterPending || document.visibilityState === 'hidden') return
    rasterPending = rasterFrame()
      .catch((error: unknown) => {
        rasterError = error
        if (!disposed) status('error', error instanceof Error ? error.message : String(error))
      })
      .finally(() => {
        rasterPending = undefined
        if (rasterDirty && !disposed && document.visibilityState === 'visible') invalidateRaster()
      })
  }
  function changed() {
    if (controls) shared.target.copy(controls.target)
    invalidateRaster()
  }
  function resize() {
    if (request.mode === 'pathtrace' || disposed) return
    renderer.setSize(innerWidth, innerHeight, false)
    shared.camera.aspect = innerWidth / innerHeight
    shared.camera.setViewOffset(
      innerWidth,
      innerHeight,
      labSettings.viewOffset.x,
      labSettings.viewOffset.y,
      innerWidth,
      innerHeight,
    )
    shared.camera.updateProjectionMatrix()
    invalidateRaster()
  }
  function canvasPixels() {
    // Copy the current swapchain synchronously in the render task. Awaiting a queue or
    // createImageBitmap first allows the browser to present and clear this texture.
    const copy = document.createElement('canvas')
    copy.width = renderer.domElement.width
    copy.height = renderer.domElement.height
    const context = copy.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('无法读取实际渲染位图')
    context.drawImage(renderer.domElement, 0, 0)
    const data = context.getImageData(0, 0, copy.width, copy.height).data,
      levels = new Set<number>()
    let opaque = 0,
      minimum = 255,
      maximum = 0
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3]! > 0) opaque++
      const value = Math.round((data[i]! + data[i + 1]! + data[i + 2]!) / 3)
      levels.add(value)
      minimum = Math.min(minimum, value)
      maximum = Math.max(maximum, value)
    }
    const pixels = {
      width: copy.width,
      height: copy.height,
      total: data.length / 4,
      opaque,
      levels: levels.size,
      minimum,
      maximum,
    }
    if (opaque < pixels.total * 0.95 || levels.size < 32 || maximum - minimum < 40)
      throw new Error(
        '导出没有足够的真实非均匀像素，拒绝空白 swapchain PNG：' + JSON.stringify(pixels),
      )
    return { png: copy.toDataURL('image/png'), pixels }
  }
  function presentAndCapture() {
    return new Promise<ReturnType<typeof canvasPixels>>((resolve, reject) => {
      requestAnimationFrame(() => {
        if (disposed) {
          reject(new Error('场景已经释放'))
          return
        }
        try {
          if (tracer) tracer.renderSample()
          else renderer.render(shared.scene, shared.camera)
          presentationCalls++
          const capture = canvasPixels()
          void finishSubmission().then(() => resolve(capture), reject)
        } catch (error) {
          reject(error)
        }
      })
    })
  }
  const scheduleFrame = () => {
    if (disposed || checkpointing || !tracer || tracer.pause) return
    raf = requestAnimationFrame(() => {
      raf = 0
      inFlight = frame()
    })
  }
  async function frame() {
    if (disposed || checkpointing || !tracer || document.visibilityState === 'hidden') return
    try {
      tracer.renderSample()
      renderCalls++
      await finishSubmission()
      if (disposed) return
      const now = performance.now()
      if (now - lastMeasurement > 1000) {
        lastMeasurement = now
        counts = await tracer.getSampleCountsAsync()
        if (disposed) return
        if (counts.min >= request.samples) {
          stop()
          status(
            'ready',
            `静止采样完成：最低 ${counts.min} / 平均 ${counts.avg.toFixed(1)} spp；未降噪。`,
          )
          return
        }
        status('rendering', `静止采样中：最低 ${counts.min} / 平均 ${counts.avg.toFixed(1)} spp。`)
      }
      scheduleFrame()
    } catch (error) {
      stop()
      if (!disposed) status('error', error instanceof Error ? error.message : String(error))
    }
  }
  try {
    if (renderer instanceof WebGPURenderer) {
      // createStudioLights already acquires and initializes this exact shared LTC
      // library. Its scene owner releases textures after the renderer has stopped.
      // r185 returns the class itself from init(); @types describes its texture
      // fields as instance members. Validate those actual shared fields explicitly.
      const library = RectAreaLightTexturesLib as unknown as Parameters<
        typeof RectAreaLightNode.setLTC
      >[0]
      if (!library.LTC_FLOAT_1?.isTexture || !library.LTC_HALF_1?.isTexture)
        throw new Error('共同 LTC 纹理库尚未初始化')
      RectAreaLightNode.setLTC(library)
    }
    if (request.mode === 'pathtrace') {
      if (!(renderer instanceof WebGPURenderer)) throw new Error('路径追踪必须使用真实 WebGPU')
      const { WebGPUPathTracer: Tracer } = await import('three-gpu-pathtracer/webgpu')
      tracer = new Tracer(renderer)
      Object.assign(tracer, {
        maxBounces: labSettings.pathtrace.maxBounces,
        maxTransparentBounces: labSettings.pathtrace.maxTransparentBounces,
        frameBudget: labSettings.pathtrace.frameBudget,
        renderScale: 1,
        dynamicLowRes: false,
        filterGlossyFactor: 0,
        stableNoise: true,
        multipleImportanceSampling: true,
        generateMissingAttributes: labSettings.pathtrace.generateMissingAttributes,
        clampDirect: labSettings.pathtrace.clampDirect,
        clampIndirect: labSettings.pathtrace.clampIndirect,
        maxSamples: request.samples,
      })
      tracer.setScene(shared.scene, shared.camera)
      status('rendering', '构建完成，正在累积真实 WebGPU 路径样本。')
      scheduleFrame()
    } else {
      await renderer.compileAsync(shared.scene, shared.camera)
      controls = new OrbitControls(shared.camera, renderer.domElement)
      controls.target.copy(shared.target)
      controls.enableDamping = false
      controls.enablePan = true
      controls.update()
      controls.addEventListener('change', changed)
      invalidateRaster()
      await rasterPending
      if (rasterError) throw rasterError
      status('ready', `${driver.backend.actual} 实际首帧完成；共用 PBR 输入。`)
    }
    document.addEventListener('visibilitychange', visibility)
    window.addEventListener('resize', resize)
    return {
      snapshot,
      async png() {
        if (disposed) throw new Error('场景已经释放')
        if (tracer) {
          tracer.pause = true
        } else {
          await rasterPending
          if (rasterError) throw rasterError
        }
        return presentAndCapture()
      },
      async checkpoint(minimum: number) {
        if (!tracer || disposed || checkpointing) throw new Error('路径采样检查点不可用')
        checkpointing = true
        cancelAnimationFrame(raf)
        raf = 0
        try {
          await inFlight
          await finishSubmission()
          counts = await tracer.getSampleCountsAsync()
          if (disposed || counts.min < minimum) throw new Error('尚未达到检查点最低样本数')
          const wasPaused = tracer.pause
          tracer.pause = true
          try {
            const capture = await presentAndCapture()
            return { snapshot: snapshot(), ...capture }
          } finally {
            tracer.pause = wasPaused
          }
        } finally {
          checkpointing = false
          scheduleFrame()
        }
      },
      dispose() {
        if (disposed) return
        disposed = true
        stop()
        document.removeEventListener('visibilitychange', visibility)
        window.removeEventListener('resize', resize)
        controls?.removeEventListener('change', changed)
        controls?.dispose()
        tracer?.dispose()
      },
    }
  } catch (error) {
    stop()
    controls?.removeEventListener('change', changed)
    controls?.dispose()
    tracer?.dispose()
    throw error
  }
}

export type LabRun = Awaited<ReturnType<typeof runLabRenderer>>
