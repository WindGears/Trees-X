import { describe, expect, it, vi } from 'vitest'
import {
  BoxGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Vector2,
  Vector4,
} from 'three'
import { createMotionHistory } from './motion'

function fixture(instanced = false) {
  const camera = new PerspectiveCamera(40, 1.44, 0.1, 100)
  camera.position.set(0, 0, 8)
  camera.lookAt(0, 0, 0)
  const root = new Group(),
    parent = new Group(),
    geometry = new BoxGeometry(),
    material = new MeshBasicMaterial()
  const mesh = instanced ? new InstancedMesh(geometry, material, 2) : new Mesh(geometry, material)
  if (mesh instanceof InstancedMesh) {
    mesh.setMatrixAt(0, new Matrix4())
    mesh.setMatrixAt(1, new Matrix4().makeTranslation(1, 0, 0))
  }
  parent.add(mesh)
  root.add(parent)
  const history = createMotionHistory(camera)
  const vertex = new Vector4(0, 0, 0, 1),
    motion = new Vector2()
  return { camera, root, parent, mesh, geometry, material, history, vertex, motion }
}

describe('complete-frame rigid motion history', () => {
  it('starts with zero velocity and preserves all camera projection offsets', () => {
    const f = fixture()
    f.camera.setViewOffset(1440, 1000, -80, 16, 1440, 1000)
    f.history.beginFrame(f.root)
    expect(f.history.sample(f.mesh, f.vertex, f.motion).length()).toBe(0)
    f.history.commitFrame()
    f.camera.setViewOffset(1440, 1000, 80, 16, 1440, 1000)
    f.history.beginFrame(f.root)
    expect(Math.abs(f.history.sample(f.mesh, f.vertex, f.motion).x)).toBeGreaterThan(0.1)
    expect(f.camera.view?.offsetX).toBe(80)
    f.history.commitFrame()
    f.history.beginFrame(f.root)
    expect(f.history.sample(f.mesh, f.vertex, f.motion).length()).toBe(0)
  })

  it('keeps parent and mesh transforms until one final commit, not per offscreen draw', () => {
    const f = fixture()
    f.history.beginFrame(f.root)
    f.history.commitFrame()
    f.parent.position.x = 1
    f.mesh.position.y = 0.5
    f.history.beginFrame(f.root)
    const x = f.history.sample(f.mesh, f.vertex, f.motion).x,
      y = f.motion.y
    expect(x).toBeGreaterThan(0)
    expect(y).toBeGreaterThan(0)
    for (let draw = 0; draw < 4; draw++) {
      expect(f.history.sample(f.mesh, f.vertex, f.motion).x).toBe(x)
      expect(f.motion.y).toBe(y)
    }
    expect(() => f.history.beginFrame(f.root)).toThrow('already open')
    f.history.commitFrame()
    f.history.beginFrame(f.root)
    expect(f.history.sample(f.mesh, f.vertex, f.motion).length()).toBe(0)
  })

  it('tracks per-instance motion and retains a snapshot across late source mutation', () => {
    const f = fixture(true)
    const mesh = f.mesh as InstancedMesh
    f.history.beginFrame(f.root)
    f.history.commitFrame()
    mesh.setMatrixAt(1, new Matrix4().makeTranslation(2, 0, 0))
    f.history.beginFrame(f.root)
    expect(f.history.sample(mesh, f.vertex, f.motion, 0).length()).toBe(0)
    const captured = f.history.sample(mesh, f.vertex, f.motion, 1).x
    expect(captured).toBeGreaterThan(0)
    // A diagnostic/auxiliary pass cannot replace the frame's captured pose.
    mesh.setMatrixAt(1, new Matrix4().makeTranslation(3, 0, 0))
    expect(f.history.sample(mesh, f.vertex, f.motion, 1).x).toBe(captured)
    f.history.commitFrame()
    f.history.beginFrame(f.root)
    expect(f.history.sample(mesh, f.vertex, f.motion, 1).x).toBeCloseTo(captured, 6)
    expect(f.history.stats()).toMatchObject({ instances: 2, historyBytes: 128 })
  })

  it('does not advance history after a failed frame and reset aligns a jump', () => {
    const f = fixture()
    f.history.beginFrame(f.root)
    f.history.commitFrame()
    f.mesh.position.x = 1
    f.history.beginFrame(f.root)
    const first = f.history.sample(f.mesh, f.vertex, f.motion).x
    f.history.cancelFrame()
    f.mesh.position.x = 2
    f.history.beginFrame(f.root)
    expect(f.history.sample(f.mesh, f.vertex, f.motion).x).toBeCloseTo(first * 2, 6)
    f.history.reset(f.root)
    expect(f.history.sample(f.mesh, f.vertex, f.motion).length()).toBe(0)
    expect(f.history.stats().frameOpen).toBe(false)
  })

  it('repeated pose round-trips do not drift or allocate history entries', () => {
    const f = fixture(true)
    const mesh = f.mesh as InstancedMesh,
      matrix = new Matrix4()
    f.history.reset(f.root)
    for (let cycle = 0; cycle < 50; cycle++) {
      mesh.setMatrixAt(1, matrix.makeRotationY(Math.PI / 2))
      f.history.beginFrame(f.root)
      f.history.commitFrame()
      mesh.setMatrixAt(1, matrix.makeTranslation(1, 0, 0))
      f.history.beginFrame(f.root)
      f.history.commitFrame()
    }
    f.history.beginFrame(f.root)
    expect(f.history.sample(mesh, f.vertex, f.motion, 1).length()).toBe(0)
    expect(f.history.stats()).toMatchObject({ objects: 1, instances: 2 })
  })

  it('prunes removed objects on topology reset without releasing loader resources', () => {
    const f = fixture(true)
    const geometryDispose = vi.spyOn(f.geometry, 'dispose'),
      materialDispose = vi.spyOn(f.material, 'dispose')
    f.history.reset(f.root)
    f.mesh.removeFromParent()
    f.history.reset(f.root)
    expect(f.history.stats()).toMatchObject({ objects: 0, instances: 0 })
    f.history.dispose()
    f.history.dispose()
    expect(geometryDispose).not.toHaveBeenCalled()
    expect(materialDispose).not.toHaveBeenCalled()
    expect(() => f.history.beginFrame(f.root)).toThrow('disposed')
  })

  it('rejects a capacity above the guaranteed uniform binding limit', () => {
    const f = fixture()
    f.root.add(new InstancedMesh(f.geometry, f.material, 1025))
    expect(() => f.history.beginFrame(f.root)).toThrow('at most 1024')
  })
})
