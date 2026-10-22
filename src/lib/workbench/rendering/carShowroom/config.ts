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
  readonly lights: { readonly key: CarShowroomLight; readonly strip: CarShowroomLight }
}

/** Frozen inputs for the first same-room reflection comparison; white is neutral. */
export const coldStudioConfig: CarShowroomConfig = Object.freeze<CarShowroomConfig>({
  id: 'cold-studio',
  revision: 2,
  groundY: -0.01,
  exposure: 1,
  roomBox: { min: [-9, -0.01, -11], max: [9, 7, 11] },
  capture: { size: 1024, position: [0, 0.8, -0.35] },
  floor: {
    color: '#3a3d42',
    roughness: 0.48,
    metalness: 0.04,
    width: 18,
    depth: 22,
    tileSize: 2.2,
  },
  wallColor: '#4b4f55',
  ceilingColor: '#303339',
  coveRadius: 0.9,
  lights: {
    key: {
      id: 'key',
      color: '#ffffff',
      intensity: 8.5,
      radiance: 8.5,
      width: 5.5,
      height: 3.2,
      position: [-1.5, 4.3, -1.8],
      target: [0, 0.55, -0.2],
    },
    strip: {
      id: 'strip',
      color: '#ffffff',
      intensity: 4.8,
      radiance: 4.8,
      width: 6,
      height: 2.2,
      position: [4.4, 3.4, 1.6],
      target: [0, 0.55, 0],
    },
  },
})
