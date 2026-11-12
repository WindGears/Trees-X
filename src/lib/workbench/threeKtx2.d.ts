declare module 'three/addons/libs/ktx-parse.module.js' {
  export const VK_FORMAT_BC7_UNORM_BLOCK: number
  export const VK_FORMAT_BC7_SRGB_BLOCK: number
  export const KHR_SUPERCOMPRESSION_ZSTD: number
  export const KHR_DF_PRIMARIES_BT709: number
  export const KHR_DF_PRIMARIES_UNSPECIFIED: number
  export const KHR_DF_TRANSFER_LINEAR: number
  export const KHR_DF_TRANSFER_SRGB: number

  export function read(bytes: Uint8Array): {
    vkFormat: number
    typeSize: number
    pixelWidth: number
    pixelHeight: number
    pixelDepth: number
    layerCount: number
    faceCount: number
    levelCount: number
    supercompressionScheme: number
    keyValue: Record<string, string | Uint8Array>
    dataFormatDescriptor: {
      flags: number
      colorPrimaries: number
      transferFunction: number
    }[]
    levels: { levelData: Uint8Array; uncompressedByteLength: number }[]
  }
}

declare module 'three/addons/libs/zstddec.module.js' {
  export class ZSTDDecoder {
    init(): Promise<void>
    decode(data: Uint8Array, bytes: number): Uint8Array<ArrayBuffer>
  }
}
