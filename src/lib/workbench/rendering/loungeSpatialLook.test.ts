import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Mesh, Texture } from 'three'
import { MeshBasicNodeMaterial, type Node } from 'three/webgpu'
import { createLoungeSpatialLook } from './loungeSpatialLook'
import { loadLoungeDepth } from './loungeDepth'
import { loadLoungeLayerAssets, type LoungeLayerAssets } from './loungeLayerAssets'
import { createGpuStudioGeometry } from './studioGeometry'
import { studioPalettes } from '../studio/palette'

vi.mock('./loungeDepth', () => ({ loadLoungeDepth: vi.fn() }))
vi.mock('./loungeLayerAssets', () => ({ loadLoungeLayerAssets: vi.fn() }))

const depthLoader = vi.mocked(loadLoungeDepth),
  layerLoader = vi.mocked(loadLoungeLayerAssets),
  cleanups: (() => void)[] = []

function fixture(search: string, spatialTable = true) {
  vi.stubGlobal('window', { location: { search } })
  const studio = createGpuStudioGeometry(-0.0192, false, studioPalettes.light, spatialTable),
    image = new Texture(),
    borrowed = [
      vi.spyOn(image, 'dispose'),
      vi.spyOn(studio.pedestal.geometry, 'dispose'),
      vi.spyOn(studio.surface, 'dispose'),
      vi.spyOn(studio.skyMaterial, 'dispose'),
    ]
  cleanups.push(() => {
    studio.dispose()
    image.dispose()
  })
  const children = [...studio.group.children]
  return { studio, image, borrowed, children }
}

function ownedPack() {
  const cleanRoom = new Texture(),
    chair = new Texture(),
    lamp = new Texture(),
    textures = [cleanRoom, chair, lamp],
    releases = textures.map((texture) => vi.spyOn(texture, 'dispose'))
  let disposed = false
  const dispose = vi.fn(() => {
    if (disposed) return
    disposed = true
    for (const texture of textures) texture.dispose()
  })
  cleanups.push(dispose)
  return { cleanRoom, chair, lamp, dispose, releases }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((accept) => {
    resolve = accept
  })
  return { promise, resolve }
}

function imageTextures(node: Node | null) {
  const textures = new Set<Texture>()
  node?.traverse((child) => {
    if ('value' in child && child.value instanceof Texture) textures.add(child.value)
  })
  return textures
}

function mesh(studio: ReturnType<typeof createGpuStudioGeometry>, name: string) {
  const node = studio.group.getObjectByName(name)
  if (!(node instanceof Mesh) || !(node.material instanceof MeshBasicNodeMaterial))
    throw new Error('Expected real room mesh: ' + name)
  return node as Mesh<typeof node.geometry, MeshBasicNodeMaterial>
}

function expectUnchangedStage(f: ReturnType<typeof fixture>) {
  expect(f.studio.group.children).toEqual(f.children)
  expect(f.studio.group.userData.loungeSpatial).toBeUndefined()
  expect(f.studio.sky.visible).toBe(true)
  expect(f.studio.floorMesh.visible).toBe(false)
  for (const release of f.borrowed) expect(release).not.toHaveBeenCalled()
}

