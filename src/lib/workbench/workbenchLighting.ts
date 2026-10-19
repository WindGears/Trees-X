import {
  AmbientLight,
  DirectionalLight,
  Group,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
} from 'three'
import type { StageConfig } from './types'

/** Explicit owner: the Tres primitive only attaches this graph, never disposes its resources. */
export function createWorkbenchLighting(stage: StageConfig, studio: boolean) {
  const root = new Group(),
    ambient = new AmbientLight(),
    key = new DirectionalLight(),
    rim = new DirectionalLight(),
    geometry = new PlaneGeometry(200, 200),
    material = new MeshStandardMaterial({ roughness: 1, metalness: 0, envMapIntensity: 0.1 }),
    ground = new Mesh(geometry, material)
  root.name = 'workbench-lighting'
  ground.name = 'workbench-ground'
  ground.userData.traceSupport = true
  ground.rotation.x = -Math.PI / 2
  ground.receiveShadow = true
  key.shadow.mapSize.set(2048, 2048)
  key.shadow.normalBias = 0.005
  key.shadow.bias = -0.00008
  key.shadow.radius = 3
  root.add(ambient, key, rim)
  let disposed = false
  function update(next: StageConfig, ownStudio: boolean) {
    if (disposed) return
    ambient.intensity = next.ambient
    key.position.fromArray(next.key.position)
    key.intensity = next.key.intensity
    key.color.set(next.key.color)
    key.castShadow = !ownStudio
    rim.position.fromArray(next.rim.position)
    rim.intensity = next.rim.intensity
    rim.color.set(next.rim.color)
    ground.position.set(0, next.groundY, 0)
    material.color.set(next.ground)
    if (ownStudio) ground.removeFromParent()
    else if (ground.parent !== root) root.add(ground)
  }
  update(stage, studio)
  return {
    root,
    update,
    dispose() {
      if (disposed) return
      disposed = true
      root.removeFromParent()
      geometry.dispose()
      material.dispose()
      key.dispose()
      rim.dispose()
      ambient.dispose()
      root.clear()
    },
  }
}
