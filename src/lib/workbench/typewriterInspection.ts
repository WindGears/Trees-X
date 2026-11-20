import type { Vec3 } from './types'

export const representativeTypebar = 'part-000'

const splitOffset: Vec3 = [0.45, 0.78, -0.7]
const flatOffset: Vec3 = [-0.4, 1, 0.2]

/** Calibrated against the completed layout poses at the reference 0.16 scale. */
export function typebarInspectionOffset(progress: number): Vec3 | undefined {
  if (Math.abs(progress - 0.6) < 0.001) return splitOffset
  if (Math.abs(progress - 1) < 0.001) return flatOffset
}
