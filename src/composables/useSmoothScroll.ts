import { onMounted, onScopeDispose } from 'vue'
import { gsap } from 'gsap'
import Lenis from 'lenis'

export function useSmoothScroll() {
  let lenis: Lenis | undefined
  let media: MediaQueryList | undefined
  const tick = (seconds: number) => lenis?.raf(seconds * 1000)
  const update = () => {
    lenis?.destroy()
    lenis = undefined
    gsap.ticker.remove(tick)
    if (!media?.matches) {
      lenis = new Lenis({ autoRaf: false, anchors: true, smoothWheel: true })
      gsap.ticker.add(tick)
    }
  }
  onMounted(() => {
    media = window.matchMedia('(prefers-reduced-motion: reduce)')
    media.addEventListener('change', update)
    update()
  })
  onScopeDispose(() => {
    media?.removeEventListener('change', update)
    gsap.ticker.remove(tick)
    lenis?.destroy()
  })
}
