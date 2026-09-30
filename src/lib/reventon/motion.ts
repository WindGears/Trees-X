import { Object3D, PerspectiveCamera, Quaternion } from 'three'

export interface CameraSample {
  position: number[]
  quaternion: number[]
  horizontalFov: number
}
export interface ReventonMotion {
  fps: number
  frames: number
  duration: number
  tracks: { id: string; frames: number[][] }[]
  cameras: CameraSample[]
  chapters: { id: string; label: string; time: number }[]
}

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null
const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)
const vector = (value: unknown, length: number): value is number[] =>
  Array.isArray(value) && value.length === length && value.every(finite)

export function parseMotion(value: unknown): ReventonMotion {
  if (
    !record(value) ||
    value.fps !== 24 ||
    value.frames !== 384 ||
    !finite(value.duration) ||
    Math.abs(value.duration - 383 / 24) > 0.001 ||
    !Array.isArray(value.tracks) ||
    value.tracks.length !== 7 ||
    !value.tracks.every(
      (track: unknown) =>
        record(track) &&
        typeof track.id === 'string' &&
        Array.isArray(track.frames) &&
        track.frames.length === 384 &&
        track.frames.every((pose: unknown) => vector(pose, 10)),
    ) ||
    !Array.isArray(value.cameras) ||
    value.cameras.length !== 384 ||
    !value.cameras.every(
      (camera: unknown) =>
        record(camera) &&
        vector(camera.position, 3) &&
        vector(camera.quaternion, 4) &&
        finite(camera.horizontalFov) &&
        camera.horizontalFov > 0 &&
        camera.horizontalFov < 170,
    ) ||
    !Array.isArray(value.chapters) ||
    value.chapters.length !== 4 ||
    !value.chapters.every(
      (chapter: unknown) =>
        record(chapter) &&
        typeof chapter.id === 'string' &&
        typeof chapter.label === 'string' &&
        finite(chapter.time) &&
        chapter.time >= 0 &&
        chapter.time < 16,
    )
  )
    throw new Error('演示动作数据不完整，请重新加载。')
  const data = value as unknown as ReventonMotion
  if (new Set(data.tracks.map((track) => track.id)).size !== 7)
    throw new Error('运动部件标识重复。')
  return data
}

/** Sample authored Blender transforms directly onto actual Three Object3D instances. */
export function createMotionSampler(
  root: Object3D,
  camera: PerspectiveCamera,
  data: ReventonMotion,
) {
  const objects = new Map<string, Object3D>()
  root.traverse((object) => {
    const id: unknown = object.userData.reventon_motion_id
    if (typeof id === 'string') objects.set(id, object)
  })
  const tracks = data.tracks.map((track) => {
    const object = objects.get(track.id)
    if (!object) throw new Error(`模型缺少运动部件：${track.id}`)
    return { object, frames: track.frames }
  })
  const nextRotation = new Quaternion()
  const cameraRotation = new Quaternion()
  const mix = (a: number, b: number, t: number) => a + (b - a) * t
  return (seconds: number) => {
    const frame = Math.max(0, Math.min(data.frames - 1, seconds * data.fps))
    const index = Math.floor(frame)
    const next = Math.min(index + 1, data.frames - 1)
    const t = frame - index
    for (const { object, frames } of tracks) {
      const a = frames[index]!
      const b = frames[next]!
      object.position.set(mix(a[0]!, b[0]!, t), mix(a[1]!, b[1]!, t), mix(a[2]!, b[2]!, t))
      object.quaternion.fromArray(a, 3).slerp(nextRotation.fromArray(b, 3), t)
      object.scale.set(mix(a[7]!, b[7]!, t), mix(a[8]!, b[8]!, t), mix(a[9]!, b[9]!, t))
    }
    // Chapter cuts are intentional; never interpolate through the car between cameras.
    const a = data.cameras[index]!
    const b = data.cameras[index === 95 || index === 191 ? index : next]!
    camera.position.set(
      mix(a.position[0]!, b.position[0]!, t),
      mix(a.position[1]!, b.position[1]!, t),
      mix(a.position[2]!, b.position[2]!, t),
    )
    camera.quaternion.fromArray(a.quaternion).slerp(cameraRotation.fromArray(b.quaternion), t)
    const horizontal = (mix(a.horizontalFov, b.horizontalFov, t) * Math.PI) / 180
    camera.fov = (2 * Math.atan(Math.tan(horizontal / 2) / camera.aspect) * 180) / Math.PI
    camera.updateProjectionMatrix()
    root.updateMatrixWorld(true)
    camera.updateMatrixWorld(true)
  }
}
