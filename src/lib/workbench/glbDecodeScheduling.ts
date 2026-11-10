import { REVISION, type BufferGeometry } from 'three'
import type { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'
import { heavyWork, taskSlots } from './decodeQueue'

// Decoder instances remain parse-owned. A replacement cannot create another KTX2
// worker pool until the previous parser has settled and disposed its pool.
export const decoderOwner = taskSlots(1)

interface DracoDecodeBridge {
  decodeGeometry(data: ArrayBuffer, config: unknown): Promise<BufferGeometry>
}

/** r185 private bridge: only scheduling changes; decode results and ownership do not. */
export function boundDracoDecode(loader: DRACOLoader, signal: AbortSignal, run = heavyWork) {
  const bridge = loader as DRACOLoader & DracoDecodeBridge
  if (REVISION !== '185' || typeof bridge.decodeGeometry !== 'function')
    throw new Error('Draco 调度桥接与当前 Three 版本不匹配')
  const decode = bridge.decodeGeometry.bind(loader)
  bridge.decodeGeometry = (data, config) => run(signal, () => decode(data, config))
}

export function boundMeshoptDecode(signal: AbortSignal, run = heavyWork): typeof MeshoptDecoder {
  return {
    ...MeshoptDecoder,
    decodeGltfBufferAsync: (...args) =>
      run(signal, () => MeshoptDecoder.decodeGltfBufferAsync(...args)),
  }
}
