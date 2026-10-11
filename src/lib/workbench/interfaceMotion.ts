import { gsap } from 'gsap'

/** Vue transition hooks with one owner; cancelled or replaced transitions settle cleanly. */
export function createInterfaceMotion() {
  const active = new Set<Element>()
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches
  function cancel(element: Element) {
    gsap.killTweensOf(element)
    active.delete(element)
  }
  function enter(element: Element, done: () => void) {
    cancel(element)
    element.removeAttribute('inert')
    active.add(element)
    gsap.fromTo(
      element,
      { opacity: 0, y: 12 },
      {
        opacity: 1,
        y: 0,
        duration: reduced() ? 0 : 0.32,
        ease: 'power3.out',
        onComplete: () => {
          active.delete(element)
          done()
        },
      },
    )
  }
  function leave(element: Element, done: () => void) {
    cancel(element)
    active.add(element)
    element.setAttribute('inert', '')
    gsap.to(element, {
      opacity: 0,
      y: 8,
      duration: reduced() ? 0 : 0.18,
      ease: 'power2.out',
      onComplete: () => {
        active.delete(element)
        done()
      },
    })
  }
  function replace(element: Element) {
    cancel(element)
    active.add(element)
    gsap.fromTo(
      element,
      { opacity: 0.65, y: 5 },
      {
        opacity: 1,
        y: 0,
        duration: reduced() ? 0 : 0.22,
        ease: 'power3.out',
        onComplete: () => active.delete(element),
      },
    )
  }
  return {
    enter,
    leave,
    replace,
    cancel,
    dispose() {
      for (const el of active) gsap.killTweensOf(el)
      active.clear()
    },
  }
}
