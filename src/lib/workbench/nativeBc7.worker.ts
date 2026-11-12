import { ZSTDDecoder } from 'three/addons/libs/zstddec.module.js'
import type { NativeBc7Level, NativeBc7Reply } from './nativeBc7'

const decoder = new ZSTDDecoder()
let ready: Promise<void> | undefined
self.onmessage = async ({ data: input }: MessageEvent<NativeBc7Level[]>) => {
  try {
    await (ready ??= decoder.init())
    const levels = input.map(({ data, bytes }) => {
      const result = decoder.decode(data, bytes)
      if (result.byteLength !== bytes) throw new Error('Invalid BC7 mip size after decoding')
      return result
    })
    const reply: NativeBc7Reply = { levels }
    self.postMessage(reply, { transfer: levels.map(({ buffer }) => buffer) })
  } catch (cause) {
    const reply: NativeBc7Reply = { error: String(cause) }
    self.postMessage(reply)
  }
}
