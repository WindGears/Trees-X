/* global window, structuredClone */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  cameraError,
  createResetGate,
  installSequenceObservation,
  sequenceCoverage,
} from './sequence-observation.mjs'

const expected = { position: [0, 0, 4], target: [0, 0, 0] }
const snapshot = (frame = 1) => ({
  frame,
  camera: {
    position: [0, 0, 4],
    direction: [0, 0, -1],
    quaternion: [0, 0, 0, 1],
    projection: [1, 0, 0, 1],
  },
  motion: {
    'open-doors': { progress: 0, target: 1, playing: false },
    'explore-parts': { progress: 0, target: 1, playing: false },
  },
})

describe('actual reset completion gate', () => {
  it('requires actual configured position and direction, not only elapsed time', () => {
    assert.equal(cameraError(snapshot().camera, expected), 0)
    assert.equal(cameraError({ position: [0, 0, 5], direction: [0, 0, -1] }, expected), 1)
    assert.equal(cameraError({ position: [0, 0, 4], direction: [1, 0, 0] }, expected), 1)
    assert.equal(cameraError({}, expected), Infinity)
    assert.equal(cameraError({ ...snapshot().camera, position: [NaN, 0, 4] }, expected), Infinity)
    assert.equal(cameraError(snapshot().camera, null), Infinity)
    assert.equal(
      cameraError(snapshot().camera, { position: [1, 1, 1], target: [1, 1, 1] }),
      Infinity,
    )
  })
  it('requires stable matching states and two actual completed frames after the first eligible state', () => {
    const gate = createResetGate(expected)
    assert.equal(gate(snapshot(10)).ready, false)
    assert.equal(gate(snapshot(10)).ready, false)
    assert.equal(gate(snapshot(11)).ready, false)
    const result = gate(snapshot(12))
    assert.equal(result.ready, true)
    assert.equal(result.firstFrame, 10)
    assert.ok(result.stable >= 2)
  })
  it('rejects active, missing and nonzero motion states and restarts after later movement', () => {
    for (const alter of [
      (value) => (value.motion['open-doors'].progress = 0.1),
      (value) => (value.motion['open-doors'].target = NaN),
      (value) => (value.motion['open-doors'].playing = true),
      (value) => delete value.motion['open-doors'],
      (value) => (value.camera.position[0] = 1),
      (value) => (value.frame = -1),
      (value) => (value.frame = 1.5),
      (value) => (value.motion['open-doors'].progress = NaN),
    ]) {
      const gate = createResetGate(expected)
      gate(snapshot(1))
      const invalid = snapshot(4)
      alter(invalid)
      assert.equal(gate(invalid).ready, false)
      assert.equal(gate(snapshot(5)).ready, false)
      assert.equal(gate(snapshot(7)).ready, true)
    }
  })
  it('accepts a resting reset whose next playback target remains open', () => {
    const gate = createResetGate(expected)
    assert.equal(gate(snapshot(1)).ready, false)
    assert.equal(gate(snapshot(3)).ready, true)
    const closedTarget = snapshot(4)
    closedTarget.motion['open-doors'].target = 0
    assert.equal(gate(closedTarget).ready, false)
    closedTarget.frame = 6
    assert.equal(gate(closedTarget).ready, true)
  })
  it('requires the projection and quaternion to settle as well as position and direction', () => {
    const gate = createResetGate(expected)
    gate(snapshot(1))
    const reframed = snapshot(4)
    reframed.camera.projection[0] = 2
    assert.equal(gate(reframed).ready, false)
    reframed.frame = 5
    assert.equal(gate(reframed).ready, false)
    reframed.frame = 6
    assert.equal(gate(reframed).ready, true)
    const rolled = structuredClone(reframed)
    rolled.camera.quaternion[2] = 0.1
    rolled.frame = 7
    assert.equal(gate(rolled).ready, false)
  })
})

