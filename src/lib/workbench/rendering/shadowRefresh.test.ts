import {
  DirectionalLight,
  Group,
  OrthographicCamera,
  PerspectiveCamera,
  PointLight,
  Scene,
} from 'three'
import { NodeFrame, ShadowNode } from 'three/webgpu'
import { describe, expect, it, vi } from 'vitest'
import { createShadowRefresh } from './shadowRefresh'

function fixture(autoUpdate = true) {
  const scene = new Scene(),
    light = new DirectionalLight(),
    camera = new PerspectiveCamera(),
    gate = createShadowRefresh(scene)
  light.castShadow = true
  light.shadow.autoUpdate = autoUpdate
  scene.add(light, light.target, camera)
  function render() {
    gate.beforeRender()
    const refreshed = light.shadow.needsUpdate
    light.shadow.needsUpdate = false // the native renderer's successful shadow pass
    return refreshed
  }
  return { scene, light, camera, gate, render }
}

describe('pose-driven directional shadow refresh', () => {
  it('renders initially and reuses shadows for observation-camera movement', () => {
    const f = fixture()
    expect(f.render()).toBe(true)
    expect(f.light.shadow.autoUpdate).toBe(false)
    for (let index = 0; index < 20; index++) {
      f.camera.position.x += 1
      f.camera.lookAt(0, 0, 0)
      f.camera.updateProjectionMatrix()
      expect(f.render()).toBe(false)
    }
    f.gate.markDirty()
    expect(f.render()).toBe(true)
    expect(f.render()).toBe(false)
    f.gate.dispose()
    expect(f.light.shadow.autoUpdate).toBe(true)
  })

  it('does not clear a native update pending through skipped or failed draws', () => {
    const f = fixture()
    f.gate.beforeRender()
    f.gate.beforeRender()
    expect(f.light.shadow.needsUpdate).toBe(true)
    f.light.shadow.needsUpdate = false
    f.gate.beforeRender()
    expect(f.light.shadow.needsUpdate).toBe(false)
    f.light.shadow.needsUpdate = true
    f.gate.beforeRender()
    expect(f.light.shadow.needsUpdate).toBe(true)
    f.gate.dispose()
    expect(f.light.shadow.needsUpdate).toBe(true)
  })

  it('detects inherited light and target transforms without scene updates', () => {
    const f = fixture(),
      lightParent = new Group(),
      targetParent = new Group()
    lightParent.add(f.light)
    targetParent.add(f.light.target)
    f.scene.add(lightParent, targetParent)
    f.render()
    lightParent.position.x = 1
    expect(f.render()).toBe(true)
    expect(f.render()).toBe(false)
    targetParent.position.z = 3
    expect(f.render()).toBe(true)
    f.light.position.y = 9
    expect(f.render()).toBe(true)
    expect(f.render()).toBe(false)
    f.gate.dispose()
  })

  it.each(['left', 'right', 'top', 'bottom', 'near', 'far', 'zoom'] as const)(
    'refreshes and updates an edited shadow camera %s',
    (parameter) => {
      const f = fixture(),
        camera = f.light.shadow.camera
      f.render()
      const projection = camera.projectionMatrix.clone()
      camera[parameter] += 0.1
      expect(f.render()).toBe(true)
      expect(camera.projectionMatrix.equals(projection)).toBe(false)
      expect(f.render()).toBe(false)
      f.gate.dispose()
    },
  )

  it('detects view offsets, explicit projections and shadow-camera replacement', () => {
    const f = fixture(),
      camera = f.light.shadow.camera
    f.render()
    camera.setViewOffset(2048, 2048, 0, 0, 1024, 1024)
    expect(f.render()).toBe(true)
    expect(f.render()).toBe(false)
    camera.projectionMatrix.elements[8] += 0.01
    expect(f.render()).toBe(true)
    expect(camera.projectionMatrix.elements[8]).not.toBe(0)
    expect(f.render()).toBe(false)
    camera.up.set(0, 0, 1)
    expect(f.render()).toBe(true)
    f.light.shadow.camera = new OrthographicCamera(-3, 3, 3, -3, 0.1, 200)
    expect(f.render()).toBe(true)
    expect(f.render()).toBe(false)
    f.gate.dispose()
  })

  it.each(['bias', 'normalBias', 'radius', 'blurSamples', 'intensity'] as const)(
    'refreshes after shadow %s changes without altering its value',
    (parameter) => {
      const f = fixture()
      f.render()
      const desired = f.light.shadow[parameter] + 0.125
      f.light.shadow[parameter] = desired
      expect(f.render()).toBe(true)
      expect(f.light.shadow[parameter]).toBe(desired)
      expect(f.render()).toBe(false)
      f.gate.dispose()
    },
  )

  it('detects target size and layers but leaves other light owners alone', () => {
    const f = fixture(),
      point = new PointLight(),
      unshadowed = new DirectionalLight()
    point.castShadow = true
    f.scene.add(point, unshadowed)
    f.render()
    f.light.shadow.mapSize.set(4096, 2048)
    expect(f.render()).toBe(true)
    expect(f.light.shadow.mapSize.toArray()).toEqual([4096, 2048])
    f.light.shadow.camera.layers.set(3)
    expect(f.render()).toBe(true)
    f.light.layers.set(4)
    expect(f.render()).toBe(true)
    expect(point.shadow.autoUpdate).toBe(true)
    expect(point.shadow.needsUpdate).toBe(false)
    expect(unshadowed.shadow.autoUpdate).toBe(true)
    expect(unshadowed.shadow.needsUpdate).toBe(false)
    f.gate.dispose()
  })

  it('discovers new lights, releases removed lights and restores prior false values', () => {
    const f = fixture(false),
      another = new DirectionalLight()
    f.render()
    another.castShadow = true
    f.scene.add(another)
    f.gate.beforeRender()
    expect(another.shadow.autoUpdate).toBe(false)
    expect(another.shadow.needsUpdate).toBe(true)
    f.scene.remove(another)
    f.gate.beforeRender()
    expect(another.shadow.autoUpdate).toBe(true)
    f.light.castShadow = false
    f.gate.beforeRender()
    expect(f.light.shadow.autoUpdate).toBe(false)
    f.light.castShadow = true
    expect(f.render()).toBe(true)
    f.gate.dispose()
    f.gate.dispose()
    f.gate.markDirty()
    f.gate.beforeRender()
    expect(f.light.shadow.autoUpdate).toBe(false)
  })

  it('restores a replaced LightShadow independently and rejects duplicate owners', () => {
    const f = fixture(),
      previous = f.light.shadow,
      otherOwner = createShadowRefresh(f.scene)
    f.render()
    expect(() => otherOwner.beforeRender()).toThrow('already has a refresh owner')
    otherOwner.dispose()
    f.light.shadow = new DirectionalLight().shadow
    expect(f.render()).toBe(true)
    expect(previous.autoUpdate).toBe(true)
    expect(f.light.shadow.autoUpdate).toBe(false)
    f.gate.dispose()
    expect(f.light.shadow.autoUpdate).toBe(true)
    const recovered = createShadowRefresh(f.scene)
    recovered.beforeRender()
    expect(f.light.shadow.needsUpdate).toBe(true)
    recovered.dispose()
    expect(f.light.shadow.autoUpdate).toBe(true)
  })

  it('uses the actual r185 ShadowNode per-light dirty contract', () => {
    const f = fixture(),
      node = new ShadowNode(f.light, f.light.shadow),
      frame = new NodeFrame(),
      refresh = vi.fn()
    Object.defineProperties(node, {
      shadowMap: { value: { depthTexture: { version: 1 } } },
      _depthVersionCached: { value: 1, writable: true },
      updateShadow: { value: refresh },
    })
    frame.camera = f.camera
    frame.frameId = 1
    f.gate.beforeRender()
    node.updateBefore(frame)
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(f.light.shadow.needsUpdate).toBe(false)
    frame.frameId++
    f.camera.position.x++
    f.gate.beforeRender()
    node.updateBefore(frame)
    expect(refresh).toHaveBeenCalledTimes(1)
    frame.frameId++
    f.gate.markDirty()
    f.gate.beforeRender()
    node.updateBefore(frame)
    expect(refresh).toHaveBeenCalledTimes(2)
    f.gate.dispose()
  })
})
