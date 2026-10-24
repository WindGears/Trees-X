import {
  Box3,
  Group,
  Material,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  PerspectiveCamera,
  Raycaster,
  Scene,
  Texture,
  Vector3,
  type WebGLRenderer,
} from 'three'
import { type MeshStandardNodeMaterial, type UniformNode } from 'three/webgpu'
import { describe, expect, it, vi } from 'vitest'
import { coldStudioConfig } from './config'
import { createColdStudioGeometry } from './geometry'
import { createShowroomCutaway } from './fade'

describe('cold studio authored geometry', () => {
  it('exposes each light diffuser before its housing from the capture position', () => {
    const room = createColdStudioGeometry(),
      origin = new Vector3().fromArray(coldStudioConfig.capture.position),
      ray = new Raycaster()
    for (const panel of room.panels) {
      ray.set(origin, new Vector3().subVectors(panel.position, origin).normalize())
      const hits = ray.intersectObject(room.root, true)
      expect(hits[0]!.object).toBe(panel)
    }
    room.dispose()
  })

  it('builds a finite room and real coves, with matching neutral light panels', () => {
    const room = createColdStudioGeometry(),
      bounds = new Box3().setFromObject(room.root)
    expect(room.root.children.filter((child) => child.name.includes('floor cove'))).toHaveLength(4)
    expect(room.panels).toHaveLength(Object.values(coldStudioConfig.lights).length)
    expect(room.floor.position.y).toBe(coldStudioConfig.groundY)
    expect(bounds.min.x).toBeCloseTo(coldStudioConfig.roomBox.min[0])
    expect(bounds.max.y).toBeCloseTo(coldStudioConfig.roomBox.max[1])
    for (const panel of room.panels) {
      const light = Object.values(coldStudioConfig.lights).find(
          (item) => item.id === panel.userData.showroomLightId,
        )!,
        material = panel.material as MeshBasicMaterial
      expect(panel.position.toArray()).toEqual(light.position)
      expect(panel.geometry.getAttribute('position').count).toBe(4)
      expect(material.color.r).toBe(material.color.g)
      expect(material.color.g).toBe(material.color.b)
      expect(material.color.r).toBe(light.radiance)
      expect(panel.userData.traceExclude).toBe(true)
      expect(panel.userData.traceSupport).toBe(false)
    }
    room.dispose()
  })

  it('borrows generated surfaces and updates derived cutaway plus opaque trace materials', () => {
    const room = createColdStudioGeometry(),
      maps = () => ({ map: new Texture(), normalMap: new Texture(), roughnessMap: new Texture() }),
      pack = { floor: maps(), wall: maps() },
      disposes = [...Object.values(pack.floor), ...Object.values(pack.wall)].map((texture) =>
        vi.spyOn(texture, 'dispose'),
      ),
      cutaway = createShowroomCutaway(
        room.fadeMeshes,
        new PerspectiveCamera(),
        new Box3(new Vector3(-1, 0, -1), new Vector3(1, 2, 1)),
      )
    room.applySurfaces(pack)
    expect((room.floor.material as MeshStandardMaterial).map).toBe(pack.floor.map)
    for (const mesh of room.fadeMeshes.filter((mesh) => mesh.userData.showroomSurface === 'wall')) {
      for (const material of [mesh.material, mesh.userData.traceMaterial]) {
        const finish = material as MeshStandardMaterial
        expect(finish.map).toBeNull()
        expect(finish.normalMap).toBeNull()
        expect(finish.roughnessMap).toBeNull()
        expect(finish.roughness).toBe(0.48)
        expect(finish.color.getHexString()).toBe('343537')
      }
    }
    cutaway.dispose()
    room.dispose()
    for (const dispose of disposes) expect(dispose).not.toHaveBeenCalled()
    for (const texture of [...Object.values(pack.floor), ...Object.values(pack.wall)])
      texture.dispose()
  })

  it('mounts neutral panels near the ceiling and side wall without floating suspension', () => {
    const room = createColdStudioGeometry()
    expect(room.root.children.some((child) => child.name.includes('suspension'))).toBe(false)
    for (const panel of room.panels) {
      const bounds = new Box3().setFromObject(panel)
      if (panel.userData.showroomLightId === 'rim') {
        expect(bounds.min.z).toBeCloseTo(coldStudioConfig.lights.rim.position[2])
        expect(bounds.max.y).toBeLessThan(coldStudioConfig.roomBox.max[1])
      } else if (panel.userData.showroomLightId === 'fill') {
        expect(bounds.min.x).toBeCloseTo(coldStudioConfig.lights.fill.position[0])
        expect(bounds.max.y).toBeLessThan(coldStudioConfig.roomBox.max[1])
      } else {
        expect(bounds.min.y).toBeCloseTo(coldStudioConfig.roomBox.max[1] - 0.14)
        expect(bounds.max.y).toBeCloseTo(coldStudioConfig.roomBox.max[1] - 0.14)
      }
    }
    room.dispose()
  })

  it('disposes each authored geometry, texture and shared material once', () => {
    const room = createColdStudioGeometry(),
      resources = new Set<{ dispose(): void }>()
    room.root.traverse((object) => {
      if (!(object instanceof Mesh)) return
      resources.add(object.geometry)
      const material = object.material as Material
      resources.add(material)
      if (material instanceof MeshStandardMaterial) {
        if (material.normalMap) resources.add(material.normalMap)
        if (material.roughnessMap) resources.add(material.roughnessMap)
      }
    })
    const spies = [...resources].map((resource) => vi.spyOn(resource, 'dispose'))
    room.dispose()
    room.dispose()
    expect(room.root.children).toHaveLength(0)
    for (const spy of spies) expect(spy).toHaveBeenCalledTimes(1)
  })
})

