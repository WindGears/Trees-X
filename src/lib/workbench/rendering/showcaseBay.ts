import { Box3, Mesh, MeshPhysicalMaterial, RectAreaLight, type Camera, type Scene } from 'three'
import { acquireRectAreaUniforms } from '@/lib/three/rectAreaUniforms'
import type { SceneAdapter } from '../adapter'
import { studioDesign } from '../studio/design'
import { loadShowroomAssets } from './carShowroom/assets'
import {
  wrapWideColdStudioConfig,
  type CarShowroomConfig,
  type CarShowroomLight,
  type ShowroomVector3,
} from './carShowroom/config'
import { createShowroomCutaway } from './carShowroom/fade'
import { createColdStudioGeometry } from './carShowroom/geometry'
import { isWebGpuRenderer } from './rendererTypes'
import { createShadowRefresh } from './shadowRefresh'
import { bindGpuAreaLights } from './studioEnvironment'

type Exhibit = 'typewriter' | 'piano'

function exhibitRoom(exhibit: Exhibit, supportY: number): CarShowroomConfig {
  const base = wrapWideColdStudioConfig,
    scale = exhibit === 'typewriter' ? 0.82 : 1.12,
    groundY = exhibit === 'typewriter' ? supportY - studioDesign.height : supportY
  const position = ([x, y, z]: ShowroomVector3): ShowroomVector3 => [
    x * scale,
    groundY + (y - base.groundY) * scale,
    z * scale,
  ]
  const lamp = (light: CarShowroomLight): CarShowroomLight => ({
    ...light,
    width: light.width * scale,
    height: light.height * scale,
    position: position(light.position),
    target: position(light.target),
    intensity: light.intensity * 0.34,
    radiance: light.radiance * 0.14,
  })
  return {
    ...base,
    groundY,
    roomBox: { min: position(base.roomBox.min), max: position(base.roomBox.max) },
    floor: { ...base.floor, width: base.floor.width * scale, depth: base.floor.depth * scale },
    coveRadius: base.coveRadius * scale,
    lights: {
      key: lamp(base.lights.key),
      strip: lamp(base.lights.strip),
      fill: lamp(base.lights.fill),
      rim: lamp(base.lights.rim),
    },
  }
}

/** Reuse the R18 shell and stone finish with the exhibit's own native material path. */
export function withShowcaseBay(adapter: SceneAdapter, exhibit: Exhibit, supportY: number) {
  let bay: ReturnType<typeof createBay> | undefined
  const result: SceneAdapter = {
    ...adapter,
    attach(scene, renderer, camera) {
      adapter.attach?.(scene, renderer, camera)
      if (!bay && camera && isWebGpuRenderer(renderer))
        bay = createBay(scene, camera, adapter, exhibit, supportY)
    },
    async prepare(signal) {
      await adapter.prepare?.(signal)
      await bay?.prepare(signal)
    },
    apply() {
      adapter.apply()
      bay?.markDirty()
    },
    beforeRender() {
      bay?.beforeRender()
      adapter.beforeRender?.()
    },
    dispose() {
      bay?.dispose()
      bay = undefined
      adapter.dispose()
    },
  }
  return result
}

function createBay(
  scene: Scene,
  camera: Camera,
  adapter: SceneAdapter,
  exhibit: Exhibit,
  supportY: number,
) {
  const config = exhibitRoom(exhibit, supportY),
    room = createColdStudioGeometry(config),
    lifecycle = new AbortController(),
    releaseUniforms = acquireRectAreaUniforms(),
    lights: RectAreaLight[] = [],
    restore: (() => void)[] = []
  let cutaway: ReturnType<typeof createShowroomCutaway> | undefined
  let shadow: ReturnType<typeof createShadowRefresh> | undefined
  let assets: Awaited<ReturnType<typeof loadShowroomAssets>> | undefined
  let pedestal: MeshPhysicalMaterial | undefined
  function dispose() {
    if (lifecycle.signal.aborted) return
    lifecycle.abort()
    cutaway?.dispose()
    shadow?.dispose()
    lights.forEach((light) => {
      light.removeFromParent()
      light.dispose()
    })
    restore.forEach((apply) => apply())
    room.dispose()
    assets?.dispose()
    releaseUniforms()
  }
  function hide(name: string) {
    const mesh = scene.getObjectByName(name)
    if (!mesh) return
    const visible = mesh.visible
    mesh.visible = false
    restore.push(() => {
      mesh.visible = visible
    })
  }
  try {
    bindGpuAreaLights()
    room.root.name = `Trees X / ${exhibit} bay`
    delete room.root.userData.carShowroom
    room.root.userData.showcaseBay = exhibit
    room.floor.receiveShadow = true
    if (exhibit === 'piano' && room.floor.material instanceof MeshPhysicalMaterial) {
      room.floor.material.color.set('#64666a')
      room.floor.material.envMapIntensity = 0.34
    }
    hide('workbench-ground')
    if (exhibit === 'typewriter') {
      hide('Trees X / studio skybox')
      hide('Trees X / studio floor')
      const top = scene.getObjectByName('Trees X / studio pedestal')
      if (top instanceof Mesh && top.material instanceof MeshPhysicalMaterial)
        pedestal = top.material
      for (const light of [...scene.children]) {
        if (!(light instanceof RectAreaLight) || !light.name.startsWith('Trees X / studio '))
          continue
        light.removeFromParent()
        restore.push(() => scene.add(light))
      }
    } else {
      shadow = createShadowRefresh(scene.getObjectByName('workbench-lighting') ?? scene)
    }
    for (const lamp of [config.lights.key, config.lights.fill]) {
      const light = new RectAreaLight(lamp.color, lamp.intensity, lamp.width, lamp.height)
      light.position.set(...lamp.position)
      light.lookAt(...lamp.target)
      lights.push(light)
    }
    scene.add(room.root, ...lights)
    cutaway = createShowroomCutaway(room.fadeMeshes, camera, new Box3().setFromObject(adapter.root))
  } catch (error) {
    dispose()
    throw error
  }
  return {
    async prepare(signal?: AbortSignal) {
      const active = signal ? AbortSignal.any([signal, lifecycle.signal]) : lifecycle.signal
      const loaded = await loadShowroomAssets(active)
      if (active.aborted) {
        loaded.dispose()
        active.throwIfAborted()
      }
      assets = loaded
      room.applySurfaces(assets)
      if (pedestal) {
        pedestal.color.set('#858687')
        pedestal.map = assets.floor.map
        pedestal.normalMap = assets.floor.normalMap
        pedestal.roughnessMap = assets.floor.roughnessMap
        pedestal.normalScale.setScalar(0.16)
        pedestal.roughness = 0.45
        pedestal.needsUpdate = true
      }
    },
    beforeRender() {
      cutaway?.tick(0, true)
      shadow?.beforeRender()
    },
    markDirty: () => shadow?.markDirty(),
    dispose,
  }
}
