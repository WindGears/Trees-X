import { gsap } from 'gsap'
import {
  solveCalloutLayout,
  stepCalloutLayout,
  type CalloutLayoutItem,
  type CalloutRect,
} from './calloutLayout'
import type { PlaceCallout } from './calloutProjection'
import { calloutOverlaps, calloutPathsCross, calloutWithin } from './calloutTransition'

interface Entry extends CalloutLayoutItem {
  button: HTMLButtonElement
  line: SVGPathElement
  dot: SVGCircleElement
  alpha: number
  shown: boolean
  projected: boolean
  frame: number
  relocating: boolean
}
interface Context {
  selected(): string | null
  details(): boolean
}

/** Screen-space DOM only. Owns its GSAP ticker, fades and observer; never drives WebGL. */
export function createCalloutOverlay(host: HTMLElement, context: Context) {
  let entries: Entry[] = []
  const byId = new Map<string, Entry>()
  const bounds: CalloutRect = { x: 16, y: 16, width: 0, height: 0 }
  const model: CalloutRect = { x: 0, y: 0, width: 0, height: 0 }
  const obstacles: CalloutRect[] = [model]
  const obstacleElements: { element: HTMLElement; rect: CalloutRect }[] = []
  let frame = 0,
    reveal = 0,
    ticking = false,
    active = true,
    disposed = false
  const media = matchMedia('(prefers-reduced-motion: reduce)')
  const view = host.closest('.wb-view') ?? host.parentElement
  const floating = host.closest('.wb-floating')
  const obstacleHost = floating ?? view
  function collectObstacles() {
    for (const { element } of obstacleElements) observer.unobserve(element)
    obstacleElements.length = 0
    obstacles.length = 1
    obstacleHost
      ?.querySelectorAll<HTMLElement>(
        '.wb-intro,.wb-tools,.wb-input-hint,.wb-keyboard-hint,.wb-rail,.wb-panel,.wb-header',
      )
      .forEach((element) => {
        const rect = { x: 0, y: 0, width: 0, height: 0 }
        obstacles.push(rect)
        obstacleElements.push({ element, rect })
        observer.observe(element)
      })
  }

  function paint(entry: Entry) {
    if (Number.isFinite(entry.x) && Number.isFinite(entry.y)) {
      entry.button.style.transform = `translate3d(${entry.x.toFixed(2)}px,${entry.y.toFixed(2)}px,0)`
      // Nearest point on the current rectangle stays continuous across side changes.
      const endX = Math.max(entry.x, Math.min(entry.x + entry.width, entry.anchorX))
      const endY = Math.max(entry.y, Math.min(entry.y + entry.height, entry.anchorY))
      const elbow = endX + (entry.anchorX >= endX ? 12 : -12)
      entry.line.setAttribute(
        'd',
        `M${entry.anchorX.toFixed(2)},${entry.anchorY.toFixed(2)} L${elbow.toFixed(2)},${endY.toFixed(2)} L${endX.toFixed(2)},${endY.toFixed(2)}`,
      )
      entry.dot.setAttribute('cx', String(entry.anchorX))
      entry.dot.setAttribute('cy', String(entry.anchorY))
    }
    const alpha = String(entry.alpha)
    entry.button.style.opacity = alpha
    entry.line.style.opacity = alpha
    entry.line.style.strokeDashoffset = String(1 - entry.alpha)
    entry.dot.style.opacity = alpha
    const visibility = calloutWithin(entry, bounds) ? 'visible' : 'hidden'
    entry.button.style.visibility = visibility
    entry.line.style.visibility = visibility
    entry.dot.style.visibility = visibility
  }
  function stop() {
    gsap.ticker.remove(tick)
    ticking = false
  }
  function tick(_time: number, deltaMs: number) {
    if (!active || disposed) return stop()
    const settled = stepCalloutLayout(entries, Math.min(deltaMs / 1000, 0.05), media.matches)
    reconcile()
    for (const entry of entries) paint(entry)
    if (settled) stop()
  }
  function start() {
    if (!active || ticking || disposed) return
    ticking = true
    gsap.ticker.add(tick)
  }
  function fade(entry: Entry, shown: boolean) {
    if (shown === entry.shown) return
    entry.shown = shown
    entry.button.dataset.layoutVisible = String(shown)
    entry.button.tabIndex = shown ? 0 : -1
    entry.button.style.pointerEvents = shown ? 'auto' : 'none'
    entry.button.setAttribute('aria-hidden', String(!shown))
    gsap.killTweensOf(entry)
    if (shown) entry.button.hidden = false
    gsap.to(entry, {
      alpha: shown ? 1 : 0,
      duration: media.matches || !active ? 0 : shown ? 0.32 : 0.22,
      ease: 'power2.out',
      onUpdate: () => paint(entry),
      onComplete: () => {
        entry.button.hidden = !entry.shown
        paint(entry)
        if (!disposed) {
          reconcile()
          start()
        }
      },
    })
  }
  function targetClear(entry: Entry) {
    for (const other of entries)
      if (
        other !== entry &&
        other.alpha > 0.02 &&
        calloutOverlaps(entry.targetX, entry.targetY, entry.width, entry.height, other)
      )
        return false
    return true
  }
  function pathClear(entry: Entry) {
    const left = Math.min(entry.x, entry.targetX),
      top = Math.min(entry.y, entry.targetY)
    for (const obstacle of obstacles)
      if (
        obstacle.width > 0 &&
        obstacle.height > 0 &&
        calloutOverlaps(
          left,
          top,
          entry.width + Math.abs(entry.x - entry.targetX),
          entry.height + Math.abs(entry.y - entry.targetY),
          obstacle,
        )
      )
        return false
    for (const other of entries)
      if (
        other !== entry &&
        other.alpha > 0.02 &&
        calloutPathsCross(entry, other, other.visible && !other.relocating)
      )
        return false
    return true
  }
  function reconcile() {
    for (const entry of entries) {
      entry.moving = false
      if (!entry.visible) {
        fade(entry, false)
        continue
      }
      if (entry.alpha <= 0.02 && !entry.shown) {
        if (!targetClear(entry)) continue
        entry.x = entry.targetX
        entry.y = entry.targetY
        entry.relocating = false
        entry.moving = true
        fade(entry, true)
      } else if (entry.relocating || !calloutWithin(entry, bounds) || !pathClear(entry)) {
        entry.relocating = true
        fade(entry, false)
      } else {
        entry.moving = true
        fade(entry, true)
      }
    }
  }
  function measure() {
    const origin = host.getBoundingClientRect()
    bounds.width = Math.max(0, origin.width - 32)
    bounds.height = Math.max(0, origin.height - 32)
    for (const entry of entries) {
      // Hidden labels need a real text measurement, without a visible frame.
      const hidden = entry.button.hidden
      entry.button.hidden = false
      entry.width = entry.button.offsetWidth
      entry.height = entry.button.offsetHeight
      entry.button.hidden = hidden
    }
    for (const { element, rect } of obstacleElements) {
      const value = element.getBoundingClientRect()
      const visible =
        value.width > 0 &&
        value.height > 0 &&
        getComputedStyle(element).display !== 'none' &&
        (!element.classList.contains('wb-keyboard-hint') ||
          element.closest('.wb-stage')?.matches(':focus-visible'))
      rect.x = value.left - origin.left
      rect.y = value.top - origin.top
      rect.width = visible ? value.width : 0
      rect.height = visible ? value.height : 0
    }
  }
  function layout() {
    if (disposed) return
    const selected = context.selected()
    const expanded = reveal > 0.002
    host.dataset.expanded = String(expanded)
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity
    for (const entry of entries) {
      const wanted = expanded || entry.id === selected || (context.details() && !selected)
      entry.enabled = wanted && entry.projected
      entry.priority = entry.id === selected ? 100 : 10
      if (entry.enabled) {
        minX = Math.min(minX, entry.anchorX)
        minY = Math.min(minY, entry.anchorY)
        maxX = Math.max(maxX, entry.anchorX)
        maxY = Math.max(maxY, entry.anchorY)
      }
    }
    // A compact anchor cluster leaves a clear central observation area.
    model.x = minX - 22
    model.y = minY - 22
    model.width = maxX - minX + 44
    model.height = maxY - minY + 44
    if (
      model.width > bounds.width * 0.65 ||
      model.height > bounds.height * 0.65 ||
      !Number.isFinite(model.width)
    )
      model.width = model.height = 0
    solveCalloutLayout(entries, bounds, obstacles)
    stepCalloutLayout(entries, 0, media.matches)
    reconcile()
    for (const entry of entries) paint(entry)
    start()
  }
  const observer = new ResizeObserver(() => {
    measure()
    layout()
  })
  observer.observe(host)
  collectObstacles()
  const mutations = new MutationObserver(() => {
    collectObstacles()
    measure()
    layout()
  })
  if (obstacleHost) mutations.observe(obstacleHost, { childList: true, subtree: true })
  function refresh() {
    const next: Entry[] = []
    host.querySelectorAll<HTMLButtonElement>('button[data-part]').forEach((button) => {
      const id = button.dataset.part!
      const line = host.querySelector<SVGPathElement>(`path[data-part="${CSS.escape(id)}"]`)
      const dot = host.querySelector<SVGCircleElement>(`circle[data-part="${CSS.escape(id)}"]`)
      if (!line || !dot) return
      let entry = byId.get(id)
      if (!entry) {
        entry = {
          id,
          button,
          line,
          dot,
          anchorX: 0,
          anchorY: 0,
          width: 0,
          height: 0,
          x: NaN,
          y: NaN,
          targetX: NaN,
          targetY: NaN,
          side: 'left',
          visible: false,
          priority: 10,
          alpha: 0,
          shown: false,
          projected: false,
          frame: -1,
          relocating: false,
        }
        byId.set(id, entry)
        button.style.opacity = '0'
        button.style.pointerEvents = 'none'
        button.tabIndex = -1
      }
      next.push(entry)
    })
    for (const entry of entries)
      if (!next.includes(entry)) {
        gsap.killTweensOf(entry)
        byId.delete(entry.id)
      }
    entries = next
    measure()
    layout()
  }
  const place: PlaceCallout = (id, x, y, visible, progress) => {
    reveal = progress
    const entry = byId.get(id)
    if (!entry) return
    entry.anchorX = x
    entry.anchorY = y
    entry.projected = visible
    entry.frame = frame
  }
  function commit() {
    if (floating) measure()
    for (const entry of entries) if (entry.frame !== frame) entry.projected = false
    frame++
    layout()
  }
  const changed = () => {
    measure()
    layout()
  }
  media.addEventListener('change', changed)
  refresh()
  return {
    place,
    commit,
    refresh,
    contextChanged: changed,
    setActive(value: boolean) {
      active = value
      if (!value) {
        stop()
        for (const entry of entries) gsap.killTweensOf(entry)
      } else {
        for (const entry of entries) {
          entry.shown = !entry.visible
          fade(entry, entry.visible)
        }
        changed()
      }
    },
    dispose() {
      disposed = true
      stop()
      observer.disconnect()
      mutations.disconnect()
      media.removeEventListener('change', changed)
      for (const entry of entries) gsap.killTweensOf(entry)
      entries = []
      byId.clear()
    },
  }
}
