import type { PinchThresholds } from './detector'
export type CalibrationStage = 'idle' | 'open' | 'prepare-pinch' | 'pinch' | 'done' | 'error'
const quantile = (values: number[], fraction: number) => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor((sorted.length - 1) * fraction)]!
}
export class PinchCalibration {
  stage: CalibrationStage = 'idle'
  message = ''
  progress = 0
  private samples: number[] = []
  private first = 0
  private last: number | null = null
  private opened = 0
  private deadline = 0
  start(stage: 'open' | 'pinch', time: number) {
    this.stage = stage
    this.progress = 0
    this.samples = []
    this.last = null
    this.deadline = time + 12000
    this.message =
      stage === 'open'
        ? '张开拇指和食指，手掌朝向镜头，保持片刻。'
        : '拇指和食指轻轻捏合，保持片刻。'
  }
  cancel() {
    this.stage = 'idle'
    this.progress = 0
    this.samples = []
    this.last = null
  }
  update(ratio: number | null, time: number): PinchThresholds | null {
    if (this.stage !== 'open' && this.stage !== 'pinch') return null
    if (time > this.deadline) {
      this.stage = 'error'
      this.message = '未采到稳定姿势，请让手完整入镜后重试。'
      return null
    }
    if (
      ratio === null ||
      !Number.isFinite(ratio) ||
      (this.last !== null && time - this.last > 250)
    ) {
      this.samples = []
      this.last = null
      this.progress = 0
      if (ratio === null || !Number.isFinite(ratio)) return null
    }
    if (this.samples.length === 0) this.first = time
    this.last = time
    this.samples.push(ratio)
    this.progress = Math.min(1, Math.min(this.samples.length / 10, (time - this.first) / 1200))
    if (this.progress < 1) return null
    const low = quantile(this.samples, 0.1),
      high = quantile(this.samples, 0.9)
    if (high - low > 0.16) {
      this.stage = 'error'
      this.message = '这次手势变化较大，请保持同一姿势再试。'
      return null
    }
    if (this.stage === 'open') {
      if (low < 0.5) {
        this.stage = 'error'
        this.message = '两指张开幅度不足，请再张开一些。'
        return null
      }
      this.opened = low
      this.stage = 'prepare-pinch'
      this.message = '张开姿势已记录。准备好后，开始采集捏合姿势。'
      return null
    }
    if (high > 0.45 || this.opened - high < 0.25) {
      this.stage = 'error'
      this.message = '两种姿势区分不足，请确认两指轻触，再重新校准。'
      return null
    }
    const gap = this.opened - high
    const close = Math.min(0.48, Math.max(0.12, high + gap * 0.25))
    const open = Math.min(0.85, Math.max(close + 0.12, high + gap * 0.55))
    this.stage = 'done'
    this.message = '校准完成。先张开两指，再瞄准热点试一次捏合。'
    return { close, open }
  }
}
