import {
  Box3,
  BoxGeometry,
  Group,
  HalfFloatType,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  NoColorSpace,
  PerspectiveCamera,
  RenderTarget,
  Scene,
  Vector3,
} from 'three'
import { NodeMaterial, QuadMesh, type NodeBuilder } from 'three/webgpu'
import { float, vec4 } from 'three/tsl'
import GaussianBlurNode from 'three/addons/tsl/display/GaussianBlurNode.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLoungeDofFocus, createOwnedLoungeDof, resolveLoungeDof } from './loungeSpatialDof'
import { createOwnedRtt } from './realtime/ownedRtt'

afterEach(() => vi.restoreAllMocks())

function fixture(enabled = true) {
  const scene = new Scene(),
    root = new Group(),
    camera = new PerspectiveCamera(38, 1.5, 0.05, 250),
    geometry = new BoxGeometry(2, 2, 2),
    material = new MeshBasicMaterial(),
    mesh = new Mesh(geometry, material)
  root.userData.workbenchProduct = 'typewriter-study'
  root.add(mesh)
  scene.add(root)
  camera.position.set(0, 0, 10)
  const focus = createLoungeDofFocus(scene, camera, enabled)
  return {
    scene,
    root,
    camera,
    geometry,
    material,
    mesh,
    focus,
    dispose() {
      focus.dispose()
      geometry.dispose()
      material.dispose()
    },
  }
}

