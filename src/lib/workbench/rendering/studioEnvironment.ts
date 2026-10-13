import {
  Color,
  CubeCamera,
  DataTexture,
  EquirectangularReflectionMapping,
  FloatType,
  HalfFloatType,
  LinearFilter,
  LinearSRGBColorSpace,
  NoToneMapping,
  RGBAFormat,
  Scene,
  Vector4,
} from 'three'
import {
  CubeRenderTarget,
  MeshBasicNodeMaterial,
  QuadMesh,
  RectAreaLightNode,
  RenderTarget,
  RendererUtils,
  type WebGPURenderer,
} from 'three/webgpu'
import { cubeTexture, equirectDirection } from 'three/tsl'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { RectAreaLightTexturesLib } from 'three/addons/lights/RectAreaLightTexturesLib.js'
import { createStudioLights, studioDesign } from '../studio/design'
import { acquireRectAreaUniforms } from '@/lib/three/rectAreaUniforms'
import { createGpuStudioGeometry } from './studioGeometry'
import type { OwnedEnvironment } from './environment'
import { ownEnvironmentPmrem } from './environmentPMREM'

/** All live and capture studios acquire the shared LTC owner before using this bridge. */
export function bindGpuAreaLights() {
  const library = RectAreaLightTexturesLib as unknown as Parameters<
    typeof RectAreaLightNode.setLTC
  >[0]
  if (!library.LTC_FLOAT_1?.isTexture || !library.LTC_HALF_1?.isTexture)
    throw new Error('WebGPU 面光源纹理库尚未初始化')
  RectAreaLightNode.setLTC(library)
}

/** A plain direction gradient for traced camera rays; softboxes are reflection-only. */
export function createStudioSkyTexture() {
  const width = 1024,
    height = 512,
    pixels = new Float32Array(width * height * 4)
  const top = new Color(studioDesign.backdrop.top),
    middle = new Color(studioDesign.backdrop.middle),
    bottom = new Color(studioDesign.backdrop.bottom),
    sample = new Color()
  const smooth = (t: number) => {
    const clamped = Math.min(1, Math.max(0, t / 0.85))
    return clamped * clamped * (3 - 2 * clamped)
  }
  for (let y = 0; y < height; y++) {
    // Data rows are sampled from v=0 (down) to v=1 (up), matching equirectUV.
    const elevation = Math.sin(((y + 0.5) / height - 0.5) * Math.PI)
    sample.copy(middle).lerp(top, smooth(elevation)).lerp(bottom, smooth(-elevation))
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4
      pixels[offset] = sample.r
      pixels[offset + 1] = sample.g
      pixels[offset + 2] = sample.b
      pixels[offset + 3] = 1
    }
  }
  const texture = createEquirect(pixels, width, height)
  texture.name = 'Trees X / seamless traced sky'
  return texture
}

function createEquirect(pixels: Float32Array, width: number, height: number) {
  const texture = new DataTexture(pixels, width, height, RGBAFormat, FloatType)
  texture.mapping = EquirectangularReflectionMapping
  texture.colorSpace = LinearSRGBColorSpace
  texture.minFilter = texture.magFilter = LinearFilter
  texture.generateMipmaps = false
  texture.flipY = false
  texture.needsUpdate = true
  return texture
}

/** Capture with the existing renderer, then own a CPU HDR texture that the tracer can sample. */
async function captureEquirect(
  renderer: WebGPURenderer,
  scene: Scene,
  position: readonly [number, number, number],
  signal?: AbortSignal,
) {
  const cube = new CubeRenderTarget(512, { type: HalfFloatType, generateMipmaps: false }),
    target = new RenderTarget(2048, 1024, { type: FloatType, depthBuffer: false }),
    material = new MeshBasicNodeMaterial({ toneMapped: false, depthTest: false, depthWrite: false })
  material.fragmentNode = cubeTexture(cube.texture, equirectDirection())
  const quad = new QuadMesh(material),
    camera = new CubeCamera(0.05, 60, cube)
  camera.position.fromArray(position)
  const state = RendererUtils.saveRendererState(renderer),
    viewport = renderer.getViewport(new Vector4()),
    scissor = renderer.getScissor(new Vector4()),
    xr = renderer.xr.enabled
  let restored = false
  const restore = () => {
    if (restored) return
    restored = true
    RendererUtils.restoreRendererState(renderer, state)
    renderer.setViewport(viewport)
    renderer.setScissor(scissor)
    renderer.xr.enabled = xr
  }
  try {
    signal?.throwIfAborted()
    renderer.toneMapping = NoToneMapping
    renderer.toneMappingExposure = 1
    renderer.outputColorSpace = LinearSRGBColorSpace
    renderer.autoClear = true
    renderer.xr.enabled = false
    renderer.setMRT(null)
    renderer.setScissorTest(false)
    renderer.setRenderObjectFunction(null)
    camera.update(renderer, scene)
    renderer.setRenderTarget(target)
    quad.render(renderer)
    // Restore before asynchronous readback so this request never leaves the shared host in capture mode.
    restore()
    const pixels = await renderer.readRenderTargetPixelsAsync(target, 0, 0, 2048, 1024)
    signal?.throwIfAborted()
    if (!(pixels instanceof Float32Array)) throw new Error('摄影棚 HDR 捕获未返回线性浮点像素')
    return createEquirect(pixels, 2048, 1024)
  } finally {
    // Synchronous render failures also restore every mutation; no renderer/scene is owned here.
    restore()
    cube.dispose()
    target.dispose()
    material.dispose()
    // QuadMesh uses the Three shared singleton geometry; it is not this capture's resource.
  }
}

export async function createGpuStudioEnvironment(
  renderer: WebGPURenderer,
  groundY: number = studioDesign.groundY,
  signal?: AbortSignal,
): Promise<OwnedEnvironment> {
  const scene = new Scene(),
    geometry = createGpuStudioGeometry(groundY, true),
    lighting = createStudioLights()
  scene.background = new Color(studioDesign.background).multiplyScalar(studioDesign.captureFill)
  scene.add(geometry.group, ...lighting.lights)
  let texture: DataTexture | undefined, background: DataTexture | undefined
  try {
    bindGpuAreaLights()
    texture = await captureEquirect(renderer, scene, [0, 0.55, 0], signal)
    texture.name = 'Trees X / authored studio HDR'
    background = createStudioSkyTexture()
    const env = texture,
      sky = background,
      environment = ownEnvironmentPmrem(renderer, env)
    let disposed = false
    return {
      texture: env,
      background: sky,
      dispose() {
        if (disposed) return
        disposed = true
        try {
          environment.dispose()
        } finally {
          sky.dispose()
        }
      },
    }
  } catch (error) {
    texture?.dispose()
    background?.dispose()
    throw error
  } finally {
    lighting.dispose()
    geometry.dispose()
    scene.clear()
  }
}

/** Fallback room uses the same HDR capture route, without importing a WebGL PMREM. */
export async function createGpuRoomEnvironment(
  renderer: WebGPURenderer,
  signal?: AbortSignal,
): Promise<OwnedEnvironment> {
  const scene = new RoomEnvironment(),
    releaseAreaLights = acquireRectAreaUniforms()
  let texture: DataTexture | undefined
  try {
    bindGpuAreaLights()
    texture = await captureEquirect(renderer, scene, [0, 0, 0], signal)
    texture.name = 'Trees X / fallback room HDR'
    return ownEnvironmentPmrem(renderer, texture)
  } catch (error) {
    texture?.dispose()
    throw error
  } finally {
    releaseAreaLights()
    scene.dispose()
  }
}
