import { Color, MeshStandardMaterial, PerspectiveCamera, Scene, Vector4 } from 'three'
import { RenderTarget, type WebGPURenderer } from 'three/webgpu'
import { mrt, vec4 } from 'three/tsl'
import { describe, expect, it } from 'vitest'
import { preservePreparationState } from './preparationState'

function fixture() {
  const retained = new RenderTarget(8, 8),
    temporary = new RenderTarget(16, 16),
    scene = new Scene(),
    camera = new PerspectiveCamera(),
    originalOverride = new MeshStandardMaterial(),
    context = vec4(0),
    originalMrt = mrt({ output: vec4(1) }),
    renderObject = () => {},
    color = new Color('#243648'),
    viewport = new Vector4(7, 11, 1440, 1000),
    scissor = new Vector4(13, 17, 900, 700)
  let target: RenderTarget | null = retained,
    cubeFace = 3,
    mip = 2,
    ratio = 1.25,
    alpha = 0.7,
    scissorTest = true,
    activeMrt: typeof originalMrt | null = originalMrt,
    hook: typeof renderObject | null = renderObject
  const renderer = {
    toneMapping: 4,
    toneMappingExposure: 1.3,
    outputColorSpace: 'srgb',
    autoClear: false,
    opaque: false,
    transparent: true,
    contextNode: context,
    xr: { enabled: true },
    shadowMap: { enabled: true },
    depth: true,
    stencil: false,
    getRenderTarget: () => target,
    getActiveCubeFace: () => cubeFace,
    getActiveMipmapLevel: () => mip,
    setRenderTarget(value: RenderTarget | null, face = 0, level = 0) {
      target = value
      cubeFace = face
      mip = level
    },
    getMRT: () => activeMrt,
    setMRT(value: typeof activeMrt) {
      activeMrt = value
    },
    getRenderObjectFunction: () => hook,
    setRenderObjectFunction(value: typeof hook) {
      hook = value
    },
    getPixelRatio: () => ratio,
    setPixelRatio(value: number) {
      ratio = value
    },
    getClearColor: (result: Color) => result.copy(color),
    getClearAlpha: () => alpha,
    setClearColor(value: Color | number, nextAlpha: number) {
      color.set(value)
      alpha = nextAlpha
    },
    getScissorTest: () => scissorTest,
    setScissorTest(value: boolean) {
      scissorTest = value
    },
    getViewport: (result: Vector4) => result.copy(viewport),
    setViewport(value: Vector4) {
      viewport.copy(value)
    },
    getScissor: (result: Vector4) => result.copy(scissor),
    setScissor(value: Vector4) {
      scissor.copy(value)
    },
  }
  scene.background = new Color('#172635')
  scene.backgroundNode = vec4(0.2)
  scene.overrideMaterial = originalOverride
  scene.name = 'source scene'
  camera.layers.set(5)
  const snapshot = () => ({
    target: renderer.getRenderTarget(),
    cubeFace: renderer.getActiveCubeFace(),
    mip: renderer.getActiveMipmapLevel(),
    mrt: renderer.getMRT(),
    hook: renderer.getRenderObjectFunction(),
    ratio: renderer.getPixelRatio(),
    color: renderer.getClearColor(new Color()).toArray(),
    alpha: renderer.getClearAlpha(),
    scissorTest: renderer.getScissorTest(),
    viewport: renderer.getViewport(new Vector4()).toArray(),
    scissor: renderer.getScissor(new Vector4()).toArray(),
    toneMapping: renderer.toneMapping,
    exposure: renderer.toneMappingExposure,
    outputColorSpace: renderer.outputColorSpace,
    autoClear: renderer.autoClear,
    opaque: renderer.opaque,
    transparent: renderer.transparent,
    context: renderer.contextNode,
    xr: renderer.xr.enabled,
    shadows: renderer.shadowMap.enabled,
    depth: renderer.depth,
    stencil: renderer.stencil,
    background: scene.background,
    backgroundNode: scene.backgroundNode,
    override: scene.overrideMaterial,
    name: scene.name,
    layers: camera.layers.mask,
  })
  const disturb = () => {
    renderer.setRenderTarget(temporary, 0, 0)
    renderer.setMRT(null)
    renderer.setRenderObjectFunction(null)
    renderer.setPixelRatio(1)
    renderer.setClearColor(0, 0)
    renderer.setScissorTest(false)
    renderer.setViewport(new Vector4(0, 0, 16, 16))
    renderer.setScissor(new Vector4(0, 0, 16, 16))
    renderer.toneMapping = 0
    renderer.toneMappingExposure = 1
    renderer.outputColorSpace = 'srgb-linear'
    renderer.autoClear = true
    renderer.opaque = true
    renderer.transparent = false
    renderer.contextNode = vec4(1)
    renderer.xr.enabled = false
    renderer.shadowMap.enabled = false
    renderer.depth = false
    renderer.stencil = true
    scene.background = null
    scene.backgroundNode = null
    scene.overrideMaterial = null
    scene.name = 'temporary pass'
    camera.layers.set(7)
  }
  return {
    renderer,
    gpu: renderer as unknown as WebGPURenderer,
    scene,
    camera,
    snapshot,
    disturb,
    dispose() {
      retained.dispose()
      temporary.dispose()
      originalOverride.dispose()
    },
  }
}

describe('serialized native preparation state boundary', () => {
  it.each(['resolve', 'reject'] as const)(
    'restores complete caller state after asynchronous preparation %s',
    async (outcome) => {
      const f = fixture(),
        before = f.snapshot(),
        restore = preservePreparationState(f.gpu, f.scene, f.camera)
      try {
        const task = async () => {
          try {
            f.disturb()
            await Promise.resolve()
            if (outcome === 'reject') throw new Error('native compile rejected')
          } finally {
            restore()
          }
        }
        if (outcome === 'reject') await expect(task()).rejects.toThrow('native compile rejected')
        else await task()
        expect(f.snapshot()).toEqual(before)
      } finally {
        f.dispose()
      }
    },
  )

  it('keeps nested preparation snapshots independent and preserves original object identities', () => {
    const f = fixture(),
      initial = f.snapshot(),
      restoreOuter = preservePreparationState(f.gpu, f.scene, f.camera)
    try {
      f.disturb()
      const outer = f.snapshot(),
        restoreInner = preservePreparationState(f.gpu, f.scene, f.camera)
      f.renderer.toneMappingExposure = 3
      f.renderer.setViewport(new Vector4(1, 2, 3, 4))
      f.scene.background = new Color('#ffffff')
      f.camera.layers.set(2)
      restoreInner()
      expect(f.snapshot()).toEqual(outer)
      restoreOuter()
      expect(f.snapshot()).toEqual(initial)
      expect(f.scene.background).toBe(initial.background)
      expect(f.scene.backgroundNode).toBe(initial.backgroundNode)
      expect(f.renderer.contextNode).toBe(initial.context)
      expect(f.renderer.getMRT()).toBe(initial.mrt)
    } finally {
      f.dispose()
    }
  })
})
