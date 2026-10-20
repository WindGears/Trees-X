/* global window, document, performance */

/** Installed only in the disposable benchmark page. Reads actual state on
 * existing input/poll boundaries; adds no animation loop or camera checkpoint.
 */
export function installSequenceObservation() {
  let current = null
  const read = () => {
    const camera = window.__demo.scene.camera.activeCamera.value
    return {
      atMs: performance.now(),
      frame: window.__carLighting.snapshot().frames,
      camera: {
        position: camera.position.toArray(),
        direction: camera.getWorldDirection(camera.position.clone()).toArray(),
        quaternion: camera.quaternion.toArray(),
        projection: camera.projectionMatrix.toArray(),
      },
      motion: Object.fromEntries(
        Object.entries(window.__demo.motion.states.value).map(([id, value]) => [id, { ...value }]),
      ),
      visibilityState: document.visibilityState,
      focused: document.hasFocus(),
    }
  }
  const sample = (input = null, force = false) => {
    const value = read()
    if (!current) return value
    current.observations++
    if (input) {
      current.inputObservations[input.kind] = (current.inputObservations[input.kind] ?? 0) + 1
      // Polls observe state but are not delivered user/command inputs. Preserve
      // every actual input until the explicit report bound; trajectory sampling
      // below must not discard a motion intent that follows a poll immediately.
      if (input.kind !== 'motion-poll') {
        current.deliveredInputs++
        if (current.inputs.length < 2048)
          current.inputs.push({ atMs: value.atMs, frame: value.frame, ...input })
        else current.inputRecordsTruncated = true
      }
    }
    if (value.visibilityState !== 'visible' || !value.focused) current.foreground = false
    for (const [id, motion] of Object.entries(value.motion)) {
      const range = (current.motionRanges[id] ??= {
        min: motion.progress,
        max: motion.progress,
        playingObservations: 0,
      })
      range.min = Math.min(range.min, motion.progress)
      range.max = Math.max(range.max, motion.progress)
      if (motion.playing) range.playingObservations++
    }
    const delta = Math.hypot(
      ...value.camera.position.map(
        (number, index) => number - current.start.camera.position[index],
      ),
    )
    current.maxCameraDisplacement = Math.max(current.maxCameraDisplacement, delta)
    // Bound the report even for an accidentally long benchmark. Ranges include
    // every observation; saved trajectory points are limited to ten per second.
    if (
      current.samples.length < 2048 &&
      (force || value.atMs - (current.samples.at(-1)?.atMs ?? -Infinity) >= 100)
    )
      current.samples.push({ ...value, input })
    return value
  }
  window.__carSequence = {
    read,
    sample,
    start(segment) {
      if (current) throw new Error('Previous measurement segment is still active')
      const mark = performance.mark(`${segment}:start`)
      const start = read()
      current = {
        segment,
        timeOriginMs: performance.timeOrigin,
        startMark: { name: mark.name, startTime: mark.startTime },
        start,
        samples: [],
        inputs: [],
        deliveredInputs: 0,
        inputRecordsTruncated: false,
        inputObservations: {},
        motionRanges: {},
        observations: 0,
        maxCameraDisplacement: 0,
        foreground: true,
      }
      sample(null, true)
      return start
    },
    finish() {
      if (!current) throw new Error('No measurement segment is active')
      const end = sample(null, true)
      const mark = performance.mark(`${current.segment}:end`)
      const result = {
        ...current,
        end,
        endMark: { name: mark.name, startTime: mark.startTime },
        elapsedBrowserMs: mark.startTime - current.startMark.startTime,
        method:
          'Read-only actual camera/motion observations at existing input and poll boundaries; no checkpoint, RAF, GPU readback or additional drawing clock. Camera direction is observed directly; OrbitControls target is not exposed or inferred.',
      }
      current = null
      return result
    },
  }
}

function arrayError(actual, expected) {
  if (
    !Array.isArray(actual) ||
    !Array.isArray(expected) ||
    actual.length !== expected.length ||
    !actual.every(Number.isFinite) ||
    !expected.every(Number.isFinite)
  )
    return Infinity
  return Math.max(...actual.map((value, index) => Math.abs(value - expected[index])))
}

export function cameraError(actual, expected) {
  if (
    !Array.isArray(expected?.position) ||
    !Array.isArray(expected?.target) ||
    expected.position.length !== 3 ||
    expected.target.length !== 3
  )
    return Infinity
  const direction = expected.target.map((value, index) => value - expected.position[index])
  const length = Math.hypot(...direction)
  if (!Number.isFinite(length) || length === 0) return Infinity
  return Math.max(
    arrayError(actual?.position, expected.position),
    arrayError(
      actual?.direction,
      direction.map((value) => value / length),
    ),
  )
}

/** Two matching eligible samples and at least two completed coordinator frames
 * after the first eligible sample. An ineligible sample restarts the gate.
 */
export function createResetGate(expected, ids = ['open-doors', 'explore-parts']) {
  let previous = null,
    firstFrame = null,
    stable = 0
  return (sample) => {
    const complete =
      Number.isSafeInteger(sample?.frame) &&
      sample.frame >= 0 &&
      cameraError(sample.camera, expected) <= 1e-6 &&
      ids.every((id) => {
        const motion = sample.motion[id]
        return (
          motion &&
          !motion.playing &&
          Math.abs(motion.progress) <= 1e-7 &&
          Number.isFinite(motion.target) &&
          motion.target >= 0 &&
          motion.target <= 1
        )
      })
    if (!complete) {
      previous = null
      firstFrame = null
      stable = 0
      return { ready: false, stable, firstFrame }
    }
    const signature = JSON.stringify({ camera: sample.camera, motion: sample.motion })
    stable = previous === signature ? stable + 1 : 1
    if (previous !== signature) firstFrame = sample.frame
    previous = signature
    return { ready: stable >= 2 && sample.frame >= firstFrame + 2, stable, firstFrame }
  }
}

export function sequenceCoverage(kind, observation, inputs, requestedMs) {
  const range = observation.motionRanges[kind === 'doors' ? 'open-doors' : 'explore-parts']
  const motionCovered =
    kind === 'orbit' || Boolean(range && range.min <= 1e-4 && range.max >= 0.9999)
  const cameraMoved = kind !== 'orbit' || observation.maxCameraDisplacement > 1e-4
  const inputRecordsConsistent = observation.deliveredInputs === inputs
  return {
    requestedMs,
    durationCovered: observation.elapsedBrowserMs >= requestedMs * 0.95,
    foreground: observation.foreground,
    inputsObserved: inputs,
    inputRecordsConsistent,
    motionCovered,
    cameraMoved,
    covered:
      observation.elapsedBrowserMs >= requestedMs * 0.95 &&
      observation.foreground &&
      inputs >= (kind === 'orbit' ? 2 : 1) &&
      inputRecordsConsistent &&
      motionCovered &&
      cameraMoved,
    meaning:
      'Sampled interaction coverage only, not display/GPU performance. Input rate follows CDP responsiveness; captured trajectories must be compared before treating runs as matched movement.',
  }
}
