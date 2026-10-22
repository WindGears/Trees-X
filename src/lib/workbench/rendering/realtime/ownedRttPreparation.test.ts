import { describe, expect, it, vi } from 'vitest'
import { Color, ColorManagement, NoToneMapping, RenderTarget, Vector4 } from 'three'
import { NodeFrame, type WebGPURenderer } from 'three/webgpu'
import { context, mrt, vec4 } from 'three/tsl'
import { compileOwnedRtt, createOwnedRtt, isolateOwnedRttMrt } from './ownedRtt'

function fixture() {
  const retained = new RenderTarget(4, 8),
    retainedMrt = mrt({ output: vec4(1) }),
    retainedContext = context({ purpose: 'host' })
  let target: RenderTarget | null = retained,
    activeMrt: ReturnType<typeof mrt> | null = retainedMrt
  const renderer = {
    toneMapping: 4,
    toneMappingExposure: 0.9,
    outputColorSpace: 'srgb',
    autoClear: false,
    opaque: false,
    transparent: true,
    depth: true,
    stencil: true,
    contextNode: retainedContext,
    xr: { enabled: true },
    getRenderTarget: () => target,
    setRenderTarget: vi.fn((value: RenderTarget | null) => {
      target = value
    }),
    getActiveCubeFace: () => 2,
    getActiveMipmapLevel: () => 1,
    getMRT: () => activeMrt,
    setMRT: vi.fn((value: ReturnType<typeof mrt> | null) => {
      activeMrt = value
    }),
    getRenderObjectFunction: () => null,
    setRenderObjectFunction: vi.fn(),
    getPixelRatio: () => 1.25,
    setPixelRatio: vi.fn(),
    getClearColor: (value: Color) => value.set('#123456'),
    getClearAlpha: () => 0.6,
    setClearColor: vi.fn(),
    getScissorTest: () => true,
    setScissorTest: vi.fn(),
    getViewport: (value: Vector4) => value.set(1, 2, 3, 4),
    getScissor: (value: Vector4) => value.set(5, 6, 7, 8),
    setViewport: vi.fn(),
    setScissor: vi.fn(),
    compileAsync: vi.fn<WebGPURenderer['compileAsync']>().mockResolvedValue(undefined),
    render: vi.fn(),
  }
  const gpu = renderer as unknown as WebGPURenderer
  function expectRestored() {
    expect(renderer.getRenderTarget()).toBe(retained)
    expect(renderer.getMRT()).toBe(retainedMrt)
    expect(renderer).toMatchObject({
      toneMapping: 4,
      outputColorSpace: 'srgb',
      opaque: false,
      transparent: true,
      depth: true,
      stencil: true,
    })
    expect(renderer.contextNode).toBe(retainedContext)
    expect(renderer.xr.enabled).toBe(true)
    expect(renderer.setViewport).toHaveBeenLastCalledWith(new Vector4(1, 2, 3, 4))
    expect(renderer.setScissor).toHaveBeenLastCalledWith(new Vector4(5, 6, 7, 8))
    expect(renderer.render).not.toHaveBeenCalled()
  }
  return { renderer, gpu, retainedMrt, expectRestored }
}

