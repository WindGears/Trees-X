import {
  BoxGeometry,
  Color,
  ColorManagement,
  Group,
  HalfFloatType,
  MaterialBlending,
  Mesh,
  MeshPhysicalMaterial,
  NoBlending,
  NoToneMapping,
  PerspectiveCamera,
  RenderTarget,
  RGFormat,
  Scene,
  Texture,
  UnsignedByteType,
  Vector2,
  Vector4,
} from 'three'
import { MeshBasicNodeMaterial, MeshPhysicalNodeMaterial, type WebGPURenderer } from 'three/webgpu'
import { float, mrt, output, vec2, vec3, vec4 } from 'three/tsl'
import { describe, expect, it, vi } from 'vitest'
import { createRealtimeSceneInputs } from './sceneInputs'
import { diffuseResponseNode } from './materials'

function preparingRenderer() {
  const retained = new RenderTarget(8, 8),
    originalMrt = mrt({ output: vec4(0) })
  let target: RenderTarget | null = retained,
    activeMrt = originalMrt
  const renderer = {
    toneMapping: 4,
    toneMappingExposure: 1.2,
    outputColorSpace: 'srgb',
    autoClear: false,
    opaque: false,
    transparent: true,
    contextNode: null,
    xr: { enabled: true },
    shadowMap: { enabled: true },
    getRenderTarget: () => target,
    getActiveCubeFace: () => 2,
    getActiveMipmapLevel: () => 1,
    getMRT: () => activeMrt,
    setMRT: (value: typeof originalMrt) => {
      activeMrt = value
    },
    setRenderTarget: vi.fn((value: RenderTarget | null) => {
      target = value
    }),
    getRenderObjectFunction: () => null,
    setRenderObjectFunction: vi.fn(),
    getPixelRatio: () => 1,
    setPixelRatio: vi.fn(),
    getClearColor: (value: Color) => value.set('#123456'),
    getClearAlpha: () => 0.7,
    setClearColor: vi.fn(),
    getScissorTest: () => true,
    setScissorTest: vi.fn(),
    getViewport: (value: Vector4) => value.set(1, 2, 3, 4),
    getScissor: (value: Vector4) => value.set(5, 6, 7, 8),
    setViewport: vi.fn(),
    setScissor: vi.fn(),
    getDrawingBufferSize: (value: Vector2) => value.set(1440, 1000),
    getOutputBufferType: () => HalfFloatType,
    compileAsync: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    render: vi.fn(),
  }
  return { renderer, gpu: renderer as unknown as WebGPURenderer, retained, originalMrt }
}

