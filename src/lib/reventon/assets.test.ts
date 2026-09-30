import { afterEach, describe, expect, it, vi } from 'vitest'
import { BoxGeometry, DataTexture, Group, Mesh, MeshStandardMaterial, Texture } from 'three'
const loaders = vi.hoisted(() => ({ model: vi.fn(), environment: vi.fn() }))
vi.mock('three/addons/loaders/GLTFLoader.js', () => ({
  GLTFLoader: class {
    loadAsync = loaders.model
  },
}))
vi.mock('three/addons/loaders/EXRLoader.js', () => ({
  EXRLoader: class {
    loadAsync = loaders.environment
  },
}))
import { loadReventon } from './assets'

function resources() {
  const model = new Group()
  const texture = new Texture()
  const material = new MeshStandardMaterial({ map: texture, roughnessMap: texture })
  const geometry = new BoxGeometry()
  model.add(new Mesh(geometry, material), new Mesh(geometry, material))
  const environment = new DataTexture()
  const spies = [geometry, material, texture, environment].map((item) => vi.spyOn(item, 'dispose'))
  return { model, environment, spies }
}
function mockMotion() {
  const response = {
    fps: 24,
    frames: 384,
    duration: 383 / 24,
    tracks: Array.from({ length: 7 }, (_, i) => ({
      id: String(i),
      frames: Array.from({ length: 384 }, () => [0, 0, 0, 0, 0, 0, 1, 1, 1, 1]),
    })),
    cameras: Array.from({ length: 384 }, () => ({
      position: [0, 0, 0],
      quaternion: [0, 0, 0, 1],
      horizontalFov: 60,
    })),
    chapters: [0, 4, 8, 12.5].map((time, i) => ({ id: String(i), label: String(i), time })),
  }
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(response))))
}
afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('Reventon resource ownership', () => {
  it('rejects an already cancelled load before requesting resources', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(loadReventon(controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(loaders.model).not.toHaveBeenCalled()
  })
  it('releases late geometry, shared material maps, and HDR exactly once after cancellation', async () => {
    const { model, environment, spies } = resources()
    mockMotion()
    const controller = new AbortController()
    loaders.model.mockImplementation(async () => {
      controller.abort()
      return { scene: model }
    })
    loaders.environment.mockResolvedValue(environment)
    await expect(loadReventon(controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    spies.forEach((spy) => expect(spy).toHaveBeenCalledTimes(1))
  })
  it('releases the model if environment loading fails, instead of presenting partial assets', async () => {
    const { model, spies } = resources()
    mockMotion()
    loaders.model.mockResolvedValue({ scene: model })
    loaders.environment.mockRejectedValue(new Error('missing HDR'))
    await expect(loadReventon(new AbortController().signal)).rejects.toThrow('资源加载失败')
    spies.slice(0, 3).forEach((spy) => expect(spy).toHaveBeenCalledTimes(1))
    expect(spies[3]).not.toHaveBeenCalled()
  })
  it('disposes an incomplete asset and leaves a subsequent retry independent', async () => {
    mockMotion()
    for (let attempt = 0; attempt < 2; attempt++) {
      const { model, environment, spies } = resources()
      loaders.model.mockResolvedValue({ scene: model })
      loaders.environment.mockResolvedValue(environment)
      await expect(loadReventon(new AbortController().signal)).rejects.toThrow('模型完整性')
      spies.forEach((spy) => expect(spy).toHaveBeenCalledTimes(1))
      mockMotion()
    }
  })
})
