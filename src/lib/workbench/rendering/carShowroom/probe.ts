import {
  CubeCamera,
  DataTexture,
  EquirectangularReflectionMapping,
  FloatType,
  HalfFloatType,
  LinearFilter,
  LinearSRGBColorSpace,
  NoToneMapping,
  RGBAFormat,
  Vector4,
  type Scene,
} from 'three'
import {
  CubeRenderTarget,
  MeshBasicNodeMaterial,
  QuadMesh,
  RendererUtils,
  RenderTarget,
  type WebGPURenderer,
} from 'three/webgpu'
import { context as neutralContext, cubeTexture, equirectDirection } from 'three/tsl'
import type { CarShowroomConfig } from './config'
import { ownEnvironmentPmrem } from '../environmentPMREM'

export interface ColdStudioProbeOptions {
  /** Caller supplies a panels-black, area-light-lit room for indirect-only capture. */
  readonly role?: 'specular' | 'indirect'
}

/** A static room capture. Product/shadow overlays never belong to captureScene. */
export async function createColdStudioProbe(
  renderer: WebGPURenderer,
  captureScene: Scene,
  config: CarShowroomConfig,
  signal?: AbortSignal,
  options: ColdStudioProbeOptions = {},
) {
  signal?.throwIfAborted()
  const role = options.role ?? 'specular',
    size = role === 'indirect' ? 256 : config.capture.size,
    // Three r185 derives PMREM face size from equirect width / 4. Keep 1K faces.
    width = size * 4,
    height = size * 2,
    cube = new CubeRenderTarget(size, { type: HalfFloatType, generateMipmaps: false }),
    target = new RenderTarget(width, height, { type: FloatType, depthBuffer: false }),
    material = new MeshBasicNodeMaterial({ toneMapped: false, depthTest: false, depthWrite: false })
  cube.texture.colorSpace = target.texture.colorSpace = LinearSRGBColorSpace
  material.fragmentNode = cubeTexture(cube.texture, equirectDirection())
  const quad = new QuadMesh(material),
    camera = new CubeCamera(0.05, 80, cube),
    state = RendererUtils.saveRendererState(renderer),
    viewport = renderer.getViewport(new Vector4()),
    scissor = renderer.getScissor(new Vector4()),
    context = renderer.contextNode,
    opaque = renderer.opaque,
    transparent = renderer.transparent,
    depth = renderer.depth,
    stencil = renderer.stencil,
    xr = renderer.xr.enabled,
    shadow = renderer.shadowMap.enabled
  camera.position.fromArray(config.capture.position)
  let restored = false
  const restore = () => {
    if (restored) return
    restored = true
    RendererUtils.restoreRendererState(renderer, state)
    renderer.setViewport(viewport)
    renderer.setScissor(scissor)
    renderer.contextNode = context
    renderer.opaque = opaque
    renderer.transparent = transparent
    renderer.depth = depth
    renderer.stencil = stencil
    renderer.xr.enabled = xr
    renderer.shadowMap.enabled = shadow
  }
  try {
    renderer.toneMapping = NoToneMapping
    renderer.toneMappingExposure = 1
    renderer.outputColorSpace = LinearSRGBColorSpace
    renderer.autoClear = true
    renderer.contextNode = neutralContext({})
    renderer.opaque = renderer.transparent = renderer.depth = true
    renderer.stencil = false
    renderer.xr.enabled = renderer.shadowMap.enabled = false
    renderer.setMRT(null)
    renderer.setScissorTest(false)
    renderer.setRenderObjectFunction(null)
    captureScene.updateMatrixWorld(true)
    camera.update(renderer, captureScene)
    renderer.setRenderTarget(target)
    quad.render(renderer)
    // Never keep a shared renderer in capture state across an async readback.
    restore()
    const pixels = await renderer.readRenderTargetPixelsAsync(target, 0, 0, width, height)
    signal?.throwIfAborted()
    if (!(pixels instanceof Float32Array) || pixels.length !== width * height * 4)
      throw new Error('冷白摄影棚捕获未返回完整线性 HDR 浮点像素')
    const texture = new DataTexture(pixels, width, height, RGBAFormat, FloatType)
    texture.name = `Trees X / cold studio ${role} HDR revision ${config.revision}`
    texture.mapping = EquirectangularReflectionMapping
    texture.colorSpace = LinearSRGBColorSpace
    texture.minFilter = texture.magFilter = LinearFilter
    texture.generateMipmaps = false
    texture.flipY = false
    texture.needsUpdate = true
    try {
      const owner = ownEnvironmentPmrem(renderer, texture)
      return {
        texture,
        snapshot: Object.freeze({
          faces: 6 as const,
          role,
          faceResolution: size,
          width,
          height,
          linearHDR: true as const,
          captureVersion: config.revision,
          cpuBytes: pixels.byteLength,
          // Capture allocations, excluding PMREM's lazily created output/working targets.
          cubeColorBytes: size * size * 6 * 8,
          conversionColorBytes: width * height * 16,
        }),
        dispose: () => owner.dispose(),
      }
    } catch (error) {
      texture.dispose()
      throw error
    }
  } finally {
    restore()
    cube.dispose()
    target.dispose()
    material.dispose()
    // QuadMesh's shared singleton geometry belongs to Three, not this capture.
  }
}
