import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { gsap } from 'gsap'
import {
  DataTexture,
  Group,
  LinearFilter,
  LinearMipmapLinearFilter,
  NoColorSpace,
  PerspectiveCamera,
  RectAreaLight,
  Scene,
  SRGBColorSpace,
  Texture,
} from 'three'
import { MeshPhysicalNodeMaterial, type Node } from 'three/webgpu'
import { createLoungeLook } from './loungeLook'
import { loadLoungeAssets, type LoungeAssets } from './loungeAssets'
import { createGpuStudioGeometry } from './studioGeometry'
import { studioPalettes } from '../studio/palette'
import type { StudioEnvironmentStatus } from '../studio/mood'

vi.mock('./loungeAssets', () => ({ loadLoungeAssets: vi.fn() }))

const load = vi.mocked(loadLoungeAssets)

function ownedAssets() {
  const panorama = new Texture(),
    baseColor = new Texture(),
    roughness = new Texture(),
    normal = new Texture(),
    textures = [panorama, baseColor, roughness, normal],
    releases = textures.map((texture) => vi.spyOn(texture, 'dispose'))
  let disposed = false
  const dispose = vi.fn(() => {
    if (disposed) return
    disposed = true
    for (const texture of textures) texture.dispose()
  })
  return { panorama, baseColor, roughness, normal, dispose, releases }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((complete) => {
    resolve = complete
  })
  return { promise, resolve }
}

function dataTextures(root: Node | null | undefined) {
  const textures = new Set<DataTexture>()
  root?.traverse((node) => {
    if ('value' in node && node.value instanceof DataTexture) textures.add(node.value)
  })
  return [...textures]
}

function fixture() {
  const geometry = createGpuStudioGeometry(),
    lights = [
      new RectAreaLight('#ffdddd', 4, 2, 3),
      new RectAreaLight('#ddddff', 3, 3, 2),
      new RectAreaLight('#ffffff', 2, 1, 4),
    ],
    changed = vi.fn(),
    report = vi.fn<(status: StudioEnvironmentStatus) => void>(),
    look = createLoungeLook(geometry, lights)
  return {
    geometry,
    lights,
    look,
    changed,
    report,
    setMood: (mood: 'light' | 'dark') => look.setMood({ mood, changed, report }),
    dispose: () => {
      look.dispose()
      geometry.dispose()
    },
  }
}

