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
import { ownedResources } from './ownedResources'

function surface(name: string) {
  const material = new MeshPhysicalMaterial()
  material.name = name
  return material
}

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
