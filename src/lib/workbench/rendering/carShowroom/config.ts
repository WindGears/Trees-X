export type ShowroomVector3 = readonly [number, number, number]

export interface CarShowroomLight {
  readonly id: string
  readonly color: string
  readonly intensity: number
  readonly radiance: number
  readonly width: number
  readonly height: number
  readonly position: ShowroomVector3
  readonly target: ShowroomVector3
}

/** Internal artistic settings. No product schema or database field is introduced. */
export interface CarShowroomConfig {
  readonly id: 'cold-studio'
  readonly revision: number
  readonly groundY: number
  readonly exposure: number
  readonly roomBox: {
    readonly min: ShowroomVector3
    readonly max: ShowroomVector3
  }
  readonly capture: { readonly size: 1024; readonly position: ShowroomVector3 }
  readonly floor: {
    readonly color: string
    readonly roughness: number
    readonly metalness: number
    readonly width: number
    readonly depth: number
    readonly tileSize: number
  }
  readonly wallColor: string
  readonly ceilingColor: string
  readonly coveRadius: number
  readonly lights: {
    readonly key: CarShowroomLight
    readonly strip: CarShowroomLight
    readonly fill: CarShowroomLight
    readonly rim: CarShowroomLight
  }
}

/** Frozen inputs for the first same-room reflection comparison; white is neutral. */
export const coldStudioConfig: CarShowroomConfig = Object.freeze<CarShowroomConfig>({
  id: 'cold-studio',
  revision: 10,
  groundY: -0.01,
  exposure: 1,
  roomBox: { min: [-7, -0.01, -9], max: [7, 4.6, 9] },
  capture: { size: 1024, position: [0, 0.8, -0.35] },
  floor: {
    color: '#bfbfbf',
    roughness: 1,
    metalness: 0,
    width: 14,
    depth: 18,
    tileSize: 1.2,
  },
  wallColor: '#343537',
  ceilingColor: '#303339',
  coveRadius: 0.45,
  lights: {
    key: {
      id: 'key',
      color: '#ffffff',
      intensity: 7,
      radiance: 7,
      width: 5.5,
      height: 3.2,
      position: [-3.15, 4.46, -0.6],
      target: [-3.15, 0.55, -0.6],
    },
    strip: {
      id: 'strip',
      color: '#ffffff',
      intensity: 4.8,
      radiance: 4.8,
      width: 5.5,
      height: 3.2,
      position: [3.15, 4.46, -0.6],
      target: [3.15, 0.55, -0.6],
    },
    rim: {
      id: 'rim',
      color: '#ffffff',
      intensity: 8,
      radiance: 8,
      width: 5,
      height: 2.8,
      position: [3.3, 2.45, 8.86],
      target: [3.3, 2.45, 0],
    },
    fill: {
      id: 'fill',
      color: '#ffffff',
      intensity: 5,
      radiance: 5,
      width: 1.4,
      height: 3.7,
      position: [6.86, 2.35, -3.4],
      target: [0, 2.35, -3.4],
    },
  },
})
