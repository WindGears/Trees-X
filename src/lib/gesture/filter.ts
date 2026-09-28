// Speed-adaptive low-pass filter (1€ algorithm). Times: ms; values: normalized.
export class OneEuroFilter {
  private time: number | null = null
  private raw = 0
  private value = 0
  private speed = 0
  constructor(
    private minCutoff = 1.4,
    private beta = 5,
  ) {}
  reset() {
    this.time = null
  }
  update(value: number, time: number) {
    if (this.time === null || time <= this.time || time - this.time > 250) {
      this.time = time
      this.raw = this.value = value
      this.speed = 0
      return value
    }
    const dt = (time - this.time) / 1000
    const alpha = (cutoff: number) => 1 / (1 + 1 / (2 * Math.PI * cutoff * dt))
    this.speed += alpha(1) * ((value - this.raw) / dt - this.speed)
    this.value += alpha(this.minCutoff + this.beta * Math.abs(this.speed)) * (value - this.value)
    this.raw = value
    this.time = time
    return this.value
  }
}
