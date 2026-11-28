import { gsap } from 'gsap'

export const inspectorTiming = { enter: 0.28, leave: 0.18, ease: 'power3.out' } as const
export const reducedInterfaceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches

const styles = {
  library: { from: { y: 16 }, atRest: { y: 0 }, exit: { y: 16 }, enter: 0.26, leave: 0.18 },
  soft: { from: { y: 9 }, atRest: { y: 0 }, exit: { y: 6 }, enter: 0.22, leave: 0.16 },
  cover: { from: {}, atRest: {}, exit: {}, enter: 0.18, leave: 0.18 },
  inspector: {
    from: { x: 24 },
    atRest: { x: 0 },
    exit: { x: 24 },
    enter: inspectorTiming.enter,
    leave: inspectorTiming.leave,
  },
} as const

/** Owns only the tweens created for this surface. A reversal keeps the sampled pose. */
export function createInterfaceMotion(style: keyof typeof styles = 'soft') {
  const preset = styles[style]
  const tweens = new Map<Element, gsap.core.Tween>()
  const interrupted = new WeakSet<Element>()

  function cancel(element: Element) {
    const tween = tweens.get(element)
    if (!tween) return
    tween.kill()
    tweens.delete(element)
    interrupted.add(element)
  }

  function clear(element: Element) {
    gsap.set(element, { clearProps: 'opacity,transform' })
  }

  function play(element: Element, to: gsap.TweenVars, duration: number, done?: () => void) {
    const complete = () => {
      tweens.delete(element)
      done?.()
      clear(element)
    }
    if (reducedInterfaceMotion() || document.hidden) {
      complete()
      return
    }
    const tween = gsap.to(element, {
      ...to,
      duration,
      ease: inspectorTiming.ease,
      onComplete: complete,
    })
    tweens.set(element, tween)
  }

  return {
    enter(element: Element, done: () => void) {
      cancel(element)
      element.removeAttribute('inert')
      element.removeAttribute('aria-hidden')
      if (!interrupted.delete(element) && !reducedInterfaceMotion() && !document.hidden)
        gsap.set(element, { opacity: 0, ...preset.from })
      play(element, { opacity: 1, ...preset.atRest }, preset.enter, done)
    },
    leave(element: Element, done: () => void) {
      cancel(element)
      interrupted.delete(element)
      element.setAttribute('inert', '')
      element.setAttribute('aria-hidden', 'true')
      play(element, { opacity: 0, ...preset.exit }, preset.leave, done)
    },
    replace(element: Element) {
      cancel(element)
      if (!interrupted.delete(element) && !reducedInterfaceMotion() && !document.hidden)
        gsap.set(element, { opacity: 0.42 })
      play(element, { opacity: 1, ...preset.atRest }, 0.16)
    },
    cancel,
    dispose() {
      for (const [element, tween] of tweens) {
        tween.kill()
        clear(element)
        element.removeAttribute('inert')
        element.removeAttribute('aria-hidden')
      }
      tweens.clear()
    },
  }
}
