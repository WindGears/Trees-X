import type { ProductPresentation } from './types'

export type PlaceCallout = (
  id: string,
  x: number,
  y: number,
  visible: boolean,
  reveal: number,
) => void

/** Only persistent structure states reveal annotations; transient key strikes do not. */
export function structureReveal(presentation: ProductPresentation, pose: Record<string, number>) {
  let value = pose.explosion ?? 0
  for (const action of presentation.actions) {
    if (action.kind === 'progress' || action.kind === 'toggle')
      value = Math.max(value, pose[action.id] ?? 0)
  }
  return Math.min(1, Math.max(0, value))
}
