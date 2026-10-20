/* global window */

/** Test-only inspection. Evaluated in the page without module closures, GPU work,
 * uploads or readback. Count the native allocation, not UV Texture wrappers.
 */
export function collectModelTextureDescriptors(root, renderer) {
  if (!root && !renderer) {
    const context = window.__demo.scene
    root = context.scene.value.children.find((node) => node.userData.workbenchProduct)
    renderer = context.renderer.instance
  }
  const sources = new Set(),
    native = new Map()
  let uninitializedSourceTextures = 0
  root?.traverse((node) => {
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
      if (!material) continue
      for (const value of Object.values(material)) if (value?.isTexture) sources.add(value)
    }
  })
  for (const source of sources) {
    const texture = renderer.backend.get(source)?.texture
    if (!texture) {
      uninitializedSourceTextures++
      continue
    }
    const entry = native.get(texture)
    if (entry) {
      entry.sourceTextureCount++
      continue
    }
    native.set(texture, {
      width: texture.width,
      height: texture.height,
      depthOrArrayLayers: texture.depthOrArrayLayers,
      mipLevelCount: texture.mipLevelCount,
      sampleCount: texture.sampleCount,
      dimension: texture.dimension,
      format: texture.format,
      sourceTextureCount: 1,
    })
  }
  return {
    sourceTextures: sources.size,
    uninitializedSourceTextures,
    initializedNativeTextures: native.size,
    nativeTextures: [...native.values()],
  }
}

function blockLayout(format) {
  if (/^bc1-rgba-unorm(-srgb)?$|^bc4-r-(unorm|snorm)$/.test(format))
    return { width: 4, height: 4, bytes: 8 }
  if (/^bc[237]-rgba-unorm(-srgb)?$|^bc5-rg-(unorm|snorm)$|^bc6h-rgb-(ufloat|float)$/.test(format))
    return { width: 4, height: 4, bytes: 16 }
  if (/^etc2-(rgb8|rgb8a1)unorm(-srgb)?$/.test(format)) return { width: 4, height: 4, bytes: 8 }
  if (/^etc2-rgba8unorm(-srgb)?$/.test(format)) return { width: 4, height: 4, bytes: 16 }
  if (/^eac-r11unorm$|^eac-r11snorm$/.test(format)) return { width: 4, height: 4, bytes: 8 }
  if (/^eac-rg11unorm$|^eac-rg11snorm$/.test(format)) return { width: 4, height: 4, bytes: 16 }
  const astc = /^astc-(\d+)x(\d+)-unorm(-srgb)?$/.exec(format)
  if (astc) return { width: Number(astc[1]), height: Number(astc[2]), bytes: 16 }
  const bytes = {
    r8unorm: 1,
    r8snorm: 1,
    r8uint: 1,
    r8sint: 1,
    r16uint: 2,
    r16sint: 2,
    r16float: 2,
    rg8unorm: 2,
    rg8snorm: 2,
    rg8uint: 2,
    rg8sint: 2,
    r32uint: 4,
    r32sint: 4,
    r32float: 4,
    rg16uint: 4,
    rg16sint: 4,
    rg16float: 4,
    rgba8unorm: 4,
    'rgba8unorm-srgb': 4,
    rgba8snorm: 4,
    rgba8uint: 4,
    rgba8sint: 4,
    bgra8unorm: 4,
    'bgra8unorm-srgb': 4,
    rgb10a2uint: 4,
    rgb10a2unorm: 4,
    rg11b10ufloat: 4,
    rgb9e5ufloat: 4,
    rg32uint: 8,
    rg32sint: 8,
    rg32float: 8,
    rgba16uint: 8,
    rgba16sint: 8,
    rgba16float: 8,
    rgba32uint: 16,
    rgba32sint: 16,
    rgba32float: 16,
    depth16unorm: 2,
    depth32float: 4,
    stencil8: 1,
  }[format]
  return bytes ? { width: 1, height: 1, bytes } : null
}

/** Logical texel/block storage only. Excludes implementation alignment, driver
 * metadata, physical residency, CPU images and every non-model scene resource.
 */
export function estimateTextureBytes(descriptor) {
  const { width, height, depthOrArrayLayers, mipLevelCount, sampleCount, dimension, format } =
      descriptor,
    layout = blockLayout(format)
  if (!layout) return { known: false, bytes: null, reason: `Unknown storage layout: ${format}` }
  if (
    ![width, height, depthOrArrayLayers, mipLevelCount, sampleCount].every(
      (value) => Number.isSafeInteger(value) && value > 0,
    ) ||
    !['1d', '2d', '3d'].includes(dimension)
  )
    return {
      known: false,
      bytes: null,
      reason: 'Incomplete or invalid native GPUTexture descriptor',
    }
  let bytes = 0
  for (let mip = 0; mip < mipLevelCount; mip++) {
    const mipWidth = Math.max(1, Math.floor(width / 2 ** mip)),
      mipHeight = dimension === '1d' ? 1 : Math.max(1, Math.floor(height / 2 ** mip)),
      layers =
        dimension === '3d'
          ? Math.max(1, Math.floor(depthOrArrayLayers / 2 ** mip))
          : depthOrArrayLayers
    bytes +=
      Math.ceil(mipWidth / layout.width) *
      Math.ceil(mipHeight / layout.height) *
      layers *
      layout.bytes *
      sampleCount
  }
  return Number.isSafeInteger(bytes)
    ? { known: true, bytes, reason: null }
    : { known: false, bytes: null, reason: 'Logical storage exceeds exact integer range' }
}

export function summarizeModelTextureMemory(collected) {
  const nativeTextures = collected.nativeTextures.map((descriptor) => ({
      ...descriptor,
      storage: estimateTextureBytes(descriptor),
    })),
    unknownTextures = nativeTextures.filter((texture) => !texture.storage.known).length,
    knownBytes = nativeTextures.reduce((sum, texture) => sum + (texture.storage.bytes ?? 0), 0)
  return {
    ...collected,
    nativeTextures,
    knownBytes,
    totalBytes: unknownTextures === 0 ? knownBytes : null,
    unknownTextures,
    meaning:
      'Logical block/texel storage inferred from initialized model GPUTexture descriptors; not physical resident VRAM or complete scene allocation. Driver alignment and metadata are excluded.',
  }
}
