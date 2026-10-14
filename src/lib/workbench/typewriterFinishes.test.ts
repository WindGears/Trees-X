import { readFileSync } from 'node:fs'
import {
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  NoColorSpace,
  RepeatWrapping,
  Texture,
  LinearMipmapLinearFilter,
  DataTexture,
} from 'three'
import { describe, expect, it, vi } from 'vitest'
import { applyTypewriterFinishes } from './typewriterFinishes'
import { createTypewriterMicroMaps } from './typewriterMicroMaps'
import * as microMaps from './typewriterMicroMaps'
import { ownedResources } from './ownedResources'

function surface(name: string) {
  const material = new MeshPhysicalMaterial()
  material.name = name
  return material
}

function authoredSurface(name = 'steel') {
  const material = surface(name)
  material.userData.treesFinishVersion = 2
  material.normalMap = new Texture()
  material.roughnessMap = new Texture()
  return material
}

describe('authored typewriter v2 finishes', () => {
  it('preserves all authored Physical inputs, colors, maps and callbacks', () => {
    const names = [
      'enamel',
      'shellGloss',
      'shellRim',
      'steel',
      'chrome',
      'iron',
      'edge',
      'goldEdge',
      'goldChrome',
    ]
    for (const name of names) {
      const material = authoredSurface(name),
        callback = vi.fn()
      material.color.set('#274b38')
      material.roughness = 0.37
      material.metalness = 0.83
      material.clearcoat = 0.61
      material.clearcoatRoughness = 0.18
      material.anisotropy = 0.34
      material.anisotropyRotation = 0.73
      material.normalScale.set(0.12, -0.17)
      material.clearcoatNormalScale.set(0.06, -0.04)
      material.map = new Texture()
      material.metalnessMap = material.roughnessMap
      material.clearcoatMap = new Texture()
      material.clearcoatRoughnessMap = new Texture()
      material.clearcoatNormalMap = new Texture()
      material.anisotropyMap = new Texture()
      material.onBeforeCompile = callback
      material.envMapIntensity = 0.2
      material.userData.sourceEnvMapIntensity = 0.74
      const authored = material.toJSON(),
        version = material.version,
        cacheKey = material.customProgramCacheKey()
      applyTypewriterFinishes(new Set([material]), 0.16)
      expect(material.toJSON()).toEqual({ ...authored, envMapIntensity: 0.74 })
      expect(material.version).toBe(version)
      expect(material.onBeforeCompile).toBe(callback)
      expect(material.customProgramCacheKey()).toBe(cacheKey)
      const resources = ownedResources()
      resources.track(material)
      resources.dispose()
    }
  })

  it('borrows shared maps without allocation or ownership hooks on repeated application', () => {
    const a = authoredSurface('chrome'),
      b = authoredSurface('edge'),
      resources = ownedResources()
    b.normalMap = a.normalMap
    b.roughnessMap = a.roughnessMap
    a.anisotropy = b.anisotropy = 0.22
    a.anisotropyMap = b.anisotropyMap = new Texture()
    resources.track([a, b])
    const maps = [a.normalMap!, a.roughnessMap!, a.anisotropyMap!],
      disposals = maps.map((map) => vi.spyOn(map, 'dispose')),
      versions = [a.version, b.version],
      generated = vi.spyOn(microMaps, 'createTypewriterMicroMaps')
    try {
      for (let i = 0; i < 5; i++) applyTypewriterFinishes(new Set([a, b]))
      expect(generated).not.toHaveBeenCalled()
      expect([a.version, b.version]).toEqual(versions)
      expect([b.normalMap, b.roughnessMap, b.anisotropyMap]).toEqual(maps)
      a.dispose()
      a.dispose()
      expect([a.normalMap, a.roughnessMap, a.anisotropyMap]).toEqual(maps)
      disposals.forEach((dispose) => expect(dispose).not.toHaveBeenCalled())
      resources.dispose()
      resources.dispose()
      disposals.forEach((dispose) => expect(dispose).toHaveBeenCalledTimes(1))
    } finally {
      generated.mockRestore()
    }
  })

  it.each([Number.NaN, Number.POSITIVE_INFINITY, '0.7', undefined])(
    'keeps authored environment intensity when the legacy restoration value is %s',
    (value) => {
      const material = authoredSurface('enamel')
      material.envMapIntensity = 0.91
      material.userData.sourceEnvMapIntensity = value
      applyTypewriterFinishes(new Set([material]))
      expect(material.envMapIntensity).toBe(0.91)
      const resources = ownedResources()
      resources.track(material)
      resources.dispose()
    },
  )

  it.each([1, '2', null, undefined])(
    'rejects an explicit invalid finish marker %s before v1 mutation',
    (version) => {
      const legacy = surface('shellGloss'),
        invalid = authoredSurface()
      legacy.envMapIntensity = 0.3
      legacy.userData.sourceEnvMapIntensity = 0.8
      invalid.userData.treesFinishVersion = version
      const initialVersion = legacy.version,
        initialRoughness = legacy.roughness
      expect(() => applyTypewriterFinishes(new Set([legacy, invalid]))).toThrow(
        'treesFinishVersion',
      )
      expect(legacy.roughness).toBe(initialRoughness)
      expect(legacy.envMapIntensity).toBe(0.3)
      expect(legacy.version).toBe(initialVersion)
      expect(legacy.normalMap).toBeNull()
      expect(legacy.roughnessMap).toBeNull()
      const resources = ownedResources()
      resources.track([legacy, invalid])
      resources.dispose()
    },
  )

  it.each(['normalMap', 'roughnessMap'] as const)(
    'rejects v2 with a missing %s instead of creating a replacement',
    (field) => {
      const material = authoredSurface('enamel'),
        resources = ownedResources()
      resources.track(material)
      material[field] = null
      expect(() => applyTypewriterFinishes(new Set([material]))).toThrow('缺少法线或粗糙度贴图')
      expect(material[field]).toBeNull()
      resources.dispose()
    },
  )

  it('requires a direction map for authored anisotropy and Physical material for v2', () => {
    const brushed = authoredSurface('steel'),
      standard = new MeshStandardMaterial(),
      unknown = authoredSurface('decal-6'),
      resources = ownedResources()
    brushed.anisotropy = 0.34
    standard.name = 'enamel'
    standard.userData.treesFinishVersion = 2
    expect(() => applyTypewriterFinishes(new Set([brushed]))).toThrow('缺少方向贴图')
    expect(() => applyTypewriterFinishes(new Set([standard]))).toThrow('需要 Physical 材质')
    expect(() => applyTypewriterFinishes(new Set([unknown]))).toThrow('未注册的材质名称')
    resources.track([brushed, standard, unknown])
    resources.dispose()
  })
})

