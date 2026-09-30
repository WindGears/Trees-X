import { describe, expect, it } from 'vitest'
import { Group, PerspectiveCamera, Vector3 } from 'three'
import { createMotionSampler, parseMotion } from './motion'
import type { ReventonMotion } from './motion'

function fixture() {
  const root = new Group()
  const data: ReventonMotion = {
    fps: 24,
    frames: 384,
    duration: 383 / 24,
    tracks: Array.from({ length: 7 }, (_, i) => {
      const part = new Group()
      part.userData.reventon_motion_id = String(i)
      const child = new Group()
      child.position.set(2, 0, 0)
      part.add(child)
      root.add(part)
      return {
        id: String(i),
        frames: Array.from({ length: 384 }, (_, frame) => [
          frame < 192 ? frame / 191 : (383 - frame) / 191,
          0,
          0,
          0,
          0,
          0,
          1,
          1,
          1,
          1,
        ]),
      }
    }),
    cameras: Array.from({ length: 384 }, (_, frame) => ({
      position: [frame < 96 ? 5 : 0, 3, 7],
      quaternion: [0, 0, 0, 1],
      horizontalFov: 60,
    })),
    chapters: [0, 4, 8, 12.5].map((time, i) => ({ id: String(i), label: String(i), time })),
  }
  return { root, data, camera: new PerspectiveCamera(40, 2) }
}

describe('Reventon real Object3D motion', () => {
  it('moves the actual hierarchy and returns to the exact assembled pose after scrubbing', () => {
    const { root, camera, data } = fixture()
    const sample = createMotionSampler(root, camera, parseMotion(data))
    const child = root.children[0]!.children[0]!
    const position = new Vector3()
    sample(0)
    expect(child.getWorldPosition(position).x).toBe(2)
    sample(191 / 24)
    expect(child.getWorldPosition(position).x).toBe(3)
    sample(data.duration)
    expect(child.getWorldPosition(position).x).toBe(2)
    sample(-20)
    expect(child.getWorldPosition(position).x).toBe(2)
  })
  it('cuts between authored cameras without flying through the body, and preserves horizontal framing', () => {
    const { root, camera, data } = fixture()
    const sample = createMotionSampler(root, camera, data)
    sample(95.9 / 24)
    expect(camera.position.x).toBe(5)
    sample(4)
    expect(camera.position.x).toBe(0)
    const desktopFov = camera.fov
    camera.aspect = 0.5
    sample(4)
    expect(camera.fov).toBeGreaterThan(desktopFov)
  })
  it('rejects corrupt data and mismatched motion groups before enabling the demo', () => {
    const { root, camera, data } = fixture()
    data.tracks[0]!.frames[20]![0] = Number.NaN
    expect(() => parseMotion(data)).toThrow('动作数据不完整')
    const other = fixture()
    root.remove(root.children[0]!)
    expect(() => createMotionSampler(root, camera, other.data)).toThrow('缺少运动部件')
  })
})
