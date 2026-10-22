import { describe, expect, it, vi } from 'vitest'
import { Texture, Vector3 } from 'three'
import { EnvironmentNode, MeshPhysicalNodeMaterial } from 'three/webgpu'
import { coldStudioConfig } from './config'
import {
  createColdStudioEnvironmentNode,
  installColdStudioProjection,
  projectBoxDirection,
} from './projection'

describe('cold-studio box-projected environment', () => {
  it('projects a translated surface toward the same finite wall point', () => {
    const result = projectBoxDirection([2, 1, 0], [0, 0, 1], coldStudioConfig),
      expected = new Vector3(2, 1, 11)
        .sub(new Vector3(...coldStudioConfig.capture.position))
        .normalize()
    expect(new Vector3(...result).distanceTo(expected)).toBeLessThan(1e-12)
    expect(result[0]).toBeGreaterThan(0)
  })

  it('keeps the original direction at the capture origin and handles parallel/outside rays', () => {
    const direction = new Vector3(-0.8, 0.2, 0.4).normalize()
    const result = projectBoxDirection(
      coldStudioConfig.capture.position,
      direction.toArray(),
      coldStudioConfig,
    )
    expect(new Vector3(...result).distanceTo(direction)).toBeLessThan(1e-12)
    expect(projectBoxDirection([20, 2, 0], [0, 0, 1], coldStudioConfig)).toEqual([0, 0, 1])
    expect(projectBoxDirection([20, 2, 0], [1, 0, 0], coldStudioConfig)).toEqual([1, 0, 0])
    expect(projectBoxDirection([0, 1, 0], [0, 1, 0], coldStudioConfig).every(Number.isFinite)).toBe(
      true,
    )
  })

  it('hooks only one runtime material, leaves envMap null and restores its exact original descriptor', () => {
    const material = new MeshPhysicalNodeMaterial(),
      texture = new Texture(),
      untouched = new MeshPhysicalNodeMaterial()
    const original = material.setupEnvironment,
      version = material.version,
      releaseTexture = vi.spyOn(texture, 'dispose')
    const restore = installColdStudioProjection(material, texture, coldStudioConfig)
    expect(material.envMap).toBeNull()
    expect(material.envNode?.isNode).toBe(true)
    expect(Object.values(material).some((value) => value?.isNode)).toBe(true)
    expect(material.setupEnvironment).not.toBe(original)
    expect(material.version).toBe(version + 1)
    expect(untouched.setupEnvironment).toBe(original)
    expect(createColdStudioEnvironmentNode(texture, coldStudioConfig)).toBeInstanceOf(
      EnvironmentNode,
    )
    restore()
    restore()
    expect(material.setupEnvironment).toBe(original)
    expect(Object.hasOwn(material, 'setupEnvironment')).toBe(false)
    expect(material.envNode).toBeNull()
    expect(releaseTexture).not.toHaveBeenCalled()
    const own = { configurable: true, writable: true, value: () => null }
    Object.defineProperty(material, 'setupEnvironment', own)
    const releaseOwn = installColdStudioProjection(material, texture, coldStudioConfig)
    releaseOwn()
    expect(Object.getOwnPropertyDescriptor(material, 'setupEnvironment')).toEqual({
      ...own,
      enumerable: false,
    })
    material.dispose()
    untouched.dispose()
    texture.dispose()
  })

  it('binds indirect-only irradiance independently from the full-radiance source without taking ownership', () => {
    const full = new Texture(),
      indirect = new Texture(),
      material = new MeshPhysicalNodeMaterial(),
      node = createColdStudioEnvironmentNode(full, coldStudioConfig, indirect),
      fullDispose = vi.spyOn(full, 'dispose'),
      indirectDispose = vi.spyOn(indirect, 'dispose')
    expect(node.irradianceSource).toBe(indirect)
    expect(createColdStudioEnvironmentNode(full, coldStudioConfig).irradianceSource).toBe(full)
    const restore = installColdStudioProjection(material, full, coldStudioConfig, indirect)
    restore()
    expect(fullDispose).not.toHaveBeenCalled()
    expect(indirectDispose).not.toHaveBeenCalled()
    material.dispose()
    full.dispose()
    indirect.dispose()
  })
})