describe('experimental spatial lounge depth of field', () => {
  it('requires an explicit spatial projection and exact DOF opt-in', () => {
    for (const query of [
      '',
      '?loungeDof=1',
      '?loungeSpatial=box',
      '?loungeSpatial=depth',
      '?loungeSpatial=infinite&loungeDof=1',
      '?loungeSpatial=box&loungeDof=true',
      '?loungeSpatial=depth&loungeDof=0',
    ])
      expect(resolveLoungeDof(query)).toBe(false)
    expect(resolveLoungeDof('?loungeSpatial=box&loungeDof=1')).toBe(true)
    expect(resolveLoungeDof('?loungeSpatial=depth&loungeDof=1')).toBe(true)
  })

  it('does no product bounds work when disabled and owns only its metadata', () => {
    const f = fixture(false),
      compute = vi.spyOn(f.geometry, 'computeBoundingBox'),
      dispose = vi.spyOn(f.geometry, 'dispose')
    f.focus.prepare()
    expect(f.scene.userData.loungeDof).toBe(f.focus.metadata)
    expect(f.focus.metadata).toMatchObject({ enabled: false, active: false, boundsUpdates: 0 })
    expect(compute).not.toHaveBeenCalled()
    f.focus.dispose()
    f.focus.dispose()
    expect(f.scene.userData.loungeDof).toBeUndefined()
    expect(dispose).not.toHaveBeenCalled()
    f.dispose()
  })

  it('encloses all eight current world-box corners along camera Z without changing projection', () => {
    const f = fixture(),
      backdrop = new Mesh(new BoxGeometry(100, 100, 100), f.material)
    f.root.position.set(1.2, 0.5, -0.7)
    f.root.rotation.set(0.3, 0.6, -0.2)
    f.scene.add(backdrop)
    f.camera.position.set(6, 3, 8)
    f.camera.lookAt(f.root.position)
    f.camera.setViewOffset(1500, 1000, 100, 0, 1400, 1000)
    const projection = f.camera.projectionMatrix.clone()
    f.focus.prepare()
    const box = new Box3().setFromObject(f.root)
    let near = Infinity,
      far = -Infinity
    for (let index = 0; index < 8; index++) {
      const corner = new Vector3(
        index & 1 ? box.max.x : box.min.x,
        index & 2 ? box.max.y : box.min.y,
        index & 4 ? box.max.z : box.min.z,
      ).applyMatrix4(f.camera.matrixWorldInverse)
      near = Math.min(near, -corner.z)
      far = Math.max(far, -corner.z)
    }
    expect(f.focus.metadata.active).toBe(true)
    expect(f.focus.metadata.near).toBeLessThan(near)
    expect(f.focus.metadata.far).toBeGreaterThan(far)
    expect(f.focus.metadata.far).toBeLessThan(30)
    expect(f.focus.metadata.focus).toBeCloseTo((near + far) * 0.5)
    expect(f.camera.projectionMatrix.equals(projection)).toBe(true)
    expect(f.focus.metadata.boundsUpdates).toBe(1)
    f.focus.prepare()
    expect(f.focus.metadata.boundsUpdates).toBe(1)
    const focusBeforeOrbit = f.focus.metadata.focus
    f.camera.position.z += 2
    f.camera.lookAt(f.root.position)
    f.focus.prepare()
    expect(f.focus.metadata.boundsUpdates).toBe(1)
    expect(f.focus.metadata.focus).not.toBe(focusBeforeOrbit)
    backdrop.geometry.dispose()
    f.dispose()
  })

  it('refreshes stale instance boxes as expanded parts and strikes change matrices', () => {
    const f = fixture(),
      instances = new InstancedMesh(f.geometry, f.material, 2),
      matrix = new Matrix4()
    f.mesh.removeFromParent()
    instances.setMatrixAt(0, matrix)
    instances.setMatrixAt(1, matrix.makeTranslation(0, 0, -1))
    instances.instanceMatrix.needsUpdate = true
    f.root.add(instances)
    const compute = vi.spyOn(instances, 'computeBoundingBox')
    f.focus.prepare()
    const originalFar = f.focus.metadata.far
    expect(compute).toHaveBeenCalledTimes(1)
    f.focus.prepare()
    expect(compute).toHaveBeenCalledTimes(1)
    instances.setMatrixAt(1, matrix.makeTranslation(0, 4, -7))
    instances.instanceMatrix.needsUpdate = true
    f.focus.prepare()
    expect(compute).toHaveBeenCalledTimes(2)
    expect(instances.boundingBox!.min.z).toBe(-8)
    expect(f.focus.metadata.far).toBeGreaterThan(18)
    expect(f.focus.metadata.far).toBeGreaterThan(originalFar)
    expect(f.focus.falloff.value).toBeGreaterThan(3)
    expect(f.focus.metadata.boundsUpdates).toBe(2)
    // A world transform invalidates the root box even without instance changes.
    f.root.position.z = -3
    f.focus.prepare()
    expect(f.focus.metadata.far).toBeGreaterThan(21)
    expect(compute).toHaveBeenCalledTimes(2)
    instances.dispose()
    f.dispose()
  })

  it('clears stale focus on unload and finds the next actual product root', () => {
    const f = fixture()
    f.focus.prepare()
    expect(f.focus.metadata.active).toBe(true)
    f.root.removeFromParent()
    f.focus.prepare()
    expect(f.focus.metadata).toMatchObject({ enabled: true, active: false, far: 250 })
    const next = new Group()
    next.userData.workbenchProduct = 'typewriter-study'
    next.position.z = -4
    next.add(f.mesh)
    f.scene.add(next)
    f.focus.prepare()
    expect(f.focus.metadata.active).toBe(true)
    expect(f.focus.metadata.focus).toBeCloseTo(14)
    // An empty product cannot leave blur active against a former product plane.
    next.clear()
    next.removeFromParent()
    f.scene.add(f.root)
    f.focus.prepare()
    expect(f.focus.metadata.active).toBe(false)
    f.dispose()
  })
})