describe('shadow-only RTT shader preparation', () => {
  it.each(['success', 'failure'] as const)(
    'compiles the actual initialized quad with one linear HDR output and restores state on %s',
    async (mode) => {
      const f = fixture(),
        owner = createOwnedRtt(vec4(1)),
        fragment = vec4(0.25).context({})
      Reflect.set(owner.node, '_rttNode', fragment)
      const quad = Reflect.get(owner.node, '_quadMesh')
      f.renderer.compileAsync.mockImplementation(async () => {
        expect(f.renderer.getRenderTarget()).toBe(owner.node.renderTarget)
        expect(f.renderer.getMRT()).toBe(null)
        expect(f.renderer).toMatchObject({
          toneMapping: NoToneMapping,
          outputColorSpace: ColorManagement.workingColorSpace,
          opaque: true,
          transparent: false,
          depth: false,
          stencil: false,
        })
        expect(Reflect.get(Reflect.get(quad, 'material'), 'fragmentNode')).toBe(fragment)
        if (mode === 'failure') throw new Error('native compilation failed')
      })
      if (mode === 'failure')
        await expect(compileOwnedRtt(f.gpu, owner.node)).rejects.toThrow(
          'native compilation failed',
        )
      else await compileOwnedRtt(f.gpu, owner.node)
      expect(f.renderer.compileAsync).toHaveBeenCalledWith(quad, Reflect.get(quad, 'camera'))
      f.expectRestored()
      owner.dispose()
    },
  )

  it('rejects a changed quad contract before touching renderer state', async () => {
    const f = fixture(),
      owner = createOwnedRtt(vec4(1))
    Reflect.set(owner.node, '_quadMesh', {})
    await expect(compileOwnedRtt(f.gpu, owner.node)).rejects.toThrow('QuadMesh')
    expect(f.renderer.compileAsync).not.toHaveBeenCalled()
    expect(f.renderer.setMRT).not.toHaveBeenCalled()
    owner.dispose()
  })

  it('bootstraps a missing RTT graph then compiles the exact owned quad', async () => {
    const f = fixture(),
      owner = createOwnedRtt(vec4(1)),
      fragment = vec4(0.75).context({}),
      realQuad = Reflect.get(owner.node, '_quadMesh')
    let materialDispose: ReturnType<typeof vi.spyOn> | undefined,
      targetDispose: ReturnType<typeof vi.spyOn> | undefined
    f.renderer.compileAsync.mockImplementationOnce(async () => {
      const temporary = f.renderer.compileAsync.mock.calls[0]?.[0]
      expect(temporary).not.toBe(realQuad)
      const material = Reflect.get(temporary!, 'material')
      expect(Reflect.get(material, 'fragmentNode')).toBe(owner.node)
      materialDispose = vi.spyOn(material, 'dispose')
      const target = f.renderer.getRenderTarget()!
      expect([target.width, target.height, target.depthBuffer]).toEqual([1, 1, false])
      targetDispose = vi.spyOn(target, 'dispose')
      // The real renderer initializes this in RTTNode.setup during compilation.
      Reflect.set(owner.node, '_rttNode', fragment)
    })
    await compileOwnedRtt(f.gpu, owner.node)
    expect(f.renderer.compileAsync).toHaveBeenCalledTimes(2)
    expect(f.renderer.compileAsync.mock.calls[1]?.[0]).toBe(realQuad)
    expect(materialDispose).toHaveBeenCalledTimes(1)
    expect(targetDispose).toHaveBeenCalledTimes(1)
    f.expectRestored()
    owner.dispose()
  })

  it.each(['native failure', 'missing fragment'] as const)(
    'releases bootstrap owners and restores renderer after %s',
    async (mode) => {
      const f = fixture(),
        owner = createOwnedRtt(vec4(1))
      let materialDispose: ReturnType<typeof vi.spyOn> | undefined,
        targetDispose: ReturnType<typeof vi.spyOn> | undefined
      f.renderer.compileAsync.mockImplementationOnce(async () => {
        const temporary = f.renderer.compileAsync.mock.calls[0]?.[0]
        materialDispose = vi.spyOn(Reflect.get(temporary!, 'material'), 'dispose')
        targetDispose = vi.spyOn(f.renderer.getRenderTarget()!, 'dispose')
        if (mode === 'native failure') throw new Error('native failed')
      })
      await expect(compileOwnedRtt(f.gpu, owner.node)).rejects.toThrow(
        mode === 'native failure' ? 'native failed' : 'fragment graph',
      )
      expect(f.renderer.compileAsync).toHaveBeenCalledTimes(1)
      expect(materialDispose).toHaveBeenCalledTimes(1)
      expect(targetDispose).toHaveBeenCalledTimes(1)
      f.expectRestored()
      owner.dispose()
    },
  )

  it('uses the same stable context identity for native compilation and actual RTT updates', async () => {
    const f = fixture(),
      owner = createOwnedRtt(vec4(1))
    Reflect.set(owner.node, '_rttNode', vec4(0.5).context({}))
    const contexts: unknown[] = []
    owner.node.updateBefore = function (frame) {
      contexts.push(frame.renderer?.contextNode)
      return false
    }
    const restore = isolateOwnedRttMrt(owner.node)
    expect(() => isolateOwnedRttMrt(owner.node)).toThrow('already has an owner')
    f.renderer.compileAsync.mockImplementation(async () => {
      contexts.push(f.renderer.contextNode)
    })
    await compileOwnedRtt(f.gpu, owner.node)
    const frame = new NodeFrame()
    frame.renderer = f.gpu
    owner.node.updateBefore(frame)
    owner.node.updateBefore(frame)
    expect(contexts).toHaveLength(3)
    expect(contexts[0]).toBe(contexts[1])
    expect(contexts[1]).toBe(contexts[2])
    f.expectRestored()
    restore()
    owner.dispose()
  })

  it.each([false, true])(
    'isolates only the opted-in RTT and restores host MRT after throw=%s',
    (throws) => {
      const f = fixture(),
        owner = createOwnedRtt(vec4(1)),
        untouched = createOwnedRtt(vec4(0))
      const originalOther = untouched.node.updateBefore
      const original: typeof owner.node.updateBefore = function (this: typeof owner.node) {
        expect(this).toBe(owner.node)
        expect(f.renderer.getMRT()).toBe(null)
        if (throws) throw new Error('quad failed')
        return false
      }
      owner.node.updateBefore = original
      const restore = isolateOwnedRttMrt(owner.node),
        frame = new NodeFrame()
      frame.renderer = f.gpu
      if (throws) expect(() => owner.node.updateBefore(frame)).toThrow('quad failed')
      else expect(owner.node.updateBefore(frame)).toBe(false)
      expect(f.renderer.getMRT()).toBe(f.retainedMrt)
      expect(untouched.node.updateBefore).toBe(originalOther)
      restore()
      restore()
      expect(owner.node.updateBefore).toBe(original)
      untouched.dispose()
      owner.dispose()
    },
  )
})