function cutawayFixture() {
  const camera = new PerspectiveCamera(),
    material = new MeshStandardMaterial(),
    geometry = new PlaneGeometry(4, 4),
    wall = new Mesh(geometry, material),
    scene = new Scene(),
    target = new Box3(new Vector3(-1, -1, -1), new Vector3(1, 1, 1))
  camera.position.set(0, 0, 5)
  wall.position.z = 2
  scene.add(wall)
  const before = wall.onBeforeRender,
    after = wall.onAfterRender,
    cutaway = createShowroomCutaway([wall], camera, target),
    runtime = wall.material as unknown as MeshStandardNodeMaterial,
    opacity = runtime.opacityNode as UniformNode<'float', number>
  function drawStart(view = camera) {
    wall.onBeforeRender(
      null as unknown as WebGLRenderer,
      scene,
      view,
      geometry,
      runtime,
      new Group(),
    )
  }
  function drawEnd() {
    wall.onAfterRender(
      null as unknown as WebGLRenderer,
      scene,
      camera,
      geometry,
      runtime,
      new Group(),
    )
  }
  return {
    camera,
    material,
    geometry,
    wall,
    before,
    after,
    cutaway,
    runtime,
    opacity,
    drawStart,
    drawEnd,
  }
}

describe('showroom main-camera cutaway', () => {
  it('includes both light housings in cutaway and leaves the opaque floor untouched', () => {
    const room = createColdStudioGeometry(),
      floorMaterial = room.floor.material,
      camera = new PerspectiveCamera(),
      target = new Box3(new Vector3(-1.7, 0, -2.8), new Vector3(1.7, 2.1, 2)),
      cutaway = createShowroomCutaway(room.fadeMeshes, camera, target)
    expect(room.fadeMeshes.filter((mesh) => mesh.name.includes('housing'))).toHaveLength(
      Object.values(coldStudioConfig.lights).length,
    )
    expect(room.fadeMeshes).not.toContain(room.floor)
    expect(room.floor.material).toBe(floorMaterial)
    expect((floorMaterial as Material).transparent).toBe(false)
    for (const mesh of room.fadeMeshes) {
      expect((mesh.material as Material).forceSinglePass).toBe(true)
      expect(mesh.userData.traceMaterial).toBeInstanceOf(Material)
    }
    cutaway.dispose()
    room.dispose()
  })

  it('fades blockers only for the main camera and keeps opaque DDGI sources', () => {
    const f = cutawayFixture()
    f.cutaway.tick(0, true)
    f.drawStart()
    expect(f.opacity.value).toBe(0)
    expect(f.runtime.depthWrite).toBe(true)
    expect(f.wall.visible).toBe(true)
    expect(f.wall.userData.traceMaterial).toBe(f.material)
    f.drawEnd()
    expect(f.opacity.value).toBe(1)
    f.drawStart(new PerspectiveCamera())
    expect(f.opacity.value).toBe(1)
    f.cutaway.dispose()
  })

  it('uses only explicit clock advances and restores smoothly after moving inside', () => {
    const f = cutawayFixture()
    f.cutaway.tick(0.1)
    f.drawStart()
    expect(f.opacity.value).toBeGreaterThan(0)
    expect(f.opacity.value).toBeLessThan(1)
    f.cutaway.tick(0.1)
    f.cutaway.tick(0.1)
    expect(f.cutaway.snapshot()[0]!.opacity).toBe(0)
    f.camera.position.z = 1.5
    f.cutaway.tick(0.1)
    expect(f.cutaway.snapshot()[0]!.opacity).toBeGreaterThan(0)
    f.cutaway.tick(0, true)
    expect(f.cutaway.snapshot()[0]!.opacity).toBe(1)
    f.cutaway.dispose()
  })

  it('restores exact hooks, material and descriptor without releasing borrowed resources', () => {
    const f = cutawayFixture(),
      sourceDispose = vi.spyOn(f.material, 'dispose'),
      geometryDispose = vi.spyOn(f.geometry, 'dispose'),
      runtimeDispose = vi.spyOn(f.runtime, 'dispose')
    f.cutaway.dispose()
    f.cutaway.dispose()
    expect(f.wall.material).toBe(f.material)
    expect(f.wall.onBeforeRender).toBe(f.before)
    expect(f.wall.onAfterRender).toBe(f.after)
    expect(f.wall.userData).not.toHaveProperty('traceMaterial')
    expect(runtimeDispose).toHaveBeenCalledTimes(1)
    expect(sourceDispose).not.toHaveBeenCalled()
    expect(geometryDispose).not.toHaveBeenCalled()
  })
})