describe('official r185 DOF owned resources', () => {
  const builder = {
    getSharedContext: () => ({}),
    getNodeProperties: () => ({}),
  } as unknown as NodeBuilder

  function privateMaterial(object: object, name: string) {
    const value: unknown = Reflect.get(object, name)
    if (!(value instanceof NodeMaterial)) throw new Error('Missing tested DOF material ' + name)
    return value
  }

  function privateTarget(object: object, name: string) {
    const value: unknown = Reflect.get(object, name)
    if (!(value instanceof RenderTarget)) throw new Error('Missing tested DOF target ' + name)
    return value
  }

  it('borrows explicit HDR input and releases official targets, materials and Gaussian children once', () => {
    const f = fixture(),
      hdr = createOwnedRtt(vec4(4, 2, 1, 1)),
      hdrRelease = vi.spyOn(hdr.node.renderTarget!, 'dispose'),
      owner = createOwnedLoungeDof(hdr.node, float(-10), f.focus),
      sharedQuad = new QuadMesh(),
      quadRelease = vi.spyOn(sharedQuad.geometry, 'dispose'),
      targets = [
        '_CoCRT',
        '_CoCBlurredRT',
        '_blur64RT',
        '_blur16NearRT',
        '_blur16FarRT',
        '_compositeRT',
      ].map((name) => privateTarget(owner.effect, name)),
      materials = [
        '_CoCMaterial',
        '_CoCBlurredMaterial',
        '_blur64Material',
        '_blur16Material',
        '_compositeMaterial',
      ].map((name) => privateMaterial(owner.effect, name)),
      releases = [...targets, ...materials].map((resource) => vi.spyOn(resource, 'dispose'))
    expect(owner.effect.textureNode).toBe(hdr.node)
    expect(hdr.node.value.type).toBe(HalfFloatType)
    expect(hdr.node.value.colorSpace).toBe(NoColorSpace)
    expect(owner.effect.focusDistanceNode).toBe(f.focus.focus)
    expect(owner.effect.focalLengthNode).toBe(f.focus.falloff)
    // Full-resolution clear pixels select the untouched corrected HDR texture.
    expect(Reflect.get(owner.node, 'elseNode')).toBe(hdr.node)
    owner.effect.setup(builder)
    const blur = privateMaterial(owner.effect, '_CoCBlurredMaterial').colorNode
    expect(blur).toBeInstanceOf(GaussianBlurNode)
    if (!(blur instanceof GaussianBlurNode)) throw new Error('Missing Gaussian child')
    blur.setup(builder)
    const childReleases = [
      privateTarget(blur, '_horizontalRT'),
      privateTarget(blur, '_verticalRT'),
      privateMaterial(blur, '_material'),
    ].map((resource) => vi.spyOn(resource, 'dispose'))
    owner.dispose()
    owner.dispose()
    for (const release of [...releases, ...childReleases]) expect(release).toHaveBeenCalledTimes(1)
    expect(hdrRelease).not.toHaveBeenCalled()
    expect(quadRelease).not.toHaveBeenCalled()
    hdr.dispose()
    expect(hdrRelease).toHaveBeenCalledTimes(1)
    f.dispose()
  })

  it('releases a Gaussian child before setup replaces it and handles disposal before setup', () => {
    const f = fixture(),
      hdr = createOwnedRtt(vec4(1)),
      owner = createOwnedLoungeDof(hdr.node, float(-10), f.focus)
    owner.effect.setup(builder)
    const first = privateMaterial(owner.effect, '_CoCBlurredMaterial').colorNode
    if (!(first instanceof GaussianBlurNode)) throw new Error('Missing Gaussian child')
    const release = vi.spyOn(first, 'dispose')
    owner.effect.setup(builder)
    expect(release).toHaveBeenCalledTimes(1)
    owner.dispose()
    expect(release).toHaveBeenCalledTimes(1)
    const unbuilt = createOwnedLoungeDof(hdr.node, float(-10), f.focus)
    unbuilt.dispose()
    expect(() => createOwnedLoungeDof(hdr.node, float(-10), f.focus, '186')).toThrow(
      'must be reviewed',
    )
    hdr.dispose()
    f.dispose()
  })
})