describe('segment interaction coverage', () => {
  const observation = () => ({
    elapsedBrowserMs: 10000,
    foreground: true,
    deliveredInputs: 3,
    maxCameraDisplacement: 0.5,
    motionRanges: { 'open-doors': { min: 0, max: 1 }, 'explore-parts': { min: 0, max: 1 } },
  })
  it('distinguishes sampled complete actions and camera movement from mere configured duration', () => {
    for (const kind of ['orbit', 'doors', 'separation'])
      assert.equal(sequenceCoverage(kind, observation(), 3, 10000).covered, true)
    assert.equal(sequenceCoverage('orbit', observation(), 1, 10000).covered, false)
    assert.equal(
      sequenceCoverage('orbit', { ...observation(), maxCameraDisplacement: 0 }, 3, 10000).covered,
      false,
    )
    const partial = observation()
    partial.motionRanges['open-doors'].max = 0.6
    assert.equal(sequenceCoverage('doors', partial, 3, 10000).covered, false)
  })
  it('does not approve short or background segments', () => {
    assert.equal(
      sequenceCoverage('orbit', { ...observation(), elapsedBrowserMs: 5000 }, 3, 10000).covered,
      false,
    )
    assert.equal(
      sequenceCoverage('orbit', { ...observation(), foreground: false }, 3, 10000).covered,
      false,
    )
    assert.equal(sequenceCoverage('orbit', observation(), 4, 10000).covered, false)
  })
  it('records browser-clock marks, actual camera/motion and ranges without invoking a checkpoint', () => {
    const previousWindow = globalThis.window,
      previousDocument = globalThis.document,
      value = snapshot(1)
    const camera = {
      position: { toArray: () => [...value.camera.position], clone: () => ({}) },
      quaternion: { toArray: () => [...value.camera.quaternion] },
      projectionMatrix: { toArray: () => [...value.camera.projection] },
      getWorldDirection: () => ({ toArray: () => [...value.camera.direction] }),
    }
    globalThis.window = {
      __demo: {
        scene: { camera: { activeCamera: { value: camera } } },
        motion: { states: { value: value.motion } },
      },
      __carLighting: { snapshot: () => ({ frames: value.frame }) },
    }
    globalThis.document = { visibilityState: 'visible', hasFocus: () => true }
    try {
      installSequenceObservation()
      const observer = window.__carSequence
      observer.start('unit-segment')
      assert.throws(() => observer.start('overlap'), /still active/)
      value.motion['open-doors'].progress = 1
      value.motion['open-doors'].playing = true
      value.camera.position[0] = 2
      observer.sample({ kind: 'motion-poll', id: 'open-doors' })
      observer.sample({ kind: 'motion-intent', id: 'open-doors', target: 1 })
      observer.sample({ kind: 'pointer-move', x: 125, y: 240 })
      // The range must retain this intermediate value even when trajectory
      // throttling omits it from saved points and the final state is restored.
      value.motion['open-doors'].progress = 0
      value.camera.position[0] = 0
      globalThis.document.visibilityState = 'hidden'
      observer.sample()
      globalThis.document.visibilityState = 'visible'
      const result = observer.finish()
      assert.equal(result.motionRanges['open-doors'].max, 1)
      assert.equal(result.motionRanges['open-doors'].min, 0)
      assert.equal(result.maxCameraDisplacement, 2)
      assert.equal(result.foreground, false)
      assert.equal(result.deliveredInputs, 2)
      assert.deepEqual(result.inputObservations, {
        'motion-poll': 1,
        'motion-intent': 1,
        'pointer-move': 1,
      })
      assert.equal(result.inputs[0].kind, 'motion-intent')
      assert.equal(result.inputs[0].target, 1)
      assert.equal(result.inputs[1].x, 125)
      assert.equal(result.inputRecordsTruncated, false)
      assert.equal(result.startMark.name, 'unit-segment:start')
      assert.equal(result.endMark.name, 'unit-segment:end')
      assert.ok(result.endMark.startTime >= result.startMark.startTime)
      assert.equal(result.start.camera.position[0], 0)
      assert.equal(result.end.camera.position[0], 0)
      assert.match(result.method, /no checkpoint/)
      assert.throws(() => observer.finish(), /No measurement segment/)
      observer.start('bounded-inputs')
      for (let i = 0; i < 2050; i++) observer.sample({ kind: 'pointer-move', x: i, y: 0 })
      const bounded = observer.finish()
      assert.equal(bounded.deliveredInputs, 2050)
      assert.equal(bounded.inputs.length, 2048)
      assert.equal(bounded.inputRecordsTruncated, true)
    } finally {
      globalThis.window = previousWindow
      globalThis.document = previousDocument
    }
  })
})
