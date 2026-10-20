import { describe, expect, it, vi } from 'vitest'
import { HalfFloatType, NoColorSpace, Texture } from 'three'
import { Fn, outputStruct, texture, vec4 } from 'three/tsl'
import { TextureNode, type NodeBuilder } from 'three/webgpu'
import { createSignedHistoryOutput } from './signedHistoryOutput'

describe('one-draw signed reflection history MRT owner', () => {
  it('requires a direct output struct and forwards its marker through the native RTT shared context', () => {
    expect(() => createSignedHistoryOutput(Fn(() => outputStruct(vec4(0), vec4(1)))())).toThrow(
      'top-level output struct',
    )
    const expression = outputStruct(vec4(0), vec4(1)),
      owner = createSignedHistoryOutput(expression),
      sharedContext = { userMarker: 'shared' },
      nativeSetup = vi.spyOn(TextureNode.prototype, 'setup').mockReturnValue(null)
    try {
      owner.node.setup({ getSharedContext: () => sharedContext } as unknown as NodeBuilder)
      const fragment = Reflect.get(owner.node, '_rttNode')
      expect(fragment.isContextNode).toBe(true)
      expect(fragment.isOutputStructNode).toBe(true)
      expect(fragment.node).toBe(expression)
      expect(fragment.value).toBe(sharedContext)
      expect(nativeSetup).toHaveBeenCalledTimes(1)
    } finally {
      nativeSetup.mockRestore()
      owner.dispose()
    }
  })

  it('owns two linear HalfFloat attachments and the quad material exactly once', () => {
    const source = new Texture(),
      sourceDispose = vi.spyOn(source, 'dispose'),
      owner = createSignedHistoryOutput(outputStruct(texture(source), vec4(0))),
      target = owner.node.renderTarget!,
      targetDispose = vi.spyOn(target, 'dispose')
    const quad = Reflect.get(owner.node, '_quadMesh') as {
      material: { dispose(): void }
      geometry: { dispose(): void }
    }
    const materialDispose = vi.spyOn(quad.material, 'dispose'),
      geometryDispose = vi.spyOn(quad.geometry, 'dispose')
    expect(target.textures).toHaveLength(2)
    expect(owner.statistics.value).toBe(target.textures[1])
    for (const attachment of target.textures) {
      expect(attachment.type).toBe(HalfFloatType)
      expect(attachment.colorSpace).toBe(NoColorSpace)
    }
    expect(target.depthBuffer).toBe(false)
    owner.dispose()
    owner.dispose()
    expect(targetDispose).toHaveBeenCalledTimes(1)
    expect(materialDispose).toHaveBeenCalledTimes(1)
    expect(geometryDispose).not.toHaveBeenCalled()
    expect(sourceDispose).not.toHaveBeenCalled()
    geometryDispose.mockRestore()
    source.dispose()
  })
})
