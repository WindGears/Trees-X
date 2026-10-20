/* global window, performance, queueMicrotask, setInterval, clearInterval */

/** Evaluated only inside the disposable browser test page. These wrappers never
 * create a renderer, dispatch work, alter quality or install a drawing clock.
 */
export function installGpuSampler() {
  const renderer = window.__demo.scene.renderer.instance,
    backend = renderer.backend,
    samples = [],
    errors = [],
    labels = new Map(),
    supported = Boolean(backend.device?.features?.has('timestamp-query') && backend.trackTimestamp)
  let segment = 'warmup',
    pending,
    stopped = false,
    currentLabel = null
  const originalRender = backend.beginRender,
    originalCompute = backend.beginCompute,
    originalQuery = backend.initTimestampQuery
  if (supported) {
    backend.beginRender = function (context) {
      const previous = currentLabel
      currentLabel = {
        context: context.id,
        name: context.camera?.name || 'render-pass',
        target:
          context.renderTarget?.texture?.name || (context.renderTarget ? 'offscreen' : 'canvas'),
        attachments: context.textures?.map(
          (value) => value.name || `${value.format}:${value.type}`,
        ) ?? ['canvas'],
        width: context.renderTarget?.width ?? renderer.domElement.width,
        height: context.renderTarget?.height ?? renderer.domElement.height,
      }
      try {
        return originalRender.call(this, context)
      } finally {
        currentLabel = previous
      }
    }
    backend.beginCompute = function (group) {
      const previous = currentLabel
      currentLabel = { context: group.id, name: group.name || `computeGroup_${group.id}` }
      try {
        return originalCompute.call(this, group)
      } finally {
        currentLabel = previous
      }
    }
    backend.initTimestampQuery = function (type, uid, descriptor) {
      labels.set(`${type}:${uid}`, {
        label: { ...currentLabel, descriptor: descriptor.label ?? null },
        segment,
      })
      return originalQuery.call(this, type, uid, descriptor)
    }
  }
  const collect = async () => {
    if (!supported || pending || stopped) return pending
    pending = (async () => {
      for (const type of ['render', 'compute']) {
        const pool = backend.timestampQueryPool?.[type]
        if (!pool || !pool.currentQueryIndex) continue
        await renderer.resolveTimestampsAsync(type)
        for (const [uid, durationMs] of pool.timestamps) {
          const recorded = labels.get(`${type}:${uid}`)
          if (recorded && Number.isFinite(durationMs) && durationMs >= 0)
            samples.push({ type, uid, durationMs, resolvedAtMs: performance.now(), ...recorded })
          // Completed diagnostic rows are not needed by this disposable page.
          // Do not touch pending offsets or native GPU query buffers.
          pool.timestamps.delete(uid)
          labels.delete(`${type}:${uid}`)
        }
      }
    })()
      .catch((cause) => errors.push(String(cause)))
      .finally(() => {
        pending = undefined
      })
    return pending
  }
  const timer = supported ? setInterval(collect, 100) : null
  window.__carGpuTiming = {
    supported,
    segment(value) {
      segment = value
    },
    async stop() {
      if (timer) clearInterval(timer)
      await pending
      await collect()
      stopped = true
      if (supported) {
        backend.beginRender = originalRender
        backend.beginCompute = originalCompute
        backend.initTimestampQuery = originalQuery
      }
      const result = {
        supported,
        samples,
        errors,
        restored:
          backend.beginRender === originalRender &&
          backend.beginCompute === originalCompute &&
          backend.initTimestampQuery === originalQuery,
        method:
          'Three r185 timestamp-query pools, async 100ms batches, render/compute context labels; not display frame duration or physical VRAM.',
      }
      delete window.__carGpuTiming
      return result
    },
  }
  return { supported, trackTimestamp: backend.trackTimestamp, method: 'native timestamp-query' }
}

export function installCompletedFrameTiming() {
  const lighting = window.__carLighting,
    renderer = window.__demo.scene.renderer.instance,
    original = renderer.render,
    completions = [],
    startedAtMs = performance.now()
  if (
    typeof original !== 'function' ||
    typeof renderer.getRenderTarget !== 'function' ||
    typeof lighting?.snapshot !== 'function'
  )
    throw new Error('Actual renderer and lighting frame snapshot are required')
  let previous = lighting.snapshot().frames,
    segment = 'unassigned',
    stopped = false
  if (!Number.isSafeInteger(previous) || previous < 0)
    throw new Error('Actual completed coordinator frame count is required')
  const wrapper = function (...args) {
    const canvas = this.getRenderTarget() === null,
      before = canvas ? lighting.snapshot().frames : null,
      drawSegment = segment
    // The exposed lighting facade has snapshot/setSignals only. Observe the
    // existing renderer instead; offscreen/auxiliary draws are not candidates.
    const result = original.apply(this, args)
    if (canvas)
      queueMicrotask(() => {
        if (stopped) return
        // draw() commits motion/history and increments frames synchronously after
        // the final canvas render returns, including after awaited DDGI work.
        // A failed render/commit or a repeated counter cannot complete a frame.
        const frame = lighting.snapshot().frames
        if (Number.isSafeInteger(frame) && frame > before && frame > previous) {
          completions.push({
            frame,
            atMs: performance.now(),
            segment: drawSegment,
            skippedCounterValues: frame - previous - 1,
          })
          previous = frame
        }
      })
    return result
  }
  renderer.render = wrapper
  window.__carFrameTiming = {
    segment(value) {
      segment = value
    },
    stop() {
      stopped = true
      if (renderer.render === wrapper) renderer.render = original
      const result = {
        startedAtMs,
        endedAtMs: performance.now(),
        completions,
        restored: renderer.render === original,
        method:
          'Existing renderer final-canvas render return followed by a microtask observing an increased lighting.snapshot().frames after coordinator motion/history commit. This is not a direct notify hook: timestamps are JS submission-completion observations, not GPU completion or display presentation. Offscreen draws, failed frames and unchanged counters are excluded.',
      }
      delete window.__carFrameTiming
      return result
    },
  }
}