beforeEach(() => {
  depthLoader.mockReset()
  layerLoader.mockReset()
})
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('owned finite lounge integration', () => {
  it('keeps the default infinite studio unchanged without requesting experiment assets', async () => {
    const f = fixture('')
    const look = await createLoungeSpatialLook(f.studio, f.image, new AbortController().signal)
    expect(look).toBeUndefined()
    expect(depthLoader).not.toHaveBeenCalled()
    expect(layerLoader).not.toHaveBeenCalled()
    expectUnchangedStage(f)
  })

  it('does not activate a requested finite room on a studio without the experimental table', async () => {
    const f = fixture('?loungeSpatial=box&loungeLayers=1', false)
    expect(
      await createLoungeSpatialLook(f.studio, f.image, new AbortController().signal),
    ).toBeUndefined()
    expect(depthLoader).not.toHaveBeenCalled()
    expect(layerLoader).not.toHaveBeenCalled()
    expect(f.studio.group.children).toEqual(f.children)
    expect(f.studio.group.userData.loungeSpatial).toBeUndefined()
    for (const release of f.borrowed) expect(release).not.toHaveBeenCalled()
  })

  it('borrows the panorama and stage, releases only its finite geometry, and restores original visibility', async () => {
    const f = fixture('?loungeSpatial=box')
    f.studio.sky.visible = false
    f.studio.floorMesh.visible = true
    const look = await createLoungeSpatialLook(f.studio, f.image, new AbortController().signal)
    if (!look) throw new Error('Expected finite look')
    cleanups.push(look.dispose)
    const room = mesh(f.studio, 'Trees X / finite image room'),
      geometryRelease = vi.spyOn(room.geometry, 'dispose'),
      materialRelease = vi.spyOn(room.material, 'dispose')
    expect(imageTextures(room.material.colorNode)).toEqual(new Set([f.image]))
    expect(f.studio.group.userData.loungeSpatial).toMatchObject({
      mode: 'box',
      cleanPlate: null,
      imageLayers: null,
    })
    expect(depthLoader).not.toHaveBeenCalled()
    expect(layerLoader).not.toHaveBeenCalled()
    look.setBlend(1)
    expect(room.parent?.visible).toBe(true)
    expect(f.studio.sky.visible || f.studio.floorMesh.visible).toBe(false)
    look.setBlend(0)
    expect(room.parent?.visible).toBe(false)
    expect(f.studio.sky.visible).toBe(false)
    expect(f.studio.floorMesh.visible).toBe(true)
    look.setBlend(1)
    look.dispose()
    look.dispose()
    look.setBlend(1)
    expect(f.studio.sky.visible).toBe(false)
    expect(f.studio.floorMesh.visible).toBe(true)
    expect(f.studio.group.children).toEqual(f.children)
    expect(f.studio.group.userData.loungeSpatial).toBeUndefined()
    expect(geometryRelease).toHaveBeenCalledTimes(1)
    expect(materialRelease).toHaveBeenCalledTimes(1)
    for (const release of f.borrowed) expect(release).not.toHaveBeenCalled()
  })

  it('attaches a clean room and two real cards, switches their visibility, and releases the pack once', async () => {
    const f = fixture('?loungeSpatial=box&loungeLayers=1'),
      pack = ownedPack(),
      signal = new AbortController().signal
    layerLoader.mockResolvedValue(pack)
    const look = await createLoungeSpatialLook(f.studio, f.image, signal)
    if (!look) throw new Error('Expected layered look')
    cleanups.push(look.dispose)
    const room = mesh(f.studio, 'Trees X / finite image room'),
      layers = f.studio.group.getObjectByName('Trees X / experimental lounge image layers')
    if (!layers) throw new Error('Expected attached image layers')
    expect(layerLoader).toHaveBeenCalledExactlyOnceWith(signal)
    expect(depthLoader).not.toHaveBeenCalled()
    expect(imageTextures(room.material.colorNode)).toEqual(new Set([pack.cleanRoom]))
    expect(layers.parent).toBe(room.parent)
    expect(layers.children).toHaveLength(2)
    const releases = layers.children.flatMap((card) => {
      if (!(card instanceof Mesh) || Array.isArray(card.material))
        throw new Error('Expected card mesh')
      return [vi.spyOn(card.geometry, 'dispose'), vi.spyOn(card.material, 'dispose')]
    })
    expect(f.studio.group.userData.loungeSpatial).toMatchObject({
      mode: 'box',
      imageLayers: { cardCount: 2 },
      cleanPlate: '/studio/amber-lounge/layers-v1/clean-room.png',
    })
    look.setBlend(1)
    expect(layers.visible && room.parent?.visible).toBe(true)
    look.setBlend(0)
    expect(layers.visible || room.parent?.visible).toBe(false)
    expect(pack.dispose).not.toHaveBeenCalled()
    look.dispose()
    look.dispose()
    expect(pack.dispose).toHaveBeenCalledTimes(1)
    for (const release of [...releases, ...pack.releases]) expect(release).toHaveBeenCalledTimes(1)
    expect(layers.parent).toBeNull()
    expectUnchangedStage(f)
  })

  it('does not enter loaders or modify the stage when cancelled before startup', async () => {
    const f = fixture('?loungeSpatial=box&loungeLayers=1'),
      controller = new AbortController(),
      reason = new Error('cancelled before startup')
    controller.abort(reason)
    await expect(createLoungeSpatialLook(f.studio, f.image, controller.signal)).rejects.toBe(reason)
    expect(layerLoader).not.toHaveBeenCalled()
    expect(depthLoader).not.toHaveBeenCalled()
    expectUnchangedStage(f)
  })

  it('releases a late returned pack once after cancellation without attaching any room or cards', async () => {
    const f = fixture('?loungeSpatial=box&loungeLayers=1'),
      pack = ownedPack(),
      pending = deferred<LoungeLayerAssets>(),
      controller = new AbortController(),
      reason = new Error('cancelled while layer pack was pending')
    layerLoader.mockReturnValue(pending.promise)
    const result = createLoungeSpatialLook(f.studio, f.image, controller.signal)
    const rejected = expect(result).rejects.toBe(reason)
    expect(layerLoader).toHaveBeenCalledOnce()
    controller.abort(reason)
    pending.resolve(pack)
    await rejected
    expect(pack.dispose).toHaveBeenCalledTimes(1)
    for (const release of pack.releases) expect(release).toHaveBeenCalledTimes(1)
    expectUnchangedStage(f)
  })

  it.each(['layers', 'depth'] as const)(
    'leaves the stage unchanged after a %s loader failure',
    async (mode) => {
      const f = fixture(
          mode === 'layers' ? '?loungeSpatial=box&loungeLayers=1' : '?loungeSpatial=depth',
        ),
        reason = new Error('real loader boundary rejected')
      if (mode === 'layers') layerLoader.mockRejectedValue(reason)
      else depthLoader.mockRejectedValue(reason)
      await expect(
        createLoungeSpatialLook(f.studio, f.image, new AbortController().signal),
      ).rejects.toBe(reason)
      expectUnchangedStage(f)
    },
  )

  it('grounds predicted floor vertices at the real table base and owns both radial and fallback surfaces', async () => {
    const f = fixture('?loungeSpatial=depth'),
      distance = new Float32Array(512 * 256).fill(0.1165),
      original = distance.slice(),
      signal = new AbortController().signal
    depthLoader.mockResolvedValue({ distance, width: 512, height: 256 })
    const look = await createLoungeSpatialLook(f.studio, f.image, signal)
    if (!look || !f.studio.table) throw new Error('Expected depth look and real table')
    cleanups.push(look.dispose)
    const room = mesh(f.studio, 'Trees X / radial depth image room'),
      fallback = mesh(f.studio, 'Trees X / finite image room'),
      metadata = f.studio.group.userData.loungeSpatial,
      position = room.geometry.getAttribute('position'),
      releases = [room, fallback].flatMap((item) => [
        vi.spyOn(item.geometry, 'dispose'),
        vi.spyOn(item.material, 'dispose'),
      ])
    expect(depthLoader).toHaveBeenCalledExactlyOnceWith(signal)
    expect(layerLoader).not.toHaveBeenCalled()
    expect(metadata).toMatchObject({
      mode: 'depth',
      fallback: 'unrecovered-far-box',
      floorY: f.studio.table.floorY,
    })
    expect(metadata.groundedVertices).toBeGreaterThan(0)
    const floorVertices = Array.from({ length: position.count }, (_, index) =>
      position.getY(index),
    ).filter((y) => Math.abs(y - f.studio.table!.floorY) < 1e-5)
    expect(floorVertices).toHaveLength(metadata.groundedVertices)
    for (const y of floorVertices) expect(y).toBeCloseTo(f.studio.table.floorY, 6)
    expect(distance).toEqual(original)
    expect(imageTextures(room.material.colorNode)).toEqual(new Set([f.image]))
    expect(imageTextures(fallback.material.colorNode)).toEqual(new Set([f.image]))
    look.setBlend(1)
    expect(f.studio.sky.visible || f.studio.floorMesh.visible).toBe(false)
    look.dispose()
    look.dispose()
    for (const release of releases) expect(release).toHaveBeenCalledTimes(1)
    expectUnchangedStage(f)
  })
})
