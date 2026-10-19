// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick, reactive, type App } from 'vue'
import { useWorkbenchRenderHost } from './useWorkbenchRenderHost'
import {
  retirePreparedRenderer,
  withPreparationLease,
} from '@/lib/workbench/rendering/preparationLease'

const state = vi.hoisted(() => ({
  store: undefined as
    | {
        presentation: { source: { kind: string; adapter?: string } } | null
        product: object | null
        status: string
        error: string
        useContent: (message: string) => void
      }
    | undefined,
  loss: undefined as (() => void) | undefined,
  factories: 0,
  failFactory: false,
}))
vi.mock('@/stores/workbench', () => ({ useWorkbenchStore: () => state.store! }))
vi.mock('@/lib/workbench/renderSupport', () => ({ supportsWebGL2: () => true }))
vi.mock('@/lib/workbench/rendering/rendererFactory', () => ({
  gpuRendererFactory: (loss: () => void) => {
    if (state.failFactory) throw new Error('GPU module unavailable')
    state.factories++
    state.loss = loss
    return () => ({})
  },
}))

let app: App | undefined
const source = (adapter: string) => ({ source: { kind: 'glb', adapter } })
const settle = async () => {
  // Dynamic module loading resolves on the event loop, after Vue's microtasks.
  for (let i = 0; i < 8; i++) {
    await nextTick()
    await new Promise((resolve) => setTimeout(resolve, 1))
  }
}
function mount() {
  let host: ReturnType<typeof useWorkbenchRenderHost> | undefined
  const capture = vi.fn(() => undefined)
  app = createApp(
    defineComponent({
      setup() {
        host = useWorkbenchRenderHost(capture)
        return () => h('div', host!.hostPrepared.value ? host!.backend.value : 'unmounted')
      },
    }),
  )
  app.mount(document.createElement('div'))
  return { host: host!, capture }
}
beforeEach(() => {
  history.replaceState(null, '', '/?renderPipeline=realtime')
  vi.stubGlobal('navigator', { gpu: {} })
  vi.stubGlobal('matchMedia', () => ({ matches: true }))
  vi.stubGlobal('innerWidth', 1440)
  state.store = reactive({
    presentation: source('typewriter-v1'),
    product: {},
    status: 'ready',
    error: '',
    useContent: vi.fn(),
  })
  state.factories = 0
  state.failFactory = false
  state.loss = undefined
})
afterEach(() => {
  app?.unmount()
  app = undefined
  vi.unstubAllGlobals()
})

describe('single Tres rendering host routing and recovery', () => {
  it('preserves the WebGL default without requesting a GPU renderer factory', async () => {
    history.replaceState(null, '', '/')
    const { host } = mount()
    await settle()
    expect(host.backend.value).toBe('webgl')
    expect(host.hostPrepared.value).toBe(true)
    expect(state.factories).toBe(0)
  })

  it.each(['piano-v1', 'unregistered-v1'])(
    'starts an already configured %s preview directly in WebGL',
    async (adapter) => {
      state.store!.presentation = source(adapter)
      const { host } = mount()
      await settle()
      expect(host.backend.value).toBe('webgl')
      expect(host.notice.value).toContain('原有管线')
      expect(state.factories).toBe(0)
    },
  )

  it('starts a registered car preview in realtime GPU without recreating it for the typewriter', async () => {
    state.store!.presentation = source('reventon-v1')
    const { host } = mount()
    await settle()
    expect(host.backend.value).toBe('webgpu')
    expect(state.factories).toBe(1)
    const revision = host.hostRevision.value
    state.store!.presentation = source('typewriter-v1')
    await settle()
    expect(host.backend.value).toBe('webgpu')
    expect(host.hostRevision.value).toBe(revision)
    expect(state.factories).toBe(1)
    state.store!.presentation = source('reventon-v1')
    await settle()
    expect(host.hostRevision.value).toBe(revision)
    expect(state.factories).toBe(1)
  })

  it('unmounts before replacing and reconciles a selection made during teardown', async () => {
    const { host } = mount()
    await settle()
    expect(host.backend.value).toBe('webgpu')
    const revision = host.hostRevision.value
    state.store!.presentation = source('piano-v1')
    expect(host.hostPrepared.value).toBe(false)
    state.store!.presentation = source('typewriter-v1')
    await settle()
    expect(host.backend.value).toBe('webgpu')
    expect(host.hostPrepared.value).toBe(true)
    expect(host.hostRevision.value).toBe(revision + 2)
    expect(host.notice.value).toBe('')
  })
  it('does not construct the successor while the unmounted predecessor is compiling', async () => {
    const { host } = mount()
    await settle()
    const predecessor = {},
      dispose = vi.fn()
    let finish!: () => void
    const compile = withPreparationLease(
      predecessor,
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        }),
    )
    retirePreparedRenderer(predecessor, dispose)
    state.store!.presentation = source('piano-v1')
    await settle()
    expect(host.hostPrepared.value).toBe(false)
    expect(host.backend.value).toBe('webgpu')
    expect(host.hostRevision.value).toBe(0)
    expect(state.factories).toBe(1)
    expect(dispose).not.toHaveBeenCalled()
    finish()
    await compile
    await settle()
    expect(dispose).toHaveBeenCalledOnce()
    expect(host.hostPrepared.value).toBe(true)
    expect(host.backend.value).toBe('webgl')
    expect(host.hostRevision.value).toBe(1)
  })

  it('rebuilds after one device loss, then falls back and ignores stale callbacks', async () => {
    const { host, capture } = mount()
    await settle()
    const firstLoss = state.loss!
    firstLoss()
    expect(host.hostPrepared.value).toBe(false)
    await settle()
    expect(host.backend.value).toBe('webgpu')
    expect(capture).toHaveBeenCalledTimes(1)
    firstLoss()
    await settle()
    expect(capture).toHaveBeenCalledTimes(1)
    state.loss!()
    await settle()
    expect(host.backend.value).toBe('webgl')
    expect(host.notice.value).toContain('未能恢复')
    state.store!.presentation = source('typewriter-v1')
    await settle()
    expect(host.backend.value).toBe('webgl')
  })

  it('falls back after a replacement preparation failure without an unhandled retry loop', async () => {
    const { host } = mount()
    await settle()
    state.store!.presentation = source('piano-v1')
    await settle()
    state.failFactory = true
    state.store!.presentation = source('typewriter-v1')
    await settle()
    expect(host.backend.value).toBe('webgl')
    expect(host.hostPrepared.value).toBe(true)
    expect(host.notice.value).toContain('启动失败')
  })

  it('does not prepare or recover after the component is disposed', async () => {
    const { host, capture } = mount()
    await settle()
    const loss = state.loss!
    app!.unmount()
    app = undefined
    loss()
    state.store!.presentation = source('piano-v1')
    await settle()
    expect(capture).not.toHaveBeenCalled()
    expect(host.backend.value).toBe('webgpu')
    expect(state.factories).toBe(1)
  })
})
