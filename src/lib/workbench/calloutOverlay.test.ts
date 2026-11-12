// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest'
import { createCalloutOverlay } from './calloutOverlay'

vi.mock('gsap', () => ({
  gsap: { ticker: { add: vi.fn(), remove: vi.fn() }, killTweensOf: vi.fn(), to: vi.fn() },
}))

it('keeps measuring floating obstacles while refreshing label sizes only when layout inputs change', async () => {
  type ResizeCallback = (records: { target: Element }[]) => void
  const observed = new Map<Element, ResizeCallback>()
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(private readonly callback: ResizeCallback) {}
      observe(target: Element) {
        observed.set(target, this.callback)
      }
      unobserve(target: Element) {
        observed.delete(target)
      }
      disconnect() {
        observed.clear()
      }
    },
  )
  const fonts = new EventTarget()
  const originalFonts = Object.getOwnPropertyDescriptor(document, 'fonts')
  Object.defineProperty(document, 'fonts', { value: fonts, configurable: true })

  const root = document.createElement('div')
  root.className = 'wb-floating'
  root.innerHTML = `
    <aside class="wb-panel"></aside>
    <div class="wb-hotspots wb-callouts">
      <svg><path data-part="door"/><circle data-part="door"/>
        <path data-part="wheel"/><circle data-part="wheel"/></svg>
      <button data-part="door" hidden>Door</button>
      <button data-part="wheel" hidden>Wheel</button>
    </div>`
  document.body.append(root)
  const host = root.querySelector<HTMLElement>('.wb-callouts')!
  const panel = root.querySelector<HTMLElement>('.wb-panel')!
  const buttons = [...host.querySelectorAll('button')]
  const hostRect = vi
    .spyOn(host, 'getBoundingClientRect')
    .mockReturnValue(new DOMRect(0, 0, 960, 640))
  let panelX = 740
  const panelRect = vi
    .spyOn(panel, 'getBoundingClientRect')
    .mockImplementation(() => new DOMRect(panelX, 100, 200, 360))
  const labelSize = vi.fn((size: number) => {
    expect(buttons.every((button) => !button.hidden)).toBe(true)
    return size
  })
  for (const button of buttons) {
    Object.defineProperties(button, {
      offsetWidth: { get: () => labelSize(80) },
      offsetHeight: { get: () => labelSize(32) },
    })
  }

  let selected: string | null = null
  let overlay: ReturnType<typeof createCalloutOverlay> | undefined
  try {
    const callouts = createCalloutOverlay(host, { selected: () => selected, details: () => false })
    overlay = callouts
    expect(labelSize).toHaveBeenCalledTimes(4)
    expect(buttons.every((button) => button.hidden)).toBe(true)

    hostRect.mockClear()
    panelRect.mockClear()
    for (let frame = 0; frame < 5; frame++) {
      panelX -= 6
      callouts.place('door', 270 + frame, 220, true, 0)
      callouts.place('wheel', 500 + frame, 340, true, 0)
      callouts.commit()
    }
    expect(hostRect).toHaveBeenCalledTimes(5)
    expect(panelRect.mock.results.map(({ value }) => value.x)).toEqual([734, 728, 722, 716, 710])
    expect(labelSize).toHaveBeenCalledTimes(4)
    expect(buttons.every((button) => button.hidden)).toBe(true)

    observed.get(panel)?.([{ target: panel }])
    expect(panelRect).toHaveBeenCalledTimes(6)
    expect(labelSize).toHaveBeenCalledTimes(4)

    for (const invalidate of [
      () => callouts.refresh(),
      () => {
        selected = 'door'
        buttons[0]!.setAttribute('aria-pressed', 'true')
        callouts.contextChanged()
      },
      () => observed.get(host)?.([{ target: host }]),
      () => window.dispatchEvent(new Event('resize')),
      () => fonts.dispatchEvent(new Event('loadingdone')),
      () => fonts.dispatchEvent(new Event('loadingerror')),
    ]) {
      labelSize.mockClear()
      invalidate()
      expect(labelSize).toHaveBeenCalledTimes(4)
      expect(buttons[1]!.hidden).toBe(true)
    }

    labelSize.mockClear()
    buttons[1]!.firstChild!.textContent = 'Rear wheel'
    await vi.waitFor(() => expect(labelSize).toHaveBeenCalledTimes(4))
    expect(buttons[1]!.hidden).toBe(true)

    callouts.dispose()
    overlay = undefined
    expect(observed.size).toBe(0)
    labelSize.mockClear()
    window.dispatchEvent(new Event('resize'))
    fonts.dispatchEvent(new Event('loadingdone'))
    fonts.dispatchEvent(new Event('loadingerror'))
    expect(labelSize).not.toHaveBeenCalled()
  } finally {
    overlay?.dispose()
    root.remove()
    vi.unstubAllGlobals()
    if (originalFonts) Object.defineProperty(document, 'fonts', originalFonts)
    else Reflect.deleteProperty(document, 'fonts')
  }
})
