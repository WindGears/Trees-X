/** A fair, abortable semaphore. Running native/Worker work keeps its slot until settled. */
export function taskSlots(limit: number) {
  if (!Number.isInteger(limit) || limit < 1) throw new Error('Invalid task limit')
  let active = 0
  const waiting: (() => void)[] = []
  return async <T>(signal: AbortSignal, work: () => Promise<T>): Promise<T> => {
    signal.throwIfAborted()
    await new Promise<void>((resolve, reject) => {
      const cancel = () => {
        const index = waiting.indexOf(start)
        if (index >= 0) waiting.splice(index, 1)
        reject(signal.reason)
      }
      const start = () => {
        signal.removeEventListener('abort', cancel)
        active++
        resolve()
      }
      signal.addEventListener('abort', cancel, { once: true })
      if (active < limit && waiting.length === 0) start()
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

/** Module-wide limits also cover tasks left running by a superseded selection. */
export const downloadWork = taskSlots(3)
export const heavyWork = taskSlots(2)

/** Bounds transient decode buffers without resizing textures or changing their formats. */
export function decodeQueue(limit: number, signal: AbortSignal) {
  const run = taskSlots(limit)
  return <T>(work: () => Promise<T>): Promise<T> => run(signal, work)
}
