/** Reservations include in-flight downloads, preventing completed siblings exceeding the cap. */
export function byteResidency(limit: number) {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('Invalid byte limit')
  let resident = 0
  const waiting: { bytes: number; start(): void }[] = []
  function drain() {
    while (waiting.length) {
      const next = waiting[0]!
      // An oversized file is allowed only alone. FIFO prevents starvation by small files.
      if (resident !== 0 && resident + next.bytes > limit) return
      waiting.shift()
      next.start()
    }
  }
  return {
    get bytes() {
      return resident
    },
    reserve(bytes: number, signal: AbortSignal): Promise<() => void> {
      signal.throwIfAborted()
      if (!Number.isSafeInteger(bytes) || bytes < 0) throw new Error('Invalid file size')
      return new Promise((resolve, reject) => {
        const cancel = () => {
          const index = waiting.indexOf(request)
          if (index >= 0) waiting.splice(index, 1)
          reject(signal.reason)
          drain()
        }
        const request = {
          bytes,
          start() {
            signal.removeEventListener('abort', cancel)
            resident += bytes
            let released = false
            resolve(() => {
              if (released) return
              released = true
              resident -= bytes
              drain()
            })
          },
        }
        waiting.push(request)
        signal.addEventListener('abort', cancel, { once: true })
        drain()
      })
    },
  }
}

export const verifiedByteResidency = byteResidency(256 * 1024 * 1024)
