/** Bounds transient decode buffers without resizing textures or changing their formats. */
export function decodeQueue(limit: number, signal: AbortSignal) {
  let active = 0
  const waiting: (() => void)[] = []
  return async <T>(work: () => Promise<T>): Promise<T> => {
    await new Promise<void>((resolve) => {
      const start = () => {
        active++
        resolve()
      }
      if (active < limit) start()
      else waiting.push(start)
    })
    try {
      signal.throwIfAborted()
      return await work()
    } finally {
      active--
      waiting.shift()?.()
    }
  }
}
