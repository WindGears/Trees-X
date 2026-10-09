/** Probe without mounting a canvas or creating a renderer; release the test context immediately. */
export function supportsWebGL2(): boolean {
  const canvas = document.createElement('canvas')
  let context: WebGL2RenderingContext | null = null
  try {
    context = canvas.getContext('webgl2')
    return context !== null
  } catch {
    return false
  } finally {
    context?.getExtension('WEBGL_lose_context')?.loseContext()
    canvas.width = canvas.height = 0
  }
}
