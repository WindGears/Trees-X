import { describe, expect, it, vi } from 'vitest'
import { Texture } from 'three'
import { texture, vec4 } from 'three/tsl'
import { createOwnedRtt } from './ownedRtt'

describe('explicit RTT lifecycle for r185 effect inputs', () => {
  it('releases its target and material once, borrowing its input and shared quad geometry', () => {
    const source = new Texture(),
      upstreamDispose = vi.spyOn(source, 'dispose'),
      owner = createOwnedRtt(texture(source)),
      targetDispose = vi.spyOn(owner.node.renderTarget!, 'dispose')
    const quad = Reflect.get(owner.node, '_quadMesh') as {
      material: { dispose(): void }
      geometry: { dispose(): void }
    }
    const materialDispose = vi.spyOn(quad.material, 'dispose'),
      geometryDispose = vi.spyOn(quad.geometry, 'dispose')
    expect(owner.node.renderTarget!.depthBuffer).toBe(false)
    owner.dispose()
    owner.dispose()
    expect(targetDispose).toHaveBeenCalledTimes(1)
    expect(materialDispose).toHaveBeenCalledTimes(1)
    expect(geometryDispose).not.toHaveBeenCalled()
    expect(upstreamDispose).not.toHaveBeenCalled()
    geometryDispose.mockRestore()
    source.dispose()
  })

  it('keeps separately owned RTT inputs independent', () => {
    const first = createOwnedRtt(vec4(1)),
      second = createOwnedRtt(first.node),
      firstDispose = vi.spyOn(first.node.renderTarget!, 'dispose')
    second.dispose()
    expect(firstDispose).not.toHaveBeenCalled()
    first.dispose()
    expect(firstDispose).toHaveBeenCalledTimes(1)
  })

  it('rejects an unreviewed Three version before creating an RTT', () => {
    expect(() => createOwnedRtt(vec4(1), '186')).toThrow('must be reviewed')
  })
})
