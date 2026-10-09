import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { gsap } from 'gsap'
import { Group, Quaternion, Vector3 } from 'three'
import { parseProduct } from './api'
import { createSampleAdapter } from './adapter'
import { progressActions } from './motionConfig'
import { bindMotionPose } from './motionPose'
import { createMotionPlayback } from './motionPlayback'
import type { MotionStatus, WorkbenchProduct } from './types'

const samples: WorkbenchProduct[] = JSON.parse(
  readFileSync('server/src/main/resources/samples/progress-products.json', 'utf8'),
).map(parseProduct)
const results: {
  slug: string
  samples: number
  cycles: number
  positionError: number
  rotationError: number
}[] = []
function snapshot(adapter: ReturnType<typeof createSampleAdapter>) {
  return [...adapter.nodes].map(([id, n]) => ({
    id,
    position: n.position.clone(),
    quaternion: n.quaternion.clone(),
  }))
}
function errors(
  adapter: ReturnType<typeof createSampleAdapter>,
  reference: ReturnType<typeof snapshot>,
) {
  return {
    position: Math.max(
      ...reference.map((b) => adapter.nodes.get(b.id)!.position.distanceTo(b.position)),
    ),
    rotation: Math.max(
      ...reference.map((b) => 1 - Math.abs(adapter.nodes.get(b.id)!.quaternion.dot(b.quaternion))),
    ),
  }
}
describe('v3 reversible motion', () => {
  it('throttles playback feedback to 15 Hz while manual seek reports immediately', () => {
    const adapter = createSampleAdapter(samples[1]!),
      feedback = vi.fn(),
      id = 'open-doors'
    let clock = 0
    const now = vi.spyOn(performance, 'now').mockImplementation(() => clock)
    const playback = createMotionPlayback(
      adapter,
      progressActions(samples[1]!.presentation),
      vi.fn(),
      feedback,
      () => false,
    )
    try {
      playback.command({ revision: 1, operation: 'play', id, value: 1 })
      const tween = gsap.globalTimeline
        .getChildren()
        .filter((t): t is gsap.core.Tween => 'targets' in t)
        .find((t) =>
          t
            .targets()
            .some(
              (o) => typeof o === 'object' && o !== null && 'playing' in o && o.playing === true,
            ),
        )!
      feedback.mockClear()
      for (let i = 1; i <= 120; i++) {
        clock = (i * 1000) / 120
        tween.totalTime(i / 120)
      }
      expect(feedback.mock.calls.length).toBeLessThanOrEqual(15)
      expect(feedback.mock.calls.length).toBeGreaterThan(10)
      playback.command({ revision: 2, operation: 'seek', id, value: 0.437 })
      expect(feedback.mock.calls.at(-1)![1]).toMatchObject({ progress: 0.437, playing: false })
    } finally {
      playback.dispose()
      adapter.dispose()
      now.mockRestore()
    }
  })
  it.each(samples)(
    '$slug has deterministic forward/reverse sampling and 50 cycles without drift',
    (product) => {
      const adapter = createSampleAdapter(product),
        id = progressActions(product.presentation)[0]!.id
      const initial = snapshot(adapter),
        forward = []
      for (let i = 0; i <= 100; i++) {
        adapter.pose[id] = i / 100
        adapter.apply()
        forward.push(snapshot(adapter))
      }
      let positionError = 0,
        rotationError = 0
      for (let i = 100; i >= 0; i--) {
        adapter.pose[id] = i / 100
        adapter.apply()
        const error = errors(adapter, forward[i]!)
        positionError = Math.max(positionError, error.position)
        rotationError = Math.max(rotationError, error.rotation)
      }
      for (let i = 0; i < 50; i++) {
        adapter.pose[id] = 1
        adapter.apply()
        adapter.pose[id] = 0
        adapter.apply()
        expect(errors(adapter, initial).position).toBeLessThan(1e-12)
        expect(errors(adapter, initial).rotation).toBeLessThan(1e-12)
      }
      expect(positionError).toBeLessThan(1e-12)
      expect(rotationError).toBeLessThan(1e-12)
      results.push({ slug: product.slug, samples: 101, cycles: 50, positionError, rotationError })
      mkdirSync('artifacts/progress', { recursive: true })
      writeFileSync('artifacts/progress/determinism.json', JSON.stringify(results, null, 2) + '\n')
      adapter.dispose()
    },
  )
  it('composes speaker parent/child translations with knob rotation and follows local anchors', () => {
    const adapter = createSampleAdapter(samples[0]!),
      hot = samples[0]!.presentation.hotspots.find((h) => h.node === 'driver')!
    const original = adapter.point(hot.node, new Vector3(), hot.anchor)!.clone()
    adapter.pose['explore-layers'] = 0.7
    adapter.pose['turn-knob'] = 1
    adapter.apply()
    expect(adapter.nodes.get('knob')!.rotation.y).not.toBe(0)
    const world = adapter.point(hot.node, new Vector3(), hot.anchor)!
    expect(world.z - original.z).toBeCloseTo(0.65 + (0.15 * (0.7 - 0.25)) / 0.55, 12)
    const q = adapter.nodes.get('knob')!.quaternion.clone()
    adapter.pose['explore-layers'] = 0.2
    adapter.apply()
    expect(adapter.nodes.get('knob')!.quaternion.equals(q)).toBe(true)
    adapter.dispose()
  })
  it('combines car separation translation and door rotation without overwriting either', () => {
    const adapter = createSampleAdapter(samples[1]!),
      door = adapter.nodes.get('door-left')!,
      base = door.position.clone()
    adapter.pose['open-doors'] = 0.5
    adapter.pose.explosion = 0.75
    adapter.apply()
    expect(door.rotation.x).toBeCloseTo(-1.15 * 0.5, 12)
    expect(door.position.x).toBeCloseTo(base.x - 0.55 * 0.75, 12)
    adapter.pose['open-doors'] = 0
    adapter.apply()
    expect(door.position.x).toBeCloseTo(base.x - 0.55 * 0.75, 12)
    adapter.dispose()
  })
  it('interpolates relative to a nonidentity parent/local quaternion without accumulating', () => {
    const p = structuredClone(samples[1]!),
      parent = new Group(),
      node = new Group()
    parent.rotation.set(0.3, 0.7, -0.2)
    parent.scale.setScalar(2)
    parent.add(node)
    node.rotation.set(0.4, -0.3, 0.2)
    const base = node.quaternion.clone(),
      motion = progressActions(p.presentation)[0]!
    motion.motion.tracks = [
      { node: 'part', type: 'rotate', axis: [0, 1, 0], angle: Math.PI, range: [0.2, 0.8] },
    ]
    const apply = bindMotionPose(p.presentation, new Map([['part', node]]))
    apply({ [motion.id]: 0.5 })
    const expected = base
      .clone()
      .multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2))
    expect(1 - Math.abs(node.quaternion.dot(expected))).toBeLessThan(1e-12)
    apply({ [motion.id]: 0 })
    expect(node.quaternion.equals(base)).toBe(true)
  })
  it('rejects invalid axes, ranges, long rotations, duplicate channels and old-schema motion', () => {
    for (const mutate of [
      (p: WorkbenchProduct) => {
        progressActions(p.presentation)[0]!.motion.tracks![0]!.range = [0.8, 0.2]
      },
      (p: WorkbenchProduct) => {
        const m = progressActions(p.presentation)[0]!.motion
        m.tracks!.push(m.tracks![0]!)
      },
      (p: WorkbenchProduct) => {
        p.presentation.version = 2
      },
      (p: WorkbenchProduct) => {
        p.presentation.guide[0]!.progress = { actionId: 'missing', value: 0.5 }
      },
    ]) {
      const p = structuredClone(samples[1]!)
      mutate(p)
      expect(() => parseProduct(p)).toThrow()
    }
    const p = structuredClone(samples[1]!),
      t = progressActions(p.presentation)[0]!.motion.tracks![0]!
    if (t.type !== 'rotate') throw new Error('fixture')
    t.angle = Math.PI + 0.01
    expect(() => parseProduct(p)).toThrow('180')
    t.angle = 1
    t.axis = [0, 2, 0]
    expect(() => parseProduct(p)).toThrow('单位轴')
    const speaker = structuredClone(samples[0]!)
    progressActions(speaker.presentation)[0]!.motion.tracks!.push({
      node: 'knob',
      range: [0, 1],
      type: 'rotate',
      axis: [0, 1, 0],
      angle: 1,
    })
    expect(() => parseProduct(speaker)).toThrow('重复控制')
  })
  it('plays proportional distances, seeks immediately, pauses, restores and honors reduced motion', () => {
    const product = samples[1]!,
      adapter = createSampleAdapter(product),
      feedback = vi.fn()
    const id = 'open-doors',
      playback = createMotionPlayback(
        adapter,
        progressActions(product.presentation),
        vi.fn(),
        feedback,
        () => false,
      )
    playback.command({ revision: 1, operation: 'seek', id, value: 0.25 })
    playback.command({ revision: 2, operation: 'play', id, value: 1 })
    const current = gsap.globalTimeline
      .getChildren()
      .filter((t): t is gsap.core.Tween => 'targets' in t)
      .find((t) =>
        t
          .targets()
          .some((o) => typeof o === 'object' && o !== null && 'playing' in o && o.playing === true),
      )!
    expect(current.duration()).toBeCloseTo(1.5)
    current.totalTime(0.5)
    const state = feedback.mock.calls.at(-1)![1] as MotionStatus
    playback.pauseAll()
    expect(adapter.pose[id]).toBeCloseTo(0.5)
    expect((feedback.mock.calls.at(-1)![1] as MotionStatus).playing).toBe(false)
    playback.command({ revision: 3, operation: 'play', id, value: 0 })
    playback.command({ revision: 4, operation: 'seek', id, value: 0.437 })
    expect(adapter.pose[id]).toBe(0.437)
    expect(state.progress).toBeGreaterThanOrEqual(0.25)
    playback.dispose()
    const count = feedback.mock.calls.length
    playback.command({ revision: 5, operation: 'reset', id })
    expect(feedback).toHaveBeenCalledTimes(count)
    const restored = createMotionPlayback(
      adapter,
      progressActions(product.presentation),
      vi.fn(),
      feedback,
      () => true,
      { [id]: { progress: 0.437, target: 0, playing: true } },
    )
    expect((feedback.mock.calls.at(-1)![1] as MotionStatus).playing).toBe(false)
    restored.command({ revision: 6, operation: 'resume', id })
    expect(adapter.pose[id]).toBe(0)
    restored.command({ revision: 7, operation: 'seek', id, value: 0.315 })
    expect(adapter.pose[id]).toBe(0.315)
    restored.reset()
    expect(adapter.pose[id]).toBe(0)
    restored.dispose()
    adapter.dispose()
  })
})
