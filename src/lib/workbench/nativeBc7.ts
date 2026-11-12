import {
  CompressedTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  LinearSRGBColorSpace,
  NoColorSpace,
  REVISION,
  RGBA_BPTC_Format,
  SRGBColorSpace,
  UnsignedByteType,
} from 'three'
import {
  KHR_DF_PRIMARIES_BT709,
  KHR_DF_PRIMARIES_UNSPECIFIED,
  KHR_DF_TRANSFER_LINEAR,
  KHR_DF_TRANSFER_SRGB,
  KHR_SUPERCOMPRESSION_ZSTD,
  VK_FORMAT_BC7_SRGB_BLOCK,
  VK_FORMAT_BC7_UNORM_BLOCK,
  read,
} from 'three/addons/libs/ktx-parse.module.js'
import { decodeQueue } from './decodeQueue'

export interface NativeBc7Level {
  data: Uint8Array
  bytes: number
}

export type NativeBc7Reply = { levels: Uint8Array<ArrayBuffer>[] } | { error: string }

interface DecodeWorker {
  onmessage: ((event: MessageEvent<NativeBc7Reply>) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
  onmessageerror: ((event: MessageEvent) => void) | null
  postMessage(levels: NativeBc7Level[]): void
  terminate(): void
}

/** Match the registered native cache and leave portable/unknown KTX2 to Three. */
export function inspectNativeBc7(bytes: ArrayBuffer) {
  if (REVISION !== '185' || bytes.byteLength < 104) return
  const format = new DataView(bytes).getUint32(12, true)
  const srgb = format === VK_FORMAT_BC7_SRGB_BLOCK
  if (!srgb && format !== VK_FORMAT_BC7_UNORM_BLOCK) return

  let container: ReturnType<typeof read>
  try {
    container = read(new Uint8Array(bytes))
  } catch {
    return
  }
  const { pixelWidth: width, pixelHeight: height, levels, dataFormatDescriptor } = container
  const descriptor = dataFormatDescriptor[0]
  if (
    container.supercompressionScheme !== KHR_SUPERCOMPRESSION_ZSTD ||
    container.typeSize !== 1 ||
    container.pixelDepth !== 0 ||
    container.faceCount !== 1 ||
    container.layerCount !== 0 ||
    container.keyValue.KTXorientation !== 'rd' ||
    width < 1 ||
    height < 1 ||
    Math.max(width, height) > 4096 ||
    container.levelCount !== 1 + Math.floor(Math.log2(Math.max(width, height))) ||
    levels.length !== container.levelCount ||
    descriptor?.flags !== 0 ||
    descriptor.transferFunction !== (srgb ? KHR_DF_TRANSFER_SRGB : KHR_DF_TRANSFER_LINEAR) ||
    ![KHR_DF_PRIMARIES_BT709, KHR_DF_PRIMARIES_UNSPECIFIED].includes(descriptor.colorPrimaries) ||
    (srgb && descriptor.colorPrimaries !== KHR_DF_PRIMARIES_BT709)
  )
    return

  const mips = levels.map(({ levelData: data, uncompressedByteLength: bytes }, level) => ({
    data,
    bytes,
    width: Math.max(1, width >> level),
    height: Math.max(1, height >> level),
    depth: 0,
  }))
  if (
    mips.some(
      (mip) =>
        !mip.data.byteLength ||
        mip.bytes !== Math.ceil(mip.width / 4) * Math.ceil(mip.height / 4) * 16,
    )
  )
    return
  const colorSpace =
    descriptor.colorPrimaries === KHR_DF_PRIMARIES_UNSPECIFIED
      ? NoColorSpace
      : srgb
        ? SRGBColorSpace
        : LinearSRGBColorSpace
  return { width, height, mips, colorSpace }
}

function makeWorker() {
  return new Worker(new URL('./nativeBc7.worker.ts', import.meta.url), {
    type: 'module',
    name: 'TreesX.NativeBC7',
  })
}

/** One GLB parse owns both workers. Keep verified inputs intact for Three's fallback. */
export function createNativeBc7Decoder(
  signal: AbortSignal,
  spawn: () => DecodeWorker = makeWorker,
) {
  type Resolve = (levels: Uint8Array<ArrayBuffer>[]) => void
  interface Slot {
    worker: DecodeWorker
    pending?: { resolve: Resolve; reject(error: unknown): void }
  }
  const slots: Slot[] = []
  const schedule = decodeQueue(2, signal)
  let closed = false
  let failure: unknown
  const abort = () => close(signal.reason)

  function close(error: unknown) {
    if (closed) return
    closed = true
    failure = error
    signal.removeEventListener('abort', abort)
    for (const { worker, pending } of slots) {
      worker.terminate()
      pending?.reject(error)
    }
    slots.length = 0
  }

  function slotForJob() {
    const free = slots.find((slot) => !slot.pending)
    if (free) return free
    const worker = spawn()
    const slot: Slot = { worker }
    slots.push(slot)
    worker.onmessage = ({ data }: MessageEvent<NativeBc7Reply>) => {
      const pending = slot.pending
      slot.pending = undefined
      if (!pending || closed) return
      if ('error' in data) {
        const cause = new Error(data.error)
        pending.reject(cause)
        close(cause)
      } else pending.resolve(data.levels)
    }
    worker.onerror = (event) => {
      event.preventDefault()
      close(new Error('BC7 texture worker failed'))
    }
    worker.onmessageerror = () => close(new Error('Invalid BC7 texture worker message'))
    return slot
  }

  function decode(levels: NativeBc7Level[]) {
    return schedule(
      () =>
        new Promise<Uint8Array<ArrayBuffer>[]>((resolve, reject) => {
          if (closed) return reject(failure)
          try {
            const slot = slotForJob()
            slot.pending = { resolve, reject }
            // The two workers clone only their active compressed inputs. They
            // transfer the substantially larger output blocks back to the loader.
            slot.worker.postMessage(levels)
          } catch (cause) {
            close(cause)
            reject(cause)
          }
        }),
    )
  }

  signal.throwIfAborted()
  signal.addEventListener('abort', abort, { once: true })
  return {
    load(bytes: ArrayBuffer) {
      if (closed) return
      const info = inspectNativeBc7(bytes)
      if (!info) return
      return decode(info.mips.map(({ data, bytes }) => ({ data, bytes }))).then((levels) => {
        signal.throwIfAborted()
        if (
          levels.length !== info.mips.length ||
          levels.some((data, index) => data.byteLength !== info.mips[index]?.bytes)
        )
          throw new Error('Invalid BC7 texture worker output')
        const texture = new CompressedTexture(
          info.mips.map(({ width, height, depth }, index) => ({
            width,
            height,
            depth,
            data: levels[index]!,
          })),
          info.width,
          info.height,
          RGBA_BPTC_Format,
          UnsignedByteType,
        )
        texture.colorSpace = info.colorSpace
        texture.minFilter = levels.length > 1 ? LinearMipmapLinearFilter : LinearFilter
        texture.magFilter = LinearFilter
        texture.needsUpdate = true
        return texture
      })
    },
    dispose() {
      close(new Error('BC7 texture decoder disposed'))
    },
  }
}
