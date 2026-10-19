/** Owns at most one asynchronous result, even when a decoder ignores cancellation. */
export class ResourceSlot<T extends { dispose(): void }> {
  private revision = 0
  private abort?: AbortController
  private current?: T
  /** Cancels pending work without disposing a result still used by native preparation. */
  cancelPending() {
    this.revision++
    this.abort?.abort()
    this.abort = undefined
  }
  clear() {
    this.cancelPending()
    this.current?.dispose()
    this.current = undefined
  }
  async load(factory: (signal: AbortSignal) => Promise<T>): Promise<T | undefined> {
    this.clear()
    const revision = this.revision,
      abort = new AbortController()
    this.abort = abort
    try {
      const value = await factory(abort.signal)
      if (abort.signal.aborted || revision !== this.revision) {
        value.dispose()
        return
      }
      this.current = value
      return value
    } catch (error) {
      if (abort.signal.aborted || revision !== this.revision) return
      throw error
    }
  }
}
