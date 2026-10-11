import { createLabRenderer, runLabRenderer, type LabRenderer, type LabRun } from './renderer'
import { createLabScene, type LabScene } from './scene'
import { labSettings, readLabRequest, type LabPhase } from './settings'
import './style.css'

interface LabBridge {
  snapshot(): unknown
  png(): ReturnType<LabRun['png']>
  checkpoint(minimum: number): Promise<{
    evidence: unknown
    png: string
    pixels: Awaited<ReturnType<LabRun['png']>>['pixels']
  }>
  dispose(): void
}
declare global {
  interface Window {
    __treesRenderLab?: LabBridge
  }
}
const request = readLabRequest(location.search),
  canvas = document.querySelector<HTMLCanvasElement>('#lab-canvas')!,
  label = document.querySelector<HTMLElement>('#lab-status')!,
  exporter = document.querySelector<HTMLButtonElement>('#lab-export')!,
  abort = new AbortController()
let driver: LabRenderer | undefined,
  shared: LabScene | undefined,
  run: LabRun | undefined,
  phase: LabPhase = 'loading',
  message = '',
  disposed = false,
  resourcesReleased = false
function status(value: LabPhase, text: string) {
  phase = value
  message = text
  document.body.dataset.status = value
  document.body.dataset.mode = request.mode
  label.textContent = text
  exporter.disabled = value !== 'ready' && value !== 'rendering'
}
function snapshot() {
  return {
    phase,
    message,
    request,
    backend: driver?.backend ?? null,
    settings: labSettings,
    identity: shared?.identity ?? null,
    materials: shared?.materials ?? null,
    camera: shared
      ? {
          position: shared.camera.position.toArray(),
          target: shared.target.toArray(),
          quaternion: shared.camera.quaternion.toArray(),
          fov: shared.camera.fov,
          zoom: shared.camera.zoom,
          view: shared.camera.view ? { ...shared.camera.view } : null,
          coordinateSystem: shared.camera.coordinateSystem,
          matrixWorld: shared.camera.matrixWorld.toArray(),
          projectionMatrix: shared.camera.projectionMatrix.toArray(),
        }
      : null,
    runtime: run?.snapshot() ?? null,
  }
}
function releaseResources() {
  if (resourcesReleased) return
  resourcesReleased = true
  abort.abort()
  run?.dispose()
  shared?.dispose()
  driver?.renderer.dispose()
}
function dispose() {
  if (disposed) return
  disposed = true
  releaseResources()
  status('disposed', '独立验证场景已释放。')
}
window.__treesRenderLab = {
  snapshot,
  png: async () => {
    if (!run || phase !== 'ready') throw new Error('实际首帧或目标采样尚未完成')
    return run.png()
  },
  checkpoint: async (minimum: number) => {
    if (!run || !['rendering', 'ready'].includes(phase)) throw new Error('采样检查点尚未开放')
    const result = await run.checkpoint(minimum)
    return { evidence: snapshot(), png: result.png, pixels: result.pixels }
  },
  dispose,
}
document.body.classList.toggle(
  'lab-capture',
  new URLSearchParams(location.search).get('capture') === '1',
)
for (const link of document.querySelectorAll<HTMLAnchorElement>('a[data-mode],a[data-view]')) {
  const query = new URLSearchParams(location.search)
  if (link.dataset.mode) query.set('mode', link.dataset.mode)
  if (link.dataset.view) query.set('view', link.dataset.view)
  link.href = `?${query}`
}
exporter.addEventListener('click', () => {
  const url = URL.createObjectURL(
      new Blob([JSON.stringify(snapshot(), null, 2)], { type: 'application/json' }),
    ),
    link = document.createElement('a')
  link.href = url
  link.download = `renderlab-${request.mode}-${request.view}.json`
  link.click()
  URL.revokeObjectURL(url)
})
window.addEventListener('pagehide', dispose, { once: true })
window.addEventListener('unhandledrejection', (event) => {
  if (!disposed) {
    disposed = true
    releaseResources()
    status('error', String(event.reason))
  }
})
status('loading', '读取同一资源与物理场景…')
try {
  driver = await createLabRenderer(request.mode, canvas)
  if (disposed) {
    driver.renderer.dispose()
    throw new Error('页面已退出')
  }
  shared = await createLabScene(request, innerWidth, innerHeight, abort.signal)
  if (disposed) throw new Error('页面已退出')
  run = await runLabRenderer(driver, shared, request, status)
  if (disposed) run.dispose()
} catch (error) {
  if (!disposed) {
    releaseResources()
    status('error', error instanceof Error ? error.message : String(error))
  }
}
