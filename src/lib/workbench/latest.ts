/** Owns cancellation and rejects late results even when a transport ignores abort. */
export class LatestRequest {
  private revision = 0
  private controller?: AbortController
  cancel() {
    this.revision++
    this.controller?.abort()
    this.controller = undefined
  }
  async run<T>(
    load: (signal: AbortSignal) => Promise<T>,
    accept: (value: T) => void,
    fail: (error: unknown) => void,
  ) {
    this.cancel()
    const revision = this.revision
    const controller = new AbortController()
    this.controller = controller
    try {
      const value = await load(controller.signal)
      if (revision === this.revision && !controller.signal.aborted) accept(value)
    } catch (error) {
      if (revision === this.revision && !controller.signal.aborted) fail(error)
    }
  }
}
