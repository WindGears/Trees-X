import type { Object3D } from 'three'

export interface RealtimeProductProfile {
  readonly adapterId: 'typewriter-v1' | 'reventon-v1'
  readonly allowLoungeMood: boolean
  readonly allowLoungeDof: boolean
  readonly ddgiVolume: 'typewriter-lounge' | 'reventon-stage'
  readonly groundY: number
  readonly ddgiMargin: number
}

export const typewriterRealtimeProfile: RealtimeProductProfile = Object.freeze({
  adapterId: 'typewriter-v1',
  allowLoungeMood: true,
  allowLoungeDof: true,
  ddgiVolume: 'typewriter-lounge',
  groundY: -0.0192,
  ddgiMargin: 0.4,
})

export const reventonRealtimeProfile: RealtimeProductProfile = Object.freeze({
  adapterId: 'reventon-v1',
  allowLoungeMood: false,
  allowLoungeDof: false,
  ddgiVolume: 'reventon-stage',
  groundY: -0.01,
  ddgiMargin: 0.25,
})

/** Conservative POSITION-accessor boxes, transformed by the original v3 rig at
 * 101 door positions x 101 separation positions. Rounded outwards to 0.001
 * source units; this is a coverage envelope, not a physical vehicle dimension.
 * productProfile.test.ts replays the actual configuration with bindMotionPose.
 * The car uses its own ground support and never imports the lounge table.
 */
export const reventonMotionEnvelope = {
  min: [-1.685, -0.001, -2.734],
  max: [1.685, 2.086, 1.966],
  rest: { min: [-1.115, -0.001, -2.734], max: [1.115, 1.109, 1.966] },
  motionGroups: [
    'Motion__Door_1',
    'Motion__Door_-1',
    'Motion__Wheel_1_1',
    'Motion__Wheel_-1_1',
    'Motion__Wheel_1_-1',
    'Motion__Wheel_-1_-1',
    'Motion__Rear_cover_assembly',
  ],
  samplesPerAction: 101,
  source: {
    model: 'public/models/reventon/reventon.glb',
    sha256: '656630b71c3579bfe5a07dc9b2f6a31ecf945746273a1a9a509bfbd93df229b6',
    configuration: 'server/src/main/resources/presentations/reventon-workbench-v1.json',
    actions: ['open-doors', 'explore-parts'],
  },
} as const

/** Registered adapters are the capability boundary; names and slugs are content. */
export function realtimeProductProfile(adapterId: unknown): RealtimeProductProfile | undefined {
  if (adapterId === 'typewriter-v1') return typewriterRealtimeProfile
  if (adapterId === 'reventon-v1') return reventonRealtimeProfile
  return undefined
}

/** Compatibility for owners which already attach the registered adapter to the
 * product root. Explicit prepare(profile) remains the preferred handoff.
 */
export function realtimeSceneProfile(scene: Object3D): RealtimeProductProfile | undefined {
  let profile: RealtimeProductProfile | undefined
  scene.traverse((object) => {
    const adapter: unknown = object.userData.adapter,
      candidate = realtimeProductProfile(adapter)
    if (!candidate) return
    if (profile && profile !== candidate)
      throw new Error('A realtime stage cannot contain multiple registered products')
    profile = candidate
  })
  return profile
}