beforeEach(() => {
  load.mockReset()
  vi.stubGlobal('matchMedia', () => ({ matches: true }))
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('owned amber lounge appearance', () => {
  it('reuses stage geometry and one asset pack across immediate in-place switches', async () => {
    const assets = ownedAssets(),
      pending = deferred<LoungeAssets>()
    load.mockReturnValue(pending.promise)
    const f = fixture(),
      scene = new Scene(),
      product = new Group(),
      camera = new PerspectiveCamera(38, 1.44, 0.05, 250)
    product.position.set(1, 2, 3)
    product.rotation.set(0.2, 0.6, 0.3)
    camera.position.set(3.5, 2.3, 5)
    camera.lookAt(0, 0.5, 0)
    scene.add(product, camera, f.geometry.group)
    scene.updateMatrixWorld(true)
    const children = [...f.geometry.group.children],
      geometries = children.map((child) => ('geometry' in child ? child.geometry : undefined)),
      productMatrix = product.matrixWorld.toArray(),
      cameraMatrix = camera.matrixWorld.toArray(),
      projection = camera.projectionMatrix.toArray(),
      updateProjection = vi.spyOn(camera, 'updateProjectionMatrix')
    try {
      f.setMood('light')
      expect(load).not.toHaveBeenCalled()
      f.setMood('dark')
      f.setMood('light')
      f.setMood('dark')
      expect(load).toHaveBeenCalledOnce()
      expect(f.report).toHaveBeenLastCalledWith({ phase: 'loading' })
      pending.resolve(assets)
      await vi.waitFor(() => expect(f.report).toHaveBeenLastCalledWith({ phase: 'ready' }))
      const material = f.geometry.pedestal.material
      expect(material).toBeInstanceOf(MeshPhysicalNodeMaterial)
      expect((material as MeshPhysicalNodeMaterial).map).toBe(assets.baseColor)
      expect((material as MeshPhysicalNodeMaterial).normalMap).toBe(assets.normal)
      expect((material as MeshPhysicalNodeMaterial).roughnessMap).toBe(assets.roughness)
      for (const mood of ['light', 'dark', 'light', 'dark'] as const) f.setMood(mood)
      expect(load).toHaveBeenCalledOnce()
      expect(f.geometry.group.children).toEqual(children)
      expect(
        f.geometry.group.children.map((child) =>
          'geometry' in child ? child.geometry : undefined,
        ),
      ).toEqual(geometries)
      scene.updateMatrixWorld(true)
      expect(product.matrixWorld.toArray()).toEqual(productMatrix)
      expect(camera.matrixWorld.toArray()).toEqual(cameraMatrix)
      expect(camera.projectionMatrix.toArray()).toEqual(projection)
      expect(updateProjection).not.toHaveBeenCalled()
      expect(f.geometry.group.userData.studioMood).toBe('dark')
    } finally {
      f.dispose()
    }
  })

  it('restores baseline floor colors and authored softbox colors and power on light', async () => {
    load.mockResolvedValue(ownedAssets())
    const f = fixture(),
      floor = f.geometry.floorMaterial.color.clone(),
      trace = f.geometry.traceFloor.color.clone(),
      original = f.lights.map((light) => ({ color: light.color.clone(), power: light.intensity }))
    try {
      f.setMood('dark')
      await vi.waitFor(() => expect(f.report).toHaveBeenLastCalledWith({ phase: 'ready' }))
      expect(f.geometry.floorMaterial.color.getHexString()).toBe(studioPalettes.dark.floor.slice(1))
      expect(f.lights[0]!.intensity).not.toBe(original[0]!.power)
      f.setMood('light')
      expect(f.geometry.floorMaterial.color.equals(floor)).toBe(true)
      expect(f.geometry.traceFloor.color.equals(trace)).toBe(true)
      f.lights.forEach((light, index) => {
        expect(light.color.equals(original[index]!.color)).toBe(true)
        expect(light.intensity).toBe(original[index]!.power)
      })
    } finally {
      f.dispose()
    }
  })

  it('does not revive a killed dark tween after switching light before the first render', async () => {
    load.mockResolvedValue(ownedAssets())
    vi.stubGlobal('matchMedia', () => ({ matches: false }))
    const now = vi.spyOn(performance, 'now').mockReturnValue(1000),
      animate = vi.spyOn(gsap, 'to'),
      f = fixture(),
      floor = f.geometry.floorMaterial.color.clone(),
      original = f.lights.map((light) => ({ color: light.color.clone(), power: light.intensity }))
    try {
      f.setMood('dark')
      expect(animate).toHaveBeenCalledOnce()
      const darkTween = animate.mock.results[0]!.value as gsap.core.Tween,
        kill = vi.spyOn(darkTween, 'kill')
      f.setMood('light')
      expect(kill).toHaveBeenCalledOnce()
      const advance = vi.spyOn(darkTween, 'totalTime'),
        changes = f.changed.mock.calls.length
      now.mockReturnValue(1500)
      f.look.render()
      f.look.render()
      expect(advance).not.toHaveBeenCalled()
      expect(f.changed).toHaveBeenCalledTimes(changes)
      await vi.waitFor(() => expect(f.report).toHaveBeenLastCalledWith({ phase: 'ready' }))
      expect(f.geometry.group.userData.studioMood).toBe('light')
      expect(f.geometry.floorMaterial.color.equals(floor)).toBe(true)
      f.lights.forEach((light, index) => {
        expect(light.color.equals(original[index]!.color)).toBe(true)
        expect(light.intensity).toBe(original[index]!.power)
      })
      expect(load).toHaveBeenCalledOnce()
    } finally {
      f.dispose()
    }
  })

  it('releases only owned material, placeholders and assets once and stops its pending tween', async () => {
    const assets = ownedAssets()
    load.mockResolvedValue(assets)
    const placeholders = vi.spyOn(DataTexture.prototype, 'dispose'),
      f = fixture(),
      borrowedGeometry = vi.spyOn(f.geometry.pedestal.geometry, 'dispose'),
      borrowedSurface = vi.spyOn(f.geometry.surface, 'dispose'),
      borrowedSky = vi.spyOn(f.geometry.skyMaterial, 'dispose'),
      ownedMaterial = f.geometry.pedestal.material,
      releaseMaterial = vi.spyOn(ownedMaterial, 'dispose')
    const nodeMaterial = ownedMaterial as MeshPhysicalNodeMaterial,
      imageGraphs = [f.geometry.skyMaterial.colorNode, nodeMaterial.colorNode],
      dataGraphs = [nodeMaterial.roughnessNode, nodeMaterial.normalNode],
      seededTextures = [...imageGraphs, ...dataGraphs].flatMap((graph) => {
        const textures = dataTextures(graph)
        expect(textures).toHaveLength(1)
        return textures
      })
    expect(new Set(seededTextures).size).toBe(4)
    expect(load).not.toHaveBeenCalled()
    for (const texture of seededTextures) {
      expect(texture.minFilter).toBe(LinearMipmapLinearFilter)
      expect(texture.magFilter).toBe(LinearFilter)
      expect(texture.generateMipmaps).toBe(true)
    }
    for (const graph of imageGraphs) expect(dataTextures(graph)[0]!.colorSpace).toBe(SRGBColorSpace)
    for (const graph of dataGraphs) expect(dataTextures(graph)[0]!.colorSpace).toBe(NoColorSpace)
    f.setMood('dark')
    await vi.waitFor(() => expect(f.report).toHaveBeenLastCalledWith({ phase: 'ready' }))
    vi.stubGlobal('matchMedia', () => ({ matches: false }))
    const animate = vi.spyOn(gsap, 'to')
    f.setMood('light')
    expect(animate).toHaveBeenCalledOnce()
    const tween = animate.mock.results[0]!.value as gsap.core.Tween,
      kill = vi.spyOn(tween, 'kill'),
      changed = f.changed.mock.calls.length,
      reports = f.report.mock.calls.length,
      signal = load.mock.calls[0]![0]
    f.look.dispose()
    f.look.dispose()
    f.look.render()
    f.setMood('dark')
    expect(signal.aborted).toBe(true)
    expect(kill).toHaveBeenCalledOnce()
    expect(releaseMaterial).toHaveBeenCalledOnce()
    expect(placeholders).toHaveBeenCalledTimes(4)
    expect(assets.dispose).toHaveBeenCalledOnce()
    for (const release of assets.releases) expect(release).toHaveBeenCalledOnce()
    expect(borrowedGeometry).not.toHaveBeenCalled()
    expect(borrowedSurface).not.toHaveBeenCalled()
    expect(borrowedSky).not.toHaveBeenCalled()
    expect(f.geometry.pedestal.material).toBe(f.geometry.surface)
    expect(f.changed).toHaveBeenCalledTimes(changed)
    expect(f.report).toHaveBeenCalledTimes(reports)
    f.geometry.dispose()
  })

  it('disposes a late result without publishing or touching the released look', async () => {
    const assets = ownedAssets(),
      pending = deferred<LoungeAssets>()
    load.mockReturnValue(pending.promise)
    const f = fixture()
    f.setMood('dark')
    f.look.dispose()
    const reports = f.report.mock.calls.length,
      changes = f.changed.mock.calls.length
    pending.resolve(assets)
    await vi.waitFor(() => expect(assets.dispose).toHaveBeenCalledOnce())
    expect(f.report).toHaveBeenCalledTimes(reports)
    expect(f.changed).toHaveBeenCalledTimes(changes)
    expect(f.geometry.pedestal.material).toBe(f.geometry.surface)
    expect(f.geometry.surface.map).toBeNull()
    for (const release of assets.releases) expect(release).toHaveBeenCalledOnce()
    f.dispose()
  })

  it('keeps the base stage on load failure and accepts an explicit dark retry', async () => {
    const assets = ownedAssets()
    load
      .mockRejectedValueOnce(new Error('fixture network unavailable'))
      .mockResolvedValueOnce(assets)
    const f = fixture(),
      children = [...f.geometry.group.children],
      borrowed = vi.spyOn(f.geometry.surface, 'dispose')
    try {
      f.setMood('dark')
      await vi.waitFor(() =>
        expect(f.report).toHaveBeenLastCalledWith({
          phase: 'error',
          error: 'fixture network unavailable',
        }),
      )
      expect(f.geometry.group.children).toEqual(children)
      expect(f.geometry.pedestal.material).toBeInstanceOf(MeshPhysicalNodeMaterial)
      expect((f.geometry.pedestal.material as MeshPhysicalNodeMaterial).map).toBeNull()
      expect(borrowed).not.toHaveBeenCalled()
      f.setMood('light')
      expect(load).toHaveBeenCalledOnce()
      f.setMood('dark')
      await vi.waitFor(() => expect(f.report).toHaveBeenLastCalledWith({ phase: 'ready' }))
      expect(load).toHaveBeenCalledTimes(2)
      expect((f.geometry.pedestal.material as MeshPhysicalNodeMaterial).map).toBe(assets.baseColor)
      expect(f.geometry.group.userData.lounge.status).toBe('ready')
    } finally {
      f.dispose()
    }
  })
})
