export type WorkbenchBackend = 'webgl' | 'webgpu'

/** The verified WebGL entry remains the default until all product gates pass. */
export function requestedBackend(search: string, gpu: boolean, desktop: boolean): WorkbenchBackend {
  const pipeline = new URLSearchParams(search).get('renderPipeline')
  return (pipeline === 'hybrid' || pipeline === 'realtime') && gpu && desktop ? 'webgpu' : 'webgl'
}

/** A lost device gets one complete host rebuild, then the verified fallback. */
export function recoveryBackend(backend: WorkbenchBackend, retries: number): WorkbenchBackend {
  return backend === 'webgpu' && retries === 0 ? 'webgpu' : 'webgl'
}