describe('opaque surface and native transparent beauty inputs', () => {
  it('resizes both shared scene targets before dependants and leaves lazy pass sizing allocation-free', () => {
    const inputs = createRealtimeSceneInputs(new Scene(), new PerspectiveCamera(), vec2(0)),
      depth = inputs.depth,
      initRenderTarget = vi.fn((target: RenderTarget) => {
        if (target.depthTexture) {
          target.depthTexture.image.width = target.width
          target.depthTexture.image.height = target.height
        }
      }),
      renderer = { initRenderTarget } as unknown as WebGPURenderer,
      surfaceDispose = vi.spyOn(inputs.surface.renderTarget, 'dispose'),
      beautyDispose = vi.spyOn(inputs.beauty.renderTarget, 'dispose')
    try {
      for (const [width, height] of [
        [1440, 1000],
        [1280, 720],
        [390, 844],
      ]) {
        inputs.resize(width!, height!, renderer)
        expect(inputs.surface.renderTarget).toMatchObject({ width, height })
        expect(inputs.beauty.renderTarget).toMatchObject({ width, height })
        expect(inputs.depth).toBe(depth)
        expect(inputs.surface.renderTarget.depthTexture?.image.width).toBe(width)
        expect(inputs.surface.renderTarget.depthTexture?.image.height).toBe(height)
        const allocations = initRenderTarget.mock.calls.length
        const surfaceCalls = surfaceDispose.mock.calls.length,
          beautyCalls = beautyDispose.mock.calls.length
        // Native updateBefore repeats setSize. It must not destroy an attachment
        // after a dependent beauty material has resolved its shared depth binding.
        inputs.surface.setSize(width!, height!)
        inputs.beauty.setSize(width!, height!)
        expect(surfaceDispose).toHaveBeenCalledTimes(surfaceCalls)
        expect(beautyDispose).toHaveBeenCalledTimes(beautyCalls)
        inputs.resize(width!, height!, renderer)
        expect(initRenderTarget).toHaveBeenCalledTimes(allocations)
      }
    } finally {
      inputs.dispose()
    }
  })
  it.each(['success', 'failure', 'cancel'] as const)(
    'precompiles real HDR MRT variants serially and restores state on %s without publishing a frame',
    async (mode) => {
      const f = preparingRenderer(),
        scene = new Scene(),
        camera = new PerspectiveCamera(),
        root = new Group(),
        mesh = new Mesh(new BoxGeometry(), new MeshPhysicalMaterial()),
        glass = new MeshPhysicalMaterial({ transmission: 1 }),
        nodeGlass = new MeshPhysicalNodeMaterial(),
        backdrop = new MeshBasicNodeMaterial(),
        hiddenGlass = new MeshPhysicalMaterial({ transmission: 1, visible: false }),
        decal = new MeshPhysicalMaterial({ transparent: true }),
        abort = new AbortController()
      nodeGlass.transmissionNode = float(1)
      backdrop.backdropNode = vec3(1)
      root.userData.workbenchProduct = 'reventon'
      root.add(mesh)
      // Shared materials, mixed groups, Node materials and initially hidden
      // surfaces all return to their exact state even on rejection/cancel.
      const mixed = new Mesh(mesh.geometry, [glass, decal])
      mixed.add(new Mesh(mesh.geometry, nodeGlass))
      root.add(mixed, new Mesh(mesh.geometry, [glass, backdrop, hiddenGlass]))
      scene.add(root)
      const inputs = createRealtimeSceneInputs(scene, camera, vec2(0)),
        seen: object[] = []
      f.renderer.compileAsync.mockImplementation(async () => {
        expect(f.renderer.toneMapping).toBe(NoToneMapping)
        expect(f.renderer.outputColorSpace).toBe(ColorManagement.workingColorSpace)
        expect(f.renderer.xr.enabled).toBe(false)
        expect(mesh.frustumCulled).toBe(false)
        expect(mixed.visible).toBe(true)
        expect(decal.visible).toBe(true)
        for (const material of [glass, nodeGlass, backdrop, hiddenGlass])
          expect(material.visible).toBe(false)
        const target = f.renderer.getRenderTarget()!
        expect(target).toMatchObject({ width: 1440, height: 1000, samples: 0 })
        expect(target.texture.type).toBe(HalfFloatType)
        seen.push({
          target,
          opaque: f.renderer.opaque,
          transparent: f.renderer.transparent,
          mrt: f.renderer.getMRT(),
        })
        if (mode === 'failure') throw new Error('native preparation rejected')
        if (mode === 'cancel') abort.abort()
      })
      try {
        const result = inputs.prepare(f.gpu, abort.signal)
        if (mode === 'success') {
          await result
          expect(seen).toEqual([
            {
              target: inputs.surface.renderTarget,
              opaque: true,
              transparent: false,
              mrt: inputs.surface.getMRT(),
            },
            {
              target: inputs.beauty.renderTarget,
              opaque: true,
              transparent: true,
              mrt: inputs.beauty.getMRT(),
            },
          ])
        } else {
          await expect(result).rejects.toThrow()
          expect(f.renderer.compileAsync).toHaveBeenCalledTimes(1)
        }
        expect(mesh.frustumCulled).toBe(true)
        expect(mesh.material).toBeInstanceOf(MeshPhysicalMaterial)
        for (const material of [glass, nodeGlass, backdrop, decal])
          expect(material.visible).toBe(true)
        expect(hiddenGlass.visible).toBe(false)
        expect(f.renderer.render).not.toHaveBeenCalled()
        expect(f.renderer.getRenderTarget()).toBe(f.retained)
        expect(f.renderer.getMRT()).toBe(f.originalMrt)
        expect(f.renderer).toMatchObject({
          toneMapping: 4,
          toneMappingExposure: 1.2,
          outputColorSpace: 'srgb',
          opaque: false,
          transparent: true,
          autoClear: false,
        })
        expect(f.renderer.xr.enabled).toBe(true)
        expect(f.renderer.setViewport).toHaveBeenLastCalledWith(new Vector4(1, 2, 3, 4))
        expect(f.renderer.setScissor).toHaveBeenLastCalledWith(new Vector4(5, 6, 7, 8))
      } finally {
        inputs.dispose()
        mesh.geometry.dispose()
        mesh.material.dispose()
        for (const material of [glass, nodeGlass, backdrop, hiddenGlass, decal]) material.dispose()
        f.retained.dispose()
      }
    },
  )

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
