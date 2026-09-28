import { ref, shallowRef } from 'vue'
import type { Ref } from 'vue'
import { DEFAULT_THRESHOLDS, GestureDetector } from '@/lib/gesture/detector'
import type { Point, Position } from '@/lib/gesture/detector'
import type { GestureBridge } from '@/lib/gesture/bridge'
import { TargetCapture } from '@/lib/gesture/selection'
import { DwellCapture } from '@/lib/gesture/dwell'
import { PinchCalibration } from '@/lib/gesture/calibration'

export function useGestureInput(video: Ref<HTMLVideoElement | null>, bridge: GestureBridge) {
  const detector = new GestureDetector(),
    capture = new TargetCapture(),
    dwell = new DwellCapture(),
    calibration = new PinchCalibration()
  const tracked = ref(false),
    ratio = ref<number | null>(null),
    hz = ref(0)
  const landmarks = shallowRef<Point[]>([]),
    rawPointer = ref<Position | null>(null),
    filteredPointer = ref<Position | null>(null)
  const thresholds = ref({ ...DEFAULT_THRESHOLDS }),
    calibrated = ref(false)
  const calibrationState = ref({ stage: calibration.stage, message: '', progress: 0 })
  const times: number[] = []
  const syncCalibration = () => {
    calibrationState.value = {
      stage: calibration.stage,
      message: calibration.message,
      progress: calibration.progress,
    }
  }
  function reset(preserveSelectionBlock = false) {
    bridge.stopMotion()
    detector.reset()
    capture.reset()
    dwell.reset(preserveSelectionBlock)
    times.length = 0
    tracked.value = false
    landmarks.value = []
    rawPointer.value = filteredPointer.value = null
    ratio.value = null
    hz.value = 0
    bridge.pointer.value = null
    bridge.hovered.value = false
    bridge.phase.value = 'idle'
    bridge.pinchProgress.value = 0
    bridge.candidateId.value = null
    bridge.candidateLabel.value = ''
    if (['open', 'prepare-pinch', 'pinch'].includes(calibration.stage)) calibration.cancel()
    syncCalibration()
  }
  function startCalibration(stage: 'open' | 'pinch') {
    bridge.reset()
    bridge.owner.value = 'gesture'
    calibration.start(stage, performance.now())
    syncCalibration()
  }
  function cancelCalibration() {
    calibration.cancel()
    bridge.reset()
    syncCalibration()
  }
  function resetCalibration() {
    detector.thresholds = { ...DEFAULT_THRESHOLDS }
    thresholds.value = { ...DEFAULT_THRESHOLDS }
    calibrated.value = false
    cancelCalibration()
  }
  function process(points: Point[], time: number, aspect: number) {
    const result = detector.update(points, time, bridge.mode.value, aspect)
    tracked.value = result.tracked
    landmarks.value = result.tracked ? points : []
    ratio.value = result.ratio
    rawPointer.value = result.rawPointer
    filteredPointer.value = result.pointer
    times.push(time)
    while (times.length > 20 || (times.length > 1 && time - times[0]! > 1500)) times.shift()
    hz.value =
      times.length > 1 ? Math.round(((times.length - 1) * 1000) / Math.max(1, time - times[0]!)) : 0
    if (['open', 'prepare-pinch', 'pinch'].includes(calibration.stage)) {
      const next = calibration.update(result.ratio, time)
      if (next) {
        detector.thresholds = next
        thresholds.value = { ...next }
        calibrated.value = true
        detector.reset()
        capture.reset()
        dwell.reset()
      }
      bridge.pointer.value = null
      bridge.hovered.value = false
      bridge.phase.value = 'idle'
      syncCalibration()
      return
    }
    if (bridge.mode.value === 'rotate') {
      bridge.submitRotation(result.rotation, performance.now())
      bridge.pointer.value = null
      return
    }
    const host =
      video.value?.closest('.product-studio')?.querySelector('.canvas-host') ??
      video.value?.closest('.viewer-shell')?.querySelector('.canvas-host')
    const size = host?.getBoundingClientRect() ?? { width: 0, height: 0 }
    const isDwell = bridge.confirmation.value === 'dwell'
    const target = bridge.targets.size
      ? bridge.targets.pick(
          result.pointer,
          size,
          isDwell ? dwell.targetId : capture.targetId,
          !isDwell && capture.locked,
        )
      : { ...bridge.hotspot.value, id: 'current', label: '部件', activate: () => bridge.showPart() }
    const resolved = target ?? { x: 0, y: 0, visible: false, id: 'none' }
    const selection = isDwell
      ? dwell.update(result, time, resolved, size)
      : capture.update(result, time, resolved, size)
    bridge.pointer.value = selection.pointer
    bridge.hovered.value = selection.hovered
    bridge.phase.value = selection.phase
    bridge.pinchProgress.value = selection.progress
    bridge.candidateId.value = selection.hovered ? (target?.id ?? null) : null
    bridge.candidateLabel.value = selection.hovered ? (target?.label ?? '') : ''
    if (selection.confirm) target?.activate()
  }
  return {
    reset,
    process,
    tracked,
    ratio,
    hz,
    landmarks,
    rawPointer,
    filteredPointer,
    thresholds,
    calibrated,
    calibrationState,
    startCalibration,
    cancelCalibration,
    resetCalibration,
  }
}
