import { afterEach, describe, expect, it, vi } from 'vitest'
import { BufferGeometry } from 'three'
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'
import { boundDracoDecode, boundMeshoptDecode } from './glbDecodeScheduling'
import { heavyWork } from './decodeQueue'

afterEach(() => vi.restoreAllMocks())

describe('shared geometry and texture decode scheduling', () => {
  it('shares the two heavy-work slots across Draco, Meshopt and image work', async () => {
    let active = 0,
      maximum = 0
    const work = async () => {
      active++
      maximum = Math.max(maximum, active)
      await new Promise((resolve) => setTimeout(resolve, 1))
      active--
    }
    const geometry = new BufferGeometry(),
      signal = new AbortController().signal
    const draco = new DRACOLoader() as DRACOLoader & {
      decodeGeometry(buffer: ArrayBuffer, config: unknown): Promise<BufferGeometry>
    }
    const decode = vi.fn(async () => {
      await work()
      return geometry
    })
    draco.decodeGeometry = decode
    boundDracoDecode(draco, signal)
    vi.spyOn(MeshoptDecoder, 'decodeGltfBufferAsync').mockImplementation(async () => {
      await work()
      return new Uint8Array(4)
    })
    const meshopt = boundMeshoptDecode(signal)
    await Promise.all([
      draco.decodeGeometry(new ArrayBuffer(4), {}),
      meshopt.decodeGltfBufferAsync(1, 4, new Uint8Array(4), 'ATTRIBUTES'),
      heavyWork(signal, work),
      heavyWork(signal, work),
    ])
    expect(maximum).toBe(2)
    expect(decode).toHaveBeenCalledTimes(1)
    expect(meshopt.ready).toBe(MeshoptDecoder.ready)
    expect(meshopt.supported).toBe(MeshoptDecoder.supported)
    draco.dispose()
    geometry.dispose()
  })
  it('fails explicitly for an incompatible Draco private bridge', () => {
    expect(() => boundDracoDecode({} as DRACOLoader, new AbortController().signal)).toThrow('桥接')
  })
})
