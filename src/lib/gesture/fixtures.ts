// Synthetic trajectories for regression tests; not evidence of human accuracy.
import type { Point } from './detector'
export function hand(offset = 0, pinch = false, fingerOffset = 0): Point[] {
  const points = Array.from({ length: 21 }, () => ({ x: 0.5 + offset, y: 0.5, z: 0 }))
  points[0]!.y = 0.85
  points[5]!.x = 0.35 + offset
  points[17]!.x = 0.65 + offset
  for (const tip of [8, 12, 16, 20]) {
    points[tip]!.y = 0.1
    points[tip - 2]!.y = 0.4
  }
  points[8]!.x += fingerOffset
  points[8]!.y = 0.5
  points[4] = { x: points[8]!.x + (pinch ? 0.01 : 0.22), y: 0.5, z: 0 }
  return points
}
