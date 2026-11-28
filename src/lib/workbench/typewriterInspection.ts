import type { Vec3 } from './types'

export const representativeTypebar = 'part-000'

const splitOffset: Vec3 = [0.9, 1.56, -1.4]
const flatOffset: Vec3 = [-0.8, 2, 0.4]

/** Calibrated against the completed layout poses at the reference 0.16 scale. */
export function typebarInspectionOffset(progress: number): Vec3 | undefined {
  if (Math.abs(progress - 0.6) < 0.001) return splitOffset
  if (Math.abs(progress - 1) < 0.001) return flatOffset
}
