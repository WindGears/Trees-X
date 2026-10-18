import {
  Camera,
  Group,
  Matrix4,
  MeshBasicMaterial,
  OrthographicCamera,
  PerspectiveCamera,
  Scene,
  Vector2,
  Vector3,
  WebGPUCoordinateSystem,
  type RenderTarget,
} from 'three'
import { NodeFrame } from 'three/webgpu'
import { reflector } from 'three/tsl'
import { describe, expect, it } from 'vitest'
import type ReflectorNode from 'three/src/nodes/utils/ReflectorNode.js'
import { bindReflectionProjection } from './reflectionProjection'
import { createGpuStudioReflection } from './studioReflection'

function fixture() {
  const node = reflector({ resolutionScale: 0.75, bounces: false }),
    camera = new PerspectiveCamera(40, 1.44, 0.1, 100),
    scene = new Scene(),
    material = new MeshBasicMaterial(),
    frame = new NodeFrame(),
    groundY = -0.0192
  camera.coordinateSystem = WebGPUCoordinateSystem
  camera.position.set(2.2, 2.8, 4.6)
  camera.lookAt(0, 0.5, 0)
  node.target.rotation.x = -Math.PI / 2
  node.target.position.y = groundY
  scene.add(node.target)
  scene.updateMatrixWorld(true)
  let target: RenderTarget | null = null
  const captures: Camera[] = []
  const renderer = {
    coordinateSystem: WebGPUCoordinateSystem,
    autoClear: false,
    getDrawingBufferSize(size: Vector2) {
      return size.set(1440, 1000)
    },
    getRenderTarget() {
      return target
    },
    setRenderTarget(next: RenderTarget | null) {
      target = next
    },
    getMRT() {
      return null
    },
    setMRT() {},
    render(_scene: Scene, virtual: Camera) {
      captures.push(virtual)
    },
    clear() {},
  }
  // Only the synchronous methods used by the actual r185 ReflectorBaseNode are needed.
  frame.renderer = renderer as unknown as NodeFrame['renderer']
  frame.scene = scene
  frame.camera = camera
  frame.material = material
  return {
    node,
    camera,
    renderer,
    material,
    groundY,
    draw() {
      camera.updateMatrixWorld()
      captures.length = 0
      node.reflector.updateBefore(frame)
      const captured = captures.at(-1)
      if (!captured) throw new Error('Actual Three reflector did not submit a capture')
      return captured
    },
    dispose() {
      node.dispose()
      material.dispose()
    },
  }
}

function mirrorError(point: Vector3, camera: Camera, virtual: Camera, groundY: number) {
  const expected = point
      .clone()
      .setY(2 * groundY - point.y)
      .project(camera),
    actual = point.clone().project(virtual)
  return new Vector2((-actual.x - expected.x) * 720, (actual.y - expected.y) * 500)
}

