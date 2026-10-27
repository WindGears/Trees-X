import { BoxGeometry, Color, Group, Mesh, MeshPhysicalMaterial, Texture } from 'three'
import { MeshPhysicalNodeMaterial, MeshStandardNodeMaterial } from 'three/webgpu'
import { describe, expect, it, vi } from 'vitest'
import { ownShowroomNativeMaterials } from './nativeMaterials'
import { createRealtimeMaterials } from '../realtime/materials'
import { coldStudioConfig } from './config'
import { setShowroomEnvironment } from './binding'
import { bindShowroomMaterials } from './materialBinding'

describe('cold-showroom native material ownership', () => {
  it('excludes emitter radiance only on locally lit cabin leather and restores its hook', () => {
    const scene = new Group(),
      root = new Group(),
      geometry = new BoxGeometry(),
      leather = new MeshPhysicalMaterial(),
      paint = new MeshPhysicalMaterial(),
      full = new Texture(),
      indirect = new Texture()
    leather.name = 'Reventon / fixed / 18661'
    leather.userData.source_vpb_material_id = 18661
    root.userData.carStudioCabinLighting = 'local'
    const cabin = new Mesh(geometry, leather),
      body = new Mesh(geometry, paint)
    root.add(cabin, body)
    scene.add(root)
    setShowroomEnvironment(scene, { texture: full, irradiance: indirect, config: coldStudioConfig })
    const owner = createRealtimeMaterials(scene)
    const cabinRuntime = cabin.material as unknown as MeshStandardNodeMaterial,
      bodyRuntime = body.material as unknown as MeshStandardNodeMaterial
    expect(Reflect.get(cabinRuntime.envNode!, 'value')).toBe(indirect)
    expect(Reflect.get(bodyRuntime.envNode!, 'value')).toBe(full)
    expect(cabinRuntime.envMap).toBeNull()
    owner.dispose()
    expect(cabin.material).toBe(leather)
    expect(leather.envMap).toBeNull()
    setShowroomEnvironment(scene)
    geometry.dispose()
    leather.dispose()
    paint.dispose()
    full.dispose()
    indirect.dispose()
  })
  it('keeps supported opaque and custom Node branches, converts unsupported source branches once and borrows maps', () => {
    const root = new Group(),
      geometry = new BoxGeometry(),
      map = new Texture(),
      supported = new MeshPhysicalMaterial(),
      custom = new MeshPhysicalNodeMaterial({ transmission: 1 }),
      unsupported = new MeshPhysicalMaterial({ specularIntensity: 0.22, map, clearcoat: 0.4 }),
      original = [supported, unsupported, custom],
      first = new Mesh(geometry, unsupported),
      second = new Mesh(geometry, original)
    root.add(first, second)
    const sourceDispose = vi.spyOn(unsupported, 'dispose'),
      mapDispose = vi.spyOn(map, 'dispose'),
      geometryDispose = vi.spyOn(geometry, 'dispose'),
      customDispose = vi.spyOn(custom, 'dispose'),
      owner = ownShowroomNativeMaterials(root),
      runtime = first.material as unknown as MeshPhysicalNodeMaterial
    expect(runtime).toBeInstanceOf(MeshPhysicalNodeMaterial)
    expect(runtime).not.toBe(unsupported)
    expect(Reflect.get(runtime, 'source')).toBe(unsupported)
    expect(second.material).toEqual([supported, runtime, custom])
    expect(runtime.map).toBe(map)
    expect(runtime.specularIntensity).toBe(0.22)
    expect(runtime.clearcoat).toBe(0.4)
    const runtimeDispose = vi.spyOn(runtime, 'dispose')
    unsupported.color.set('#446677')
    unsupported.emissive.set('#113344')
    unsupported.emissiveIntensity = 0.13
    unsupported.roughness = 0.8
    owner.sync()
    expect(runtime.color).toEqual(new Color('#446677'))
    expect(runtime.emissive).toEqual(new Color('#113344'))
    expect(runtime.emissiveIntensity).toBe(0.13)
    expect(runtime.roughness).toBe(0.8)
    owner.dispose()
    owner.dispose()
    expect(first.material).toBe(unsupported)
    expect(second.material).toBe(original)
    expect(runtimeDispose).toHaveBeenCalledTimes(1)
    for (const spy of [sourceDispose, mapDispose, geometryDispose, customDispose])
      expect(spy).not.toHaveBeenCalled()
    geometry.dispose()
    map.dispose()
    supported.dispose()
    unsupported.dispose()
    custom.dispose()
  })

  it('restores instance environment hooks before native runtimes are released and does not patch unrelated instances', () => {
    const scene = new Group(),
      geometry = new BoxGeometry(),
      source = new MeshPhysicalMaterial({ specularIntensity: 0.22 }),
      mesh = new Mesh(geometry, source),
      full = new Texture(),
      indirect = new Texture()
    scene.add(mesh)
    const owner = ownShowroomNativeMaterials(scene),
      runtime = mesh.material as unknown as MeshStandardNodeMaterial,
      nativeSetup = runtime.setupEnvironment
    setShowroomEnvironment(scene, { texture: full, irradiance: indirect, config: coldStudioConfig })
    const restore = bindShowroomMaterials(scene)
    expect(runtime.setupEnvironment).not.toBe(nativeSetup)
    expect(runtime.envMap).toBeNull()
    restore()
    expect(runtime.setupEnvironment).toBe(nativeSetup)
    owner.dispose()
    expect(mesh.material).toBe(source)
    setShowroomEnvironment(scene)
    geometry.dispose()
    source.dispose()
    full.dispose()
    indirect.dispose()
  })

  it('realtime bindings restore to native runtime before that owner restores the loader source', () => {
    const scene = new Group(),
      geometry = new BoxGeometry(),
      source = new MeshPhysicalMaterial({ specularIntensity: 0.22 }),
      mesh = new Mesh(geometry, [source]),
      full = new Texture(),
      indirect = new Texture()
    scene.add(mesh)
    const native = ownShowroomNativeMaterials(scene),
      nativeArray = mesh.material
    setShowroomEnvironment(scene, { texture: full, irradiance: indirect, config: coldStudioConfig })
    const realtime = createRealtimeMaterials(scene)
    expect(mesh.material[0]).toBe(nativeArray[0])
    realtime.restore()
    expect(mesh.material).toBe(nativeArray)
    native.dispose()
    expect(mesh.material[0]).toBe(source)
    realtime.dispose()
    setShowroomEnvironment(scene)
    geometry.dispose()
    source.dispose()
    full.dispose()
    indirect.dispose()
  })
})