describe('standard typewriter studio finishes', () => {
  it('keeps source color, maps, clearcoat normals and callbacks; does not replace or dispose the material', () => {
    const material = surface('shellGloss'),
      map = new Texture(),
      roughnessMap = new Texture(),
      normalMap = new Texture(),
      clearcoatMap = new Texture(),
      callback = vi.fn()
    material.color.set('#123456')
    material.map = map
    material.roughnessMap = roughnessMap
    material.normalMap = normalMap
    material.clearcoatNormalMap = clearcoatMap
    material.onBeforeCompile = callback
    material.userData.sourceEnvMapIntensity = 0.72
    const originalColor = material.color.clone(),
      uuid = material.uuid,
      key = material.customProgramCacheKey()
    const disposed = vi.spyOn(material, 'dispose')
    applyTypewriterFinishes(new Set([material]), 0.16)
    expect(material.uuid).toBe(uuid)
    expect(material.color.equals(originalColor)).toBe(true)
    expect([
      material.map,
      material.roughnessMap,
      material.normalMap,
      material.clearcoatNormalMap,
    ]).toEqual([map, roughnessMap, normalMap, clearcoatMap])
    expect(material.onBeforeCompile).toBe(callback)
    expect(material.customProgramCacheKey()).toBe(key)
    expect(material.metalness).toBeLessThan(0.05)
    expect(material.clearcoat).toBeGreaterThan(0.3)
    expect(material.clearcoatRoughness).toBeLessThan(material.roughness)
    expect(material.envMapIntensity).toBe(0.72)
    expect(disposed).not.toHaveBeenCalled()
    material.dispose()
    for (const texture of [map, roughnessMap, normalMap, clearcoatMap]) texture.dispose()
  })

  it('shares generated standard maps, preserves user trial color and allocates nothing on repeated application', () => {
    const materials = [
      surface('shellGloss'),
      surface('shellRim'),
      surface('chrome'),
      surface('goldEdge'),
    ]
    applyTypewriterFinishes(new Set(materials), 0.16)
    expect(materials[0]!.normalMap).toBe(materials[1]!.normalMap)
    expect(materials[2]!.normalMap).toBe(materials[3]!.normalMap)
    expect(materials[0]!.normalMap).not.toBe(materials[2]!.normalMap)
    const maps = materials.map((m) => [m.normalMap, m.roughnessMap])
    const versions = materials.map((m) => m.version)
    materials[0]!.color.set('#f0debc')
    applyTypewriterFinishes(new Set(materials), 0.16)
    expect(materials.map((m) => [m.normalMap, m.roughnessMap])).toEqual(maps)
    expect(materials.map((m) => m.version)).toEqual(versions)
    expect(materials[0]!.color.getHexString()).toBe('f0debc')
    for (const material of materials) {
      expect(material.onBeforeCompile).toBe(MeshStandardMaterial.prototype.onBeforeCompile)
      expect(material.normalScale.x).toBeLessThanOrEqual(0.09)
      material.dispose()
    }
  })

  it('releases generated maps once after the last shared material, independently from the source loader', () => {
    const a = surface('chrome'),
      b = surface('edge'),
      source = new Texture(),
      resources = ownedResources()
    a.map = source
    resources.track([a, b]) // Loader discovers original source assets before finish preparation.
    applyTypewriterFinishes(new Set([a, b]))
    const normal = a.normalMap!,
      roughness = a.roughnessMap!
    const normalDispose = vi.spyOn(normal, 'dispose'),
      roughnessDispose = vi.spyOn(roughness, 'dispose')
    const sourceDispose = vi.spyOn(source, 'dispose')
    a.dispose()
    a.dispose()
    expect(normalDispose).not.toHaveBeenCalled()
    expect(b.normalMap).toBe(normal)
    resources.dispose()
    resources.dispose()
    expect(normalDispose).toHaveBeenCalledTimes(1)
    expect(roughnessDispose).toHaveBeenCalledTimes(1)
    expect(sourceDispose).toHaveBeenCalledTimes(1)
    expect(a.normalMap).toBeNull()
    expect(b.normalMap).toBeNull()
  })

  it('keeps surfaces with incomplete source UVs clean, with no invented texture coordinates', () => {
    for (const name of ['enamel', 'steel']) {
      const material = surface(name),
        callback = material.onBeforeCompile
      applyTypewriterFinishes(new Set([material]), Number.NaN)
      expect(material.normalMap).toBeNull()
      expect(material.roughnessMap).toBeNull()
      expect(material.onBeforeCompile).toBe(callback)
      expect(material.anisotropy).toBe(0)
      material.dispose()
    }
  })

  it('keeps polished and brushed metals distinct while retaining metal color and metalness', () => {
    const materials = ['chrome', 'iron', 'edge', 'goldEdge', 'goldChrome'].map(surface)
    materials.forEach((m) => {
      m.metalness = 0.86
    })
    applyTypewriterFinishes(new Set(materials))
    expect(materials[0]!.roughness).toBeLessThan(materials[1]!.roughness)
    expect(materials[1]!.anisotropy).toBe(0)
    expect(materials[2]!.anisotropy).toBeGreaterThan(materials[0]!.anisotropy)
    for (const material of materials) {
      expect(material.metalness).toBe(0.86)
      expect(material.anisotropy).toBeLessThan(0.3)
      material.dispose()
    }
  })

  it('makes deterministic, subtly varying linear micro-maps with mipmaps and directional metal grain', () => {
    for (const kind of ['paint', 'brush', 'iron'] as const) {
      const a = createTypewriterMicroMaps(kind),
        b = createTypewriterMicroMaps(kind)
      expect(a.normal.image.data).toEqual(b.normal.image.data)
      expect(a.roughness.image.data).toEqual(b.roughness.image.data)
      for (const texture of [a.normal, a.roughness]) {
        expect(texture).toBeInstanceOf(DataTexture)
        expect(texture.colorSpace).toBe(NoColorSpace)
        expect(texture.wrapS).toBe(RepeatWrapping)
        expect(texture.wrapT).toBe(RepeatWrapping)
        expect(texture.generateMipmaps).toBe(true)
        expect(texture.minFilter).toBe(LinearMipmapLinearFilter)
      }
      const normal = a.normal.image.data,
        roughness = a.roughness.image.data
      if (!normal || !roughness) throw new Error('Generated micro-map pixels are missing')
      let xVariance = 0,
        yVariance = 0,
        minRoughness = 255,
        maxRoughness = 0
      for (let i = 0; i < normal.length; i += 4) {
        expect(normal[i + 2]).toBeGreaterThanOrEqual(253)
        minRoughness = Math.min(minRoughness, roughness[i + 1]!)
        maxRoughness = Math.max(maxRoughness, roughness[i + 1]!)
        xVariance += (normal[i]! - 127.5) ** 2
        yVariance += (normal[i + 1]! - 127.5) ** 2
      }
      expect(minRoughness).toBeGreaterThanOrEqual(246)
      expect(maxRoughness - minRoughness).toBeGreaterThan(0)
      expect(maxRoughness - minRoughness).toBeLessThanOrEqual(8)
      if (kind === 'brush') expect(xVariance).toBeGreaterThan(yVariance * 10)
      a.retain()
      b.retain()
      a.release()
      b.release()
    }
  })

  it('leaves decals, transparency and unrelated source callbacks unchanged', () => {
    const material = surface('decal-6'),
      map = new Texture(),
      callback = vi.fn()
    material.map = map
    material.transparent = true
    material.opacity = 0.7
    material.depthWrite = false
    material.roughness = 0.6
    material.onBeforeCompile = callback
    const version = material.version
    applyTypewriterFinishes(new Set([material]))
    expect(material.onBeforeCompile).toBe(callback)
    expect(material.version).toBe(version)
    expect(material.map).toBe(map)
    expect(material.transparent).toBe(true)
    expect(material.opacity).toBe(0.7)
    expect(material.depthWrite).toBe(false)
    expect(material.roughness).toBe(0.6)
    material.dispose()
    map.dispose()
  })

  it('verifies actual GLB UV coverage for every mapped material, and identifies the two unmapped mixed-UV materials', () => {
    const bytes = readFileSync(
      new URL('../../../public/models/bundles/kimi-typewriter/v1/model.glb', import.meta.url),
    )
    const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString()) as {
      materials: { name: string; extensions?: Record<string, unknown> }[]
      meshes: { primitives: { material: number; attributes: Record<string, number> }[] }[]
    }
    const primitives = gltf.meshes.flatMap((m) => m.primitives)
    for (const name of [
      'shellGloss',
      'shellRim',
      'iron',
      'chrome',
      'edge',
      'goldEdge',
      'goldChrome',
    ]) {
      const index = gltf.materials.findIndex((m) => m.name === name)
      const surfaces = primitives.filter((p) => p.material === index)
      expect(surfaces.length).toBeGreaterThan(0)
      expect(surfaces.every((p) => 'TEXCOORD_0' in p.attributes)).toBe(true)
    }
    for (const name of ['enamel', 'steel']) {
      const index = gltf.materials.findIndex((m) => m.name === name)
      expect(
        primitives.filter((p) => p.material === index).some((p) => !('TEXCOORD_0' in p.attributes)),
      ).toBe(true)
    }
  })
})
