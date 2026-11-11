const settleFrames = 32
const settleMs = 850

/** R18 lets the screen-space histories settle before the Tres host becomes idle. */
export function createCarFrameSchedule() {
  let idle = false,
    remaining = 0,
    changed = 0

  function touch() {
    if (!idle) return
    remaining = settleFrames
    changed = performance.now()
  }

  return {
    configure(enabled = false) {
      idle = enabled
      touch()
    },
    touch,
    unsettled: () => !idle || remaining > 0 || performance.now() - changed < settleMs,
    submitted() {
      if (remaining > 0) remaining--
    },
  }
}
