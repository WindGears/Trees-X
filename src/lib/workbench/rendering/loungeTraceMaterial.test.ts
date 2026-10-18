import { afterEach, describe, expect, it, vi } from 'vitest'
import { Color, Mesh, MeshPhysicalMaterial, Scene, Texture } from 'three'
import { createLoungeTraceMaterials } from './loungeTraceMaterial'
import { createGpuStudioGeometry } from './studioGeometry'
import { createDdgiProxyScene } from './realtime/ddgi/proxyScene'
import { studioPalettes } from '../studio/palette'

const cleanups: (() => void)[] = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup()
  vi.restoreAllMocks()
})

function fixture(spatial = true) {
  const geometry = createGpuStudioGeometry(undefined, false, undefined, spatial),
    top = geometry.table?.top ?? geometry.pedestal,
    sources = geometry.tableSideMaterial
      ? [geometry.surface, geometry.tableSideMaterial]
      : [geometry.surface],
    assets = {
      panorama: new Texture(),
      baseColor: new Texture(),
      roughness: new Texture(),
      normal: new Texture(),
      dispose: vi.fn(),
    },
    tracing = createLoungeTraceMaterials(top, sources, geometry.surface.roughness)
  cleanups.push(() => {
    tracing.dispose()
    geometry.dispose()
    assets.panorama.dispose()
    assets.baseColor.dispose()
    assets.roughness.dispose()
    assets.normal.dispose()
  })
  return { geometry, top, sources, assets, tracing }
}

