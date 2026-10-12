import type { WebGLRenderer } from 'three'
import type { WebGPURenderer } from 'three/webgpu'

export type WorkbenchRenderer = WebGLRenderer | WebGPURenderer

/** Keep the WebGPU runtime out of the default WebGL workbench chunk. */
export function isWebGpuRenderer(renderer: WorkbenchRenderer): renderer is WebGPURenderer {
  return 'isWebGPURenderer' in renderer && renderer.isWebGPURenderer === true
}
