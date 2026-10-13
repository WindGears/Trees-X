/** Runtime mode belongs to a renderer identity, never to URL or shared scene state. */
const realtimeRenderers = new WeakSet<object>()

/** The renderer factory owns this registration and releases it even if init fails. */
export function registerRealtimeRenderer(renderer: object) {
  realtimeRenderers.add(renderer)
  let released = false
  return () => {
    if (released) return
    released = true
    realtimeRenderers.delete(renderer)
  }
}

export function isRealtimeRenderer(renderer: object) {
  return realtimeRenderers.has(renderer)
}