describe('owned scalar lounge tracing approximation', () => {
  it.each([true, false])('matches light and warm endpoints with spatial=%s', (spatial) => {
    const f = fixture(spatial)
    for (const material of f.tracing.materials) {
      expect(material.map).toBeNull()
      expect(material.color.equals(new Color(studioPalettes.light.pedestal))).toBe(true)
      expect(material.roughness).toBe(f.geometry.surface.roughness)
    }
    f.tracing.sync(1)
    for (const material of f.tracing.materials) {
      expect(material.color.equals(new Color(studioPalettes.dark.pedestal))).toBe(true)
      expect(material.map).toBeNull()
    }
    f.tracing.sync(1, f.assets)
    f.tracing.materials.forEach((material, index) => {
      expect(material.color.equals(new Color(1, 1, 1))).toBe(true)
      expect(material.map).toBe(f.assets.baseColor)
      expect(material.roughnessMap).toBe(f.assets.roughness)
      expect(material.roughness).toBe(1)
      expect(material.metalness).toBe(f.sources[index]!.metalness)
      expect(material.clearcoat).toBe(f.sources[index]!.clearcoat)
      expect(material.clearcoatRoughness).toBe(f.sources[index]!.clearcoatRoughness)
      // Independent repeat=8 cannot be represented by Speedball's base-color UV.
      expect(material.normalMap).toBeNull()
      expect(material.normalScale.toArray()).toEqual([0, 0])
    })
    f.tracing.sync(0, f.assets)
    for (const material of f.tracing.materials) {
      expect(material.map).toBeNull()
      expect(material.roughnessMap).toBeNull()
      expect(material.roughness).toBe(f.geometry.surface.roughness)
      expect(material.color.equals(new Color(studioPalettes.light.pedestal))).toBe(true)
    }
    expect(f.tracing.metadata.limitations).toContain(
      'Tracing keeps geometry normals because the stone normal map uses an independent repeat.',
    )
  })

  it('synchronizes transition scalars without texture creation or needless version changes', () => {
    const f = fixture(),
      material = f.tracing.materials[0]!,
      version = material.version,
      expected = new Color(studioPalettes.light.pedestal),
      dark = new Color(studioPalettes.dark.pedestal)
    for (const blend of [0.25, 0.5, 0.75, 0.5, 0.25]) {
      f.tracing.sync(blend, f.assets)
      expected.set(studioPalettes.light.pedestal).lerp(dark, blend)
      expect(material.color.equals(expected)).toBe(true)
      expect(material.map).toBeNull()
      expect(material.version).toBe(version)
      expect(f.tracing.metadata).toMatchObject({ blend, ready: true })
    }
    f.tracing.sync(1, f.assets)
    expect(material.version).toBe(version + 1)
    f.tracing.sync(1, f.assets)
    expect(material.version).toBe(version + 1)
    f.tracing.sync(0, f.assets)
    expect(material.version).toBe(version + 2)
  })

  it('restores exact preexisting array binding and only disposes its own materials once', () => {
    const geometry = createGpuStudioGeometry(),
      previous = [new MeshPhysicalMaterial(), new MeshPhysicalMaterial()],
      top = geometry.pedestal
    Object.defineProperty(top.userData, 'traceMaterial', {
      value: previous,
      configurable: true,
      enumerable: false,
      writable: false,
    })
    const descriptor = Object.getOwnPropertyDescriptor(top.userData, 'traceMaterial'),
      tracing = createLoungeTraceMaterials(top, [geometry.surface], geometry.surface.roughness),
      material = tracing.materials[0]!,
      ownRelease = vi.spyOn(material, 'dispose'),
      sourceRelease = vi.spyOn(geometry.surface, 'dispose'),
      oldReleases = previous.map((entry) => vi.spyOn(entry, 'dispose')),
      baseColor = new Texture(),
      textureRelease = vi.spyOn(baseColor, 'dispose'),
      assets = {
        baseColor,
        panorama: baseColor,
        roughness: baseColor,
        normal: baseColor,
        dispose() {},
      }
    tracing.sync(1, assets)
    tracing.dispose()
    tracing.dispose()
    const color = material.color.clone()
    tracing.sync(0)
    expect(material.color.equals(color)).toBe(true)
    expect(Object.getOwnPropertyDescriptor(top.userData, 'traceMaterial')).toEqual(descriptor)
    expect(top.userData.traceMaterial).toBe(previous)
    expect(ownRelease).toHaveBeenCalledOnce()
    expect(sourceRelease).not.toHaveBeenCalled()
    expect(textureRelease).not.toHaveBeenCalled()
    oldReleases.forEach((release) => expect(release).not.toHaveBeenCalled())
    geometry.dispose()
    baseColor.dispose()
    previous.forEach((entry) => entry.dispose())
  })

  it('restores inherited bindings and an own undefined value without confusing their ownership', () => {
    for (const own of [false, true]) {
      const geometry = createGpuStudioGeometry(),
        previous = new MeshPhysicalMaterial(),
        userData = Object.create({ traceMaterial: previous }) as Record<string, unknown>
      geometry.pedestal.userData = userData
      if (own) userData.traceMaterial = undefined
      const tracing = createLoungeTraceMaterials(
        geometry.pedestal,
        [geometry.surface],
        geometry.surface.roughness,
      )
      tracing.dispose()
      expect(Object.hasOwn(userData, 'traceMaterial')).toBe(own)
      expect(userData.traceMaterial).toBe(own ? undefined : previous)
      geometry.dispose()
      previous.dispose()
    }
  })

  it('feeds both real table groups to proxy.sync and reports endpoint map and transition scalar edits', () => {
    const f = fixture(),
      scene = new Scene()
    scene.add(f.geometry.group)
    const proxy = createDdgiProxyScene(scene)
    cleanups.push(() => proxy.dispose())
    expect(proxy.sync().topology).toBe(true)
    const mesh = proxy.scene.getObjectByName(f.top.name)
    if (!(mesh instanceof Mesh)) throw new Error('Expected the actual table proxy')
    expect(mesh.geometry).toBe(f.top.geometry)
    expect(mesh.material).toBe(f.top.userData.traceMaterial)
    expect(mesh.material).toEqual(f.tracing.materials)
    expect(proxy.sync().materials).toEqual([])
    f.tracing.sync(0.5, f.assets)
    expect(proxy.sync().materials).toEqual(f.tracing.materials)
    f.tracing.sync(1, f.assets)
    const warm = proxy.sync()
    expect(warm.topology).toBe(false)
    expect(warm.materials).toEqual(f.tracing.materials)
    expect(proxy.sync().materials).toEqual([])
    f.tracing.sync(0, f.assets)
    expect(proxy.sync().materials).toEqual(f.tracing.materials)
    expect(proxy.sync().materials).toEqual([])
  })
})
