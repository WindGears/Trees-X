/* global window */

/** Test-window only. Observe the renderer's existing shadow RTTs. Explicit read()
 * performs two bounded native GPU readbacks, never a production/per-frame hook.
 * Kept self-contained so Playwright can serialize this function unchanged.
 */
export function installCarShadowVisibilityObservation(environment = window) {
  const renderer = environment.__demo?.scene?.renderer?.instance
  if (!renderer?.backend?.isWebGPUBackend || typeof renderer.setRenderTarget !== 'function')
    throw new Error('Actual WebGPU renderer is required for visibility observation')
  if (
    environment.__carShadowVisibilityObservation &&
    !environment.__carShadowVisibilityObservation.snapshot().stopped
  )
    throw new Error('Visibility observation already has an owner')
  const names = ['TreesX.CarShadow.rawVisibility', 'TreesX.CarShadow.filteredVisibility']
  const original = renderer.setRenderTarget
  const targets = new Map()
  let stopped = false,
    reading = false,
    reads = 0

  const half = (bits) => {
    const sign = bits & 0x8000 ? -1 : 1
    const exponent = (bits >>> 10) & 31
    const fraction = bits & 1023
    if (exponent === 31) return fraction ? NaN : sign * Infinity
    if (exponent === 0) return sign * fraction * 2 ** -24
    return sign * (1 + fraction / 1024) * 2 ** (exponent - 15)
  }

  const wrapper = function (target, ...args) {
    const result = original.call(this, target, ...args)
    for (const [index, texture] of (target?.textures ?? []).entries()) {
      if (!names.includes(texture?.name)) continue
      const previous = targets.get(texture.name)
      targets.set(texture.name, {
        target,
        index,
        texture,
        observedBinds: (previous?.observedBinds ?? 0) + 1,
        observedRendererFrame: renderer.info?.frame ?? null,
      })
    }
    return result
  }

  const snapshot = () => ({
    stopped,
    reading,
    reads,
    targets: [...targets].map(([name, entry]) => ({
      name,
      textureUuid: entry.texture.uuid ?? null,
      width: entry.target.width,
      height: entry.target.height,
      observedBinds: entry.observedBinds,
      observedRendererFrame: entry.observedRendererFrame,
    })),
  })

  const readTarget = async (name, rectangle) => {
    const entry = targets.get(name)
    if (!entry) throw new Error('Existing shadow target has not rendered: ' + name)
    const { target, index, texture } = entry
    const area = rectangle ?? { x: 0, y: 0, width: target.width, height: target.height }
    for (const key of ['x', 'y', 'width', 'height'])
      if (!Number.isSafeInteger(area[key])) throw new Error('Integer readback rectangle required')
    if (
      area.x < 0 ||
      area.y < 0 ||
      area.width < 1 ||
      area.height < 1 ||
      area.x + area.width > target.width ||
      area.y + area.height > target.height ||
      area.width * area.height > 4194304
    )
      throw new Error('Visibility readback rectangle is outside the bounded actual target')
    const format = renderer.backend.get(texture)?.textureDescriptorGPU?.format
    const formats = {
      rgba16float: { bytes: 2, type: 'Uint16Array', decode: half },
      rgba32float: { bytes: 4, type: 'Float32Array', decode: (value) => value },
      rgba8unorm: { bytes: 1, type: 'Uint8Array', decode: (value) => value / 255 },
    }
    const layout = formats[format]
    if (!layout) throw new Error('Unreviewed shadow GPU texture format: ' + String(format))
    const data = await renderer.readRenderTargetPixelsAsync(
      target,
      area.x,
      area.y,
      area.width,
      area.height,
      index,
    )
    if (stopped) throw new Error('Visibility observation stopped during readback')
    if (
      Object.prototype.toString.call(data) !== '[object ' + layout.type + ']' ||
      data.BYTES_PER_ELEMENT !== layout.bytes
    )
      throw new Error('Native readback typed array does not match actual GPU format')
    const rowBytes = area.width * 4 * layout.bytes
    const alignedRowBytes = Math.ceil(rowBytes / 256) * 256
    const expectedBytes = (area.height - 1) * alignedRowBytes + rowBytes
    if (data.byteLength !== expectedBytes)
      throw new Error('Native r185 row padding / texture readback layout changed')
    const rowElements = alignedRowBytes / layout.bytes
    let finite = 0,
      nonFinite = 0,
      min = Infinity,
      max = -Infinity,
      total = 0
    let shadowed = 0,
      lit = 0,
      fractional = 0,
      outsideUnitRange = 0
    let alphaMin = Infinity,
      alphaMax = -Infinity,
      nonFiniteAlpha = 0,
      rgbMismatch = 0
    const bins = [0, 0, 0, 0, 0, 0]
    for (let y = 0; y < area.height; y++)
      for (let x = 0; x < area.width; x++) {
        const offset = y * rowElements + x * 4
        const value = layout.decode(data[offset])
        const alpha = layout.decode(data[offset + 3])
        if (Number.isFinite(alpha)) {
          alphaMin = Math.min(alphaMin, alpha)
          alphaMax = Math.max(alphaMax, alpha)
        } else nonFiniteAlpha++
        if (!Number.isFinite(value)) {
          nonFinite++
          continue
        }
        finite++
        min = Math.min(min, value)
        max = Math.max(max, value)
        total += value
        shadowed += value < 0.999
        lit += value >= 0.999
        fractional += value > 0.001 && value < 0.999
        outsideUnitRange += value < -0.001 || value > 1.001
        rgbMismatch +=
          Math.abs(layout.decode(data[offset + 1]) - value) > 0.001 ||
          Math.abs(layout.decode(data[offset + 2]) - value) > 0.001
        bins[
          value < 0.05
            ? 0
            : value < 0.25
              ? 1
              : value < 0.5
                ? 2
                : value < 0.75
                  ? 3
                  : value < 0.95
                    ? 4
                    : 5
        ]++
      }
    return {
      name,
      textureUuid: texture.uuid ?? null,
      format,
      nativeTypedArray: layout.type,
      rectangle: { ...area },
      targetSize: [target.width, target.height],
      rowBytes,
      alignedRowBytes,
      nativeBytes: data.byteLength,
      observedBinds: entry.observedBinds,
      observedRendererFrame: entry.observedRendererFrame,
      samples: area.width * area.height,
      finite,
      nonFinite,
      min: finite ? min : null,
      max: finite ? max : null,
      mean: finite ? total / finite : null,
      shadowed,
      lit,
      fractional,
      outsideUnitRange,
      rgbMismatch,
      shadowedFractionOfAllReadPixels: shadowed / (area.width * area.height),
      histogram: { edges: [0, 0.05, 0.25, 0.5, 0.75, 0.95, 1], counts: bins },
      alpha: {
        min: Number.isFinite(alphaMin) ? alphaMin : null,
        max: Number.isFinite(alphaMax) ? alphaMax : null,
        nonFinite: nonFiniteAlpha,
      },
      nontrivialVisibility: shadowed > 0 && lit > 0,
    }
  }

  renderer.setRenderTarget = wrapper
  environment.__carShadowVisibilityObservation = {
    snapshot,
    async read(rectangle) {
      if (stopped || reading)
        throw new Error('Visibility observation is stopped or already reading')
      reading = true
      try {
        await renderer.backend.device.queue.onSubmittedWorkDone()
        const raw = await readTarget(names[0], rectangle)
        const filtered = await readTarget(names[1], rectangle)
        reads++
        return {
          reads,
          raw,
          filtered,
          method:
            'Explicit one-off native WebGPU RTT readback, actual format and r185 256-byte row stride checked. No target substitution or per-frame readback.',
          limitation:
            'Targets may be from adjacent completed frames; distributions prove nonconstant visibility, not correct occlusion, receiver-only coverage or image quality.',
        }
      } finally {
        reading = false
      }
    },
    stop() {
      if (renderer.setRenderTarget === wrapper) renderer.setRenderTarget = original
      stopped = true
      const result = { ...snapshot(), restored: renderer.setRenderTarget === original }
      targets.clear()
      return result
    },
  }
  return snapshot()
}
