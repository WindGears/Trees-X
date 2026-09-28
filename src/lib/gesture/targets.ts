import type { Position } from './detector'
import type { Target } from './selection'

export interface GestureTarget extends Target {
  id: string
  label: string
  priority: number
  activate: () => void
}

export function targetContains(
  pointer: Position,
  target: Target,
  size: { width: number; height: number },
  exit = false,
) {
  if (!target.visible || size.width <= 0 || size.height <= 0) return false
  const x = Math.abs(pointer.x - target.x) * size.width
  const y = Math.abs(pointer.y - target.y) * size.height
  if (target.halfWidth !== undefined && target.halfHeight !== undefined)
    return x <= target.halfWidth + (exit ? 16 : 4) && y <= target.halfHeight + (exit ? 16 : 4)
  return Math.hypot(x, y) <= (exit ? 96 : 64)
}

/** All providers use canvas-local normalized coordinates; hit tolerances use CSS pixels. */
export class GestureTargets {
  private providers = new Map<string, () => GestureTarget>()
  register(id: string, provider: () => GestureTarget) {
    this.providers.set(id, provider)
    return () => {
      if (this.providers.get(id) === provider) this.providers.delete(id)
    }
  }
  get(id: string) {
    return this.providers.get(id)?.() ?? null
  }
  get size() {
    return this.providers.size
  }
  pick(
    pointer: Position | null,
    size: { width: number; height: number },
    preferred: string | null,
    locked: boolean,
  ) {
    const current = preferred ? this.get(preferred) : null
    if (locked) return current?.visible ? current : null
    if (!pointer) return current?.visible ? current : null
    if (current && targetContains(pointer, current, size, true)) return current
    let best: GestureTarget | null = null,
      nearest = Infinity
    for (const provider of this.providers.values()) {
      const target = provider()
      if (!targetContains(pointer, target, size)) continue
      const distance = Math.hypot(
        (pointer.x - target.x) * size.width,
        (pointer.y - target.y) * size.height,
      )
      if (
        !best ||
        target.priority > best.priority ||
        (target.priority === best.priority && distance < nearest)
      ) {
        best = target
        nearest = distance
      }
    }
    return best
  }
}
