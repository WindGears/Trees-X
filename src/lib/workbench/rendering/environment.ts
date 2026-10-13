import { EquirectangularReflectionMapping, PMREMGenerator, type Texture } from 'three'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js'
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js'
import { createAssetEnvironment } from '../assetEnvironment'
import { createStudioEnvironment } from '../studio/geometry'
import { createPianoEnvironment } from '../pianoEnvironment'
import { isWebGpuRenderer, type WorkbenchRenderer } from './rendererTypes'
import { ownEnvironmentPmrem } from './environmentPMREM'
import { isRealtimeRenderer } from './realtimeMode'

export interface OwnedEnvironment {
  texture: Texture
  background?: Texture
  dispose(): void
}

/** The scene owns its fallback; a loaded adapter only owns its replacement. */
export async function createBaseEnvironment(
  renderer: WorkbenchRenderer,
  signal?: AbortSignal,
): Promise<OwnedEnvironment> {
  signal?.throwIfAborted()
  if (isWebGpuRenderer(renderer)) {
    const { createGpuRoomEnvironment } = await import('./studioEnvironment')
    signal?.throwIfAborted()
    return createGpuRoomEnvironment(renderer, signal)
  }
  const scene = new RoomEnvironment(),
    generator = new PMREMGenerator(renderer)
  try {
    return generator.fromScene(scene)
  } finally {
    generator.dispose()
    scene.dispose()
  }
}

/** WebGL retains its authored PMREM; WebGPU retains an unfiltered HDR source for both consumers. */
export async function createProductEnvironment(
  renderer: WorkbenchRenderer,
  adapterId: string | undefined,
  groundY: number | undefined,
  file?: string,
  data?: ArrayBuffer,
  signal?: AbortSignal,
): Promise<OwnedEnvironment | undefined> {
  signal?.throwIfAborted()
  if (file && data) {
    if (!isWebGpuRenderer(renderer)) return createAssetEnvironment(file, data, renderer)
    const loader = file.endsWith('.exr') ? new EXRLoader() : new HDRLoader()
    const texture = loader.createDataTexture(data)
    texture.mapping = EquirectangularReflectionMapping
    try {
      return ownEnvironmentPmrem(renderer, texture)
    } catch (error) {
      texture.dispose()
      throw error
    }
  }
  if (isWebGpuRenderer(renderer)) {
    if (adapterId === 'typewriter-v1' && isRealtimeRenderer(renderer)) {
      const { createRealtimeReferenceEnvironment } = await import('./realtime/referenceEnvironment')
      signal?.throwIfAborted()
      return createRealtimeReferenceEnvironment(renderer, signal)
    }
    const { createGpuStudioEnvironment, createGpuRoomEnvironment } =
      await import('./studioEnvironment')
    signal?.throwIfAborted()
    return adapterId === 'typewriter-v1'
      ? createGpuStudioEnvironment(renderer, groundY, signal)
      : adapterId === 'piano-v1'
        ? createGpuRoomEnvironment(renderer, signal)
        : undefined
  }
  return adapterId === 'typewriter-v1'
    ? createStudioEnvironment(renderer, groundY)
    : adapterId === 'piano-v1'
      ? createPianoEnvironment(renderer)
      : undefined
}
