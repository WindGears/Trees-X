import { onScopeDispose, ref, watch } from 'vue'
import type { Ref } from 'vue'

export interface FrameReport {
  median: number
  p95: number
  samples: number
  tier: number
}

export function summarizeFrameTimes(
  values: Float32Array,
  length: number,
  tier: number,
): FrameReport {
  const ordered = Array.from(values.subarray(0, length)).sort((a, b) => a - b)
  const percentile = (fraction: number) =>
    ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * fraction))] ?? 0
  return {
    median: percentile(0.5),
    p95: percentile(0.95),
    samples: ordered.length,
    tier,
  }
}

export function useVisualPerformance(active: Ref<boolean>) {
  const tier = ref(0)
  const report = ref<FrameReport | null>(null)
  const samples = new Float32Array(1200)
  let sampleCount = 0
  let startedAt = 0
  let previous = 0
  let frame = 0
  let completed = false

  function stop() {
    cancelAnimationFrame(frame)
    frame = 0
    sampleCount = 0
    startedAt = 0
    previous = 0
  }
  function measure(time: number) {
    if (!active.value || completed) return stop()
    if (!startedAt) startedAt = time
    if (previous && sampleCount < samples.length) {
      const delta = time - previous
      if (delta > 0) samples[sampleCount++] = delta
    }
    previous = time
    if (time - startedAt >= 10_000 && sampleCount > 30) {
      report.value = summarizeFrameTimes(samples, sampleCount, tier.value)
      completed = true
    }
    if (!completed) frame = requestAnimationFrame(measure)
  }
  watch(
    active,
    (enabled) => {
      stop()
      if (enabled && !completed) frame = requestAnimationFrame(measure)
    },
    { immediate: true },
  )
  onScopeDispose(stop)
  return { tier, report }
}
