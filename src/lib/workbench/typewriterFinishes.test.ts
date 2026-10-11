import { readFileSync } from 'node:fs'
import {
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  ShaderLib,
  Texture,
  UniformsUtils,
  type WebGLRenderer,
} from 'three'
import { describe, expect, it, vi } from 'vitest'
import { applyTypewriterFinishes } from './typewriterFinishes'

function surface(name: string, physical = true) {
  const material = physical ? new MeshPhysicalMaterial() : new MeshStandardMaterial()
  material.name = name
  return material
}

function shaderFor(material: MeshStandardMaterial) {
  const source = ShaderLib.physical
  const shader = {
    vertexShader: source.vertexShader,
    fragmentShader: source.fragmentShader,
    uniforms: UniformsUtils.clone(source.uniforms),
  }
  material.onBeforeCompile(
    shader as Parameters<MeshStandardMaterial['onBeforeCompile']>[0],
    {} as WebGLRenderer,
  )
  return shader
}

describe('typewriter studio finishes', () => {
  it('adds restrained dielectric paint and a distinct smooth clearcoat without changing color or maps', () => {
    for (const name of ['enamel', 'shellGloss', 'shellRim']) {
      const material = new MeshPhysicalMaterial(),
        colorMap = new Texture(),
        roughnessMap = new Texture(),
        normalMap = new Texture(),
        clearcoatNormalMap = new Texture(),
        disposed = vi.fn()
      material.name = name
      material.color.set('#123456')
      material.map = colorMap
      material.roughnessMap = roughnessMap
      material.normalMap = normalMap
      material.clearcoatNormalMap = clearcoatNormalMap
      material.userData.sourceEnvMapIntensity = 0.72
      const originalColor = material.color.clone(),
        originalUuid = material.uuid
      material.addEventListener('dispose', disposed)
      try {
        applyTypewriterFinishes(new Set([material]), 0.16)
        expect(material.uuid).toBe(originalUuid)
        expect(material.color.equals(originalColor)).toBe(true)
        expect(material.map).toBe(colorMap)
        expect(material.roughnessMap).toBe(roughnessMap)
        expect(material.normalMap).toBe(normalMap)
        expect(material.clearcoatNormalMap).toBe(clearcoatNormalMap)
        expect(material.metalness).toBeLessThan(0.05)
        expect(material.clearcoat).toBeGreaterThan(0.3)
        expect(material.clearcoat).toBeLessThan(0.9)
        expect(material.clearcoatRoughness).toBeLessThan(material.roughness)
        expect(material.roughness).toBeGreaterThan(0.2)
        expect(material.envMapIntensity).toBe(0.72)
        expect(disposed).not.toHaveBeenCalled()
      } finally {
        material.dispose()
        colorMap.dispose()
        roughnessMap.dispose()
        normalMap.dispose()
        clearcoatNormalMap.dispose()
      }
    }
  })

  it('retains user appearance on repeated application and does not recompile or duplicate shader hooks', () => {
    const material = surface('enamel')
    try {
      applyTypewriterFinishes(new Set([material]), 0.16)
      const original = shaderFor(material),
        version = material.version
      material.color.set('#f0debc')
      const selectedColor = material.color.clone()
      applyTypewriterFinishes(new Set([material]), 0.16)
      const repeated = shaderFor(material)
      expect(material.version).toBe(version)
      expect(material.color.equals(selectedColor)).toBe(true)
      expect(repeated.vertexShader).toBe(original.vertexShader)
      expect(repeated.fragmentShader).toBe(original.fragmentShader)
      expect(repeated.uniforms.typewriterWorldScale?.value).toBe(0.16)
      expect(repeated.vertexShader.match(/varying vec3 vTypewriterFinish;/g)).toHaveLength(1)
      expect(repeated.fragmentShader.match(/float typewriterPaintRelief\(/g)).toHaveLength(1)
      expect(repeated.fragmentShader).toContain('#include <normal_fragment_maps>')
      expect(repeated.fragmentShader).toContain('#include <roughnessmap_fragment>')
      expect(repeated.fragmentShader).not.toContain('diffuseColor.rgb*=')
      expect(repeated.fragmentShader).toContain('smoothstep(.009,.030,footprint)')
      // Wide studio highlights must stay smooth, with a small orange-peel layer
      // rather than the earlier coarse grain that read as leather.
      expect(repeated.fragmentShader).toContain('(grain-.5)*.00008')
      expect(repeated.fragmentShader).toContain('(pore-.5)*.000018')
    } finally {
      material.dispose()
    }
  })

  it('distinguishes polished metals and rough iron, with modest anisotropy only on supported surfaces', () => {
    const names = ['steel', 'chrome', 'iron', 'edge', 'goldEdge', 'goldChrome'],
      materials = names.map((name) => {
        const material = new MeshPhysicalMaterial({ metalness: 0.86 })
        material.name = name
        return material
      })
    try {
      applyTypewriterFinishes(new Set(materials), 0.16)
      expect(materials[1]!.roughness).toBeLessThan(materials[2]!.roughness)
      for (const material of materials) {
        expect(material.metalness).toBe(0.86)
        expect(material.anisotropy).toBeLessThan(0.3)
        expect(material.anisotropy).toBeGreaterThanOrEqual(0)
        const shader = shaderFor(material)
        expect(shader.fragmentShader).toContain('fwidth(linePhase)')
        expect(shader.uniforms.typewriterFinishVariation?.value).toBeLessThan(0.03)
        expect(material.customProgramCacheKey()).not.toBe('trees-typewriter-paint-v2')
      }
      expect(materials[0]!.anisotropy).toBe(0)
      expect(materials[2]!.anisotropy).toBe(0)
      expect(materials[1]!.anisotropy).toBeGreaterThan(0)
    } finally {
      materials.forEach((material) => material.dispose())
    }
  })

  it('leaves decals and unrelated surfaces intact, including transparency and their existing callbacks', () => {
    const material = surface('decal-6'),
      map = new Texture(),
      originalCallback = vi.fn()
    material.map = map
    material.transparent = true
    material.opacity = 0.7
    material.depthWrite = false
    material.roughness = 0.6
    material.onBeforeCompile = originalCallback
    const key = material.customProgramCacheKey(),
      version = material.version
    try {
      applyTypewriterFinishes(new Set([material]))
      expect(material.onBeforeCompile).toBe(originalCallback)
      expect(material.customProgramCacheKey()).toBe(key)
      expect(material.version).toBe(version)
      expect(material.map).toBe(map)
      expect(material.transparent).toBe(true)
      expect(material.opacity).toBe(0.7)
      expect(material.depthWrite).toBe(false)
      expect(material.roughness).toBe(0.6)
    } finally {
      material.dispose()
      map.dispose()
    }
  })

  it('supports standard material fixtures without replacing them and guards invalid scale uniforms', () => {
    const material = surface('enamel', false)
    try {
      applyTypewriterFinishes(new Set([material]), Number.NaN)
      expect(material).not.toBeInstanceOf(MeshPhysicalMaterial)
      expect(shaderFor(material).uniforms.typewriterWorldScale?.value).toBe(1)
      applyTypewriterFinishes(new Set([material]), 2)
      expect(shaderFor(material).uniforms.typewriterWorldScale?.value).toBe(2)
    } finally {
      material.dispose()
    }
  })

  it('checks the actual GLB paint layers and UVs required by the anisotropic source surfaces', () => {
    const bytes = readFileSync(
      new URL('../../../public/models/bundles/kimi-typewriter/v1/model.glb', import.meta.url),
    )
    const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString()) as {
      materials: { name: string; extensions?: Record<string, unknown> }[]
      meshes: { primitives: { material: number; attributes: Record<string, number> }[] }[]
    }
    for (const name of ['enamel', 'shellGloss', 'shellRim'])
      expect(gltf.materials.find((item) => item.name === name)?.extensions).toHaveProperty(
        'KHR_materials_clearcoat',
      )
    for (const name of ['chrome', 'edge', 'goldEdge', 'goldChrome']) {
      const index = gltf.materials.findIndex((item) => item.name === name),
        surfaces = gltf.meshes
          .flatMap((mesh) => mesh.primitives)
          .filter((primitive) => primitive.material === index)
      expect(index).toBeGreaterThanOrEqual(0)
      expect(surfaces.length).toBeGreaterThan(0)
      expect(surfaces.every((primitive) => 'TEXCOORD_0' in primitive.attributes)).toBe(true)
    }
  })
})
