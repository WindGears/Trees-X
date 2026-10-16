import { sha256 } from '../assetBundle'

export const loungeDepthRecord = {
  url: '/studio/amber-lounge/spatial-v1/radial-distance.f32',
  width: 512,
  height: 256,
  bytes: 524288,
  sha256: 'dfb53155cf4443a3eb2a606e08a6b17c8955829a2e961e0da5d761c451499678',
} as const

/** Numerical radial distance, never RGB, view-Z or a certified metric reconstruction. */
export async function loadLoungeDepth(signal: AbortSignal) {
  signal.throwIfAborted()
  const response = await fetch(loungeDepthRecord.url, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(60_000)]),
    mode: 'same-origin',
    redirect: 'error',
  })
  if (!response.ok) throw new Error(`全景深度读取失败 (${response.status})`)
  const bytes = await response.arrayBuffer()
  signal.throwIfAborted()
  if (
    bytes.byteLength !== loungeDepthRecord.bytes ||
    (await sha256(bytes)) !== loungeDepthRecord.sha256
  )
    throw new Error('全景深度数据校验失败')
  signal.throwIfAborted()
  const view = new DataView(bytes),
    distance = new Float32Array(loungeDepthRecord.width * loungeDepthRecord.height)
  for (let index = 0; index < distance.length; index++) {
    const value = view.getFloat32(index * 4, true)
    if (!Number.isFinite(value) || value <= 0) throw new Error('全景深度含无效径向距离')
    distance[index] = value
  }
  return { distance, width: loungeDepthRecord.width, height: loungeDepthRecord.height }
}