describe('off-axis planar reflection projection', () => {
  it('reproduces the real upstream error of twice the horizontal UI view offset', () => {
    const f = fixture()
    try {
      for (const offset of [-222, -58, -56, 0, 108, 182]) {
        f.camera.setViewOffset(1440, 1000, offset, 16, 1440, 1000)
        const error = mirrorError(new Vector3(0.6, 0.9, 0.2), f.camera, f.draw(), f.groundY)
        expect(error.x).toBeCloseTo(2 * offset, 8)
        expect(error.y).toBeCloseTo(0, 8)
      }
    } finally {
      f.dispose()
    }
  })

  it('aligns the actual upstream capture across panel offsets, zoom and observation poses', () => {
    const f = fixture(),
      release = bindReflectionProjection(f.node),
      poses = [new Vector3(2.2, 2.8, 4.6), new Vector3(-3.2, 1.3, 2), new Vector3(0, 5, 0.8)],
      points = [new Vector3(0.6, 0.9, 0.2), new Vector3(-1, 0.25, -0.2)]
    try {
      for (const pose of poses)
        for (const zoom of [0.55, 1, 1.4])
          for (const offset of [-222, -58, -56, 0, 108, 182])
            for (const vertical of [16, 28]) {
              f.camera.position.copy(pose)
              f.camera.lookAt(0, 0.5, 0)
              f.camera.zoom = zoom
              f.camera.setViewOffset(1440, 1000, offset, vertical, 1440, 1000)
              const virtual = f.draw()
              expect(virtual.projectionMatrix.elements[8]).toBe(
                -f.camera.projectionMatrix.elements[8]!,
              )
              expect(virtual.projectionMatrix.elements[9]).toBe(
                f.camera.projectionMatrix.elements[9],
              )
              // The original oblique near-plane modification still ran after our horizontal correction.
              expect(virtual.projectionMatrix.elements[6]).not.toBe(0)
              expect(new Vector3(0, f.groundY, 0).project(virtual).z).toBeCloseTo(0, 10)
              for (const point of points) {
                const error = mirrorError(point, f.camera, virtual, f.groundY)
                expect(Math.abs(error.x)).toBeLessThan(1e-8)
                expect(Math.abs(error.y)).toBeLessThan(1e-8)
              }
            }
    } finally {
      release()
      f.dispose()
    }
  })

  it('leaves the source camera and unrelated matrix copies unchanged and restores local methods', () => {
    const f = fixture(),
      originalGetter = f.node.reflector.getVirtualCamera,
      release = bindReflectionProjection(f.node)
    try {
      f.camera.setViewOffset(1440, 1000, 108, 16, 1440, 1000)
      f.camera.updateMatrixWorld()
      const projection = f.camera.projectionMatrix.clone(),
        inverse = f.camera.projectionMatrixInverse.clone(),
        world = f.camera.matrixWorld.clone(),
        position = f.camera.position.clone(),
        view = { ...f.camera.view },
        virtual = f.draw(),
        unrelated = new Matrix4().makeTranslation(1, 2, 3)
      expect(f.camera.projectionMatrix).toEqual(projection)
      expect(f.camera.projectionMatrixInverse).toEqual(inverse)
      expect(f.camera.matrixWorld).toEqual(world)
      expect(f.camera.position).toEqual(position)
      expect(f.camera.view).toEqual(view)
      virtual.projectionMatrix.copy(unrelated)
      expect(virtual.projectionMatrix.elements).toEqual(unrelated.elements)
      expect(Object.hasOwn(virtual.projectionMatrix, 'copy')).toBe(true)
      release()
      release()
      expect(f.node.reflector.getVirtualCamera).toBe(originalGetter)
      expect(Object.hasOwn(f.node.reflector, 'getVirtualCamera')).toBe(false)
      expect(Object.hasOwn(virtual.projectionMatrix, 'copy')).toBe(false)
      expect(mirrorError(new Vector3(0.6, 0.9, 0.2), f.camera, f.draw(), f.groundY).x).toBeCloseTo(
        216,
        8,
      )
      const rebind = bindReflectionProjection(f.node)
      rebind()
    } finally {
      release()
      f.dispose()
    }
  })

  it('rejects unknown versions, changed private shapes, unsupported cameras and duplicate ownership', () => {
    const f = fixture()
    try {
      expect(() => bindReflectionProjection(f.node, '186')).toThrow('r185')
      expect(() => bindReflectionProjection({ reflector: {} } as unknown as ReflectorNode)).toThrow(
        'internals',
      )
      const release = bindReflectionProjection(f.node)
      expect(() => bindReflectionProjection(f.node)).toThrow('already owns')
      expect(() => f.node.reflector.getVirtualCamera(new OrthographicCamera())).toThrow(
        'PerspectiveCamera',
      )
      release()
    } finally {
      f.dispose()
    }
  })

  it('owns each virtual matrix locally and restores every camera without touching prototypes', () => {
    const f = fixture(),
      nativeCopy = Matrix4.prototype.copy,
      nativeGetter = Object.getPrototypeOf(f.node.reflector).getVirtualCamera,
      second = f.camera.clone(),
      release = bindReflectionProjection(f.node)
    try {
      f.camera.setViewOffset(1440, 1000, -58, 16, 1440, 1000)
      second.setViewOffset(1440, 1000, 108, 28, 1440, 1000)
      const firstVirtual = f.node.reflector.getVirtualCamera(f.camera),
        secondVirtual = f.node.reflector.getVirtualCamera(second)
      expect(firstVirtual).not.toBe(secondVirtual)
      firstVirtual.projectionMatrix.copy(f.camera.projectionMatrix)
      secondVirtual.projectionMatrix.copy(second.projectionMatrix)
      expect(firstVirtual.projectionMatrix.elements[8]).toBe(
        -f.camera.projectionMatrix.elements[8]!,
      )
      expect(secondVirtual.projectionMatrix.elements[8]).toBe(-second.projectionMatrix.elements[8]!)
      expect(Matrix4.prototype.copy).toBe(nativeCopy)
      expect(Object.getPrototypeOf(f.node.reflector).getVirtualCamera).toBe(nativeGetter)
      release()
      expect(firstVirtual.projectionMatrix.copy).toBe(nativeCopy)
      expect(secondVirtual.projectionMatrix.copy).toBe(nativeCopy)
    } finally {
      release()
      f.dispose()
    }
  })

  it.each([false, true])(
    'installs and releases the projection bridge in the real studio factory (product capture: %s)',
    (productCapture) => {
      const reflection = createGpuStudioReflection(
          undefined,
          undefined,
          undefined,
          productCapture ? new Group() : undefined,
        ),
        bases = new Map<ReflectorNode['reflector'], ReflectorNode>(),
        camera = new PerspectiveCamera(40, 1.44, 0.1, 100)
      try {
        for (const root of [
          reflection.mesh.material.colorNode,
          reflection.mesh.material.opacityNode,
        ])
          root?.traverse((node) => {
            if (node.type !== 'ReflectorNode') return
            const reflected = node as ReflectorNode
            bases.set(reflected.reflector, reflected)
          })
        expect(bases.size).toBe(1)
        const reflected = [...bases.values()][0]
        if (!reflected) throw new Error('Studio material did not contain its actual reflector')
        const base = reflected.reflector,
          nativeGetter = Object.getPrototypeOf(base).getVirtualCamera
        expect(reflection.mesh.children).toContain(base.target)
        expect(base.getVirtualCamera).not.toBe(nativeGetter)
        expect(() => bindReflectionProjection(reflected)).toThrow('already owns')
        camera.setViewOffset(1440, 1000, 108, 16, 1440, 1000)
        const virtual = base.getVirtualCamera(camera)
        virtual.projectionMatrix.copy(camera.projectionMatrix)
        expect(virtual.projectionMatrix.elements[8]).toBe(-camera.projectionMatrix.elements[8]!)
        expect(virtual.projectionMatrix.elements[9]).toBe(camera.projectionMatrix.elements[9])
        reflection.dispose()
        expect(base.getVirtualCamera).toBe(nativeGetter)
        expect(virtual.projectionMatrix.copy).toBe(Matrix4.prototype.copy)
        expect(Object.hasOwn(base, 'getVirtualCamera')).toBe(false)
        const rebind = bindReflectionProjection(reflected)
        rebind()
      } finally {
        reflection.dispose()
      }
    },
  )
})
