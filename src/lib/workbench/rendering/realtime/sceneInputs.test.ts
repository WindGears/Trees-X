import {
  BoxGeometry,
  HalfFloatType,
  MaterialBlending,
  Mesh,
  MeshPhysicalMaterial,
  NoBlending,
  PerspectiveCamera,
  RenderTarget,
  RGFormat,
  Scene,
  Texture,
  UnsignedByteType,
  Vector2,
} from 'three'
import { mrt, output, vec2, vec4 } from 'three/tsl'
import { describe, expect, it, vi } from 'vitest'
import { createRealtimeSceneInputs } from './sceneInputs'
import { diffuseResponseNode } from './materials'

describe('opaque surface and native transparent beauty inputs', () => {
  it('stores native diffuse response in the existing surface output without a seventh attachment', () => {
    const inputs = createRealtimeSceneInputs(new Scene(), new PerspectiveCamera(), vec2(0)),
      surfaceMrt = inputs.surface.getMRT()!,
      beautyMrt = inputs.beauty.getMRT()!
    expect(surfaceMrt.get('output')).toBe(diffuseResponseNode)
    expect(Object.keys(surfaceMrt.outputNodes).sort()).toEqual([
      'albedo',
      'baseDiffuse',
      'baseSpecular',
      'motion',
      'normal',
      'output',
    ])
    expect(inputs.diffuseResponse).toBe(inputs.surface.getTextureNode('output'))
    expect(inputs.diffuseResponse.value).toBe(inputs.surface.getTexture('output'))
    expect(inputs.surface.renderTarget.textures).toHaveLength(6)
    expect(beautyMrt.get('output')).toBe(output)
    expect(inputs.color).toBe(inputs.beauty.getTextureNode('output'))
    expect(inputs.color).not.toBe(inputs.diffuseResponse)
    expect(Object.keys(beautyMrt.outputNodes).sort()).toEqual(['correctionThroughput', 'output'])
    expect(inputs.beauty.renderTarget.textures).toHaveLength(2)
    inputs.dispose()
  })

  it('isolates lighting MRTs and depth from native alpha beauty without source mutation', () => {
    const scene = new Scene(),
      camera = new PerspectiveCamera(),
      geometry = new BoxGeometry(),
      map = new Texture(),
      material = new MeshPhysicalMaterial({
        name: 'decal-6',
        transparent: true,
        depthWrite: false,
        roughness: 0.6,
        map,
      }),
      mesh = new Mesh(geometry, material)
    scene.add(mesh)
    const positions = geometry.getAttribute('position').array.slice(),
      inputs = createRealtimeSceneInputs(scene, camera, vec2(0))

    expect(inputs.surface.scene).toBe(scene)
    expect(inputs.beauty.scene).toBe(scene)
    expect(inputs.surface.camera).toBe(camera)
    expect(inputs.beauty.camera).toBe(camera)
    expect(inputs.surface.opaque).toBe(true)
    expect(inputs.surface.transparent).toBe(false)
    expect(inputs.beauty.opaque).toBe(true)
    expect(inputs.beauty.transparent).toBe(true)
    expect(inputs.surface.renderTarget).not.toBe(inputs.beauty.renderTarget)
    expect(inputs.surface.renderTarget.depthTexture).not.toBe(
      inputs.beauty.renderTarget.depthTexture,
    )
    const lightingMrt = inputs.surface.getMRT()!,
      beautyMrt = inputs.beauty.getMRT()!
    for (const name of ['normal', 'albedo', 'motion', 'baseSpecular', 'baseDiffuse']) {
      expect(lightingMrt.has(name)).toBe(true)
      expect(lightingMrt.getBlendMode(name).blending).toBe(NoBlending)
      expect(beautyMrt.has(name)).toBe(false)
    }
    expect(beautyMrt.getBlendMode('output').blending).toBe(MaterialBlending)
    expect(beautyMrt.getBlendMode('correctionThroughput').blending).toBe(MaterialBlending)
    expect(inputs.surface.getTexture('normal').type).toBe(HalfFloatType)
    expect(inputs.surface.getTexture('motion').format).toBe(RGFormat)
    expect(inputs.surface.getTexture('albedo').type).toBe(UnsignedByteType)
    expect(inputs.beauty.getTexture('correctionThroughput').type).toBe(UnsignedByteType)
    expect(mesh.material).toBe(material)
    expect(material.transparent).toBe(true)
    expect(material.alphaTest).toBe(0)
    expect(material.depthWrite).toBe(false)
    expect(material.map).toBe(map)
    expect(geometry.getAttribute('position').array).toEqual(positions)

    inputs.dispose()
    material.dispose()
    map.dispose()
    geometry.dispose()
  })

  it('adds exactly one opaque draw while each pass clears only its independent target', () => {
    const scene = new Scene(),
      camera = new PerspectiveCamera(),
      inputs = createRealtimeSceneInputs(scene, camera, vec2(0)),
      originalTarget = new RenderTarget(4, 4),
      originalMrt = mrt({ output: vec4(0) })
    let target: RenderTarget | null = originalTarget,
      activeMrt: ReturnType<typeof mrt> | null = originalMrt
    const draws: { target: RenderTarget | null; transparent: boolean; opaque: boolean }[] = []
    const renderer = {
      autoClear: false,
      transparent: true,
      opaque: true,
      contextNode: null,
      getOutputRenderTarget: () => null,
      getDrawingBufferSize: (size: Vector2) => size.set(1440, 1000),
      getRenderTarget: () => target,
      getMRT: () => activeMrt,
      setRenderTarget: (value: RenderTarget | null) => {
        target = value
      },
      setMRT: (value: ReturnType<typeof mrt> | null) => {
        activeMrt = value
      },
      render(value: Scene, view: PerspectiveCamera) {
        expect(value).toBe(scene)
        expect(view).toBe(camera)
        expect(this.autoClear).toBe(true)
        draws.push({ target, transparent: this.transparent, opaque: this.opaque })
      },
    }
    const frame = { renderer } as unknown as Parameters<typeof inputs.surface.updateBefore>[0]
    for (const pass of [inputs.surface, inputs.beauty]) {
      pass.updateBefore(frame)
      expect(target).toBe(originalTarget)
      expect(activeMrt).toBe(originalMrt)
      expect(renderer.autoClear).toBe(false)
      expect(renderer.transparent).toBe(true)
      expect(renderer.opaque).toBe(true)
    }
    expect(draws).toEqual([
      { target: inputs.surface.renderTarget, opaque: true, transparent: false },
      { target: inputs.beauty.renderTarget, opaque: true, transparent: true },
    ])
    expect(inputs.surface.renderTarget.width).toBe(1440)
    expect(inputs.beauty.renderTarget.height).toBe(1000)
    inputs.dispose()
    originalTarget.dispose()
  })

  it('releases both owned targets once and never releases borrowed scene assets', () => {
    const scene = new Scene(),
      geometry = new BoxGeometry(),
      map = new Texture(),
      material = new MeshPhysicalMaterial({ map }),
      mesh = new Mesh(geometry, material)
    scene.add(mesh)
    const inputs = createRealtimeSceneInputs(scene, new PerspectiveCamera(), vec2(0)),
      surfaceDispose = vi.spyOn(inputs.surface.renderTarget, 'dispose'),
      beautyDispose = vi.spyOn(inputs.beauty.renderTarget, 'dispose'),
      geometryDispose = vi.spyOn(geometry, 'dispose'),
      materialDispose = vi.spyOn(material, 'dispose'),
      mapDispose = vi.spyOn(map, 'dispose')
    inputs.dispose()
    inputs.dispose()
    expect(surfaceDispose).toHaveBeenCalledTimes(1)
    expect(beautyDispose).toHaveBeenCalledTimes(1)
    expect(geometryDispose).not.toHaveBeenCalled()
    expect(materialDispose).not.toHaveBeenCalled()
    expect(mapDispose).not.toHaveBeenCalled()
    material.dispose()
    map.dispose()
    geometry.dispose()
  })
})
