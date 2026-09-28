import { computed, onMounted, onScopeDispose, ref, watch } from 'vue'
import type { Ref } from 'vue'

export function useThreeScene(host: Ref<HTMLElement | null>) {
  const supported = ref<boolean | null>(null)
  const halfFloatSupported = ref(false)
  const visible = ref(true)
  const pageVisible = ref(true)
  const desktopPointer = ref(false)
  const reducedMotion = ref(false)
  const pixelRatio = ref(1)
  let observer: IntersectionObserver | undefined
  let media: MediaQueryList | undefined
  let desktopMedia: MediaQueryList | undefined
  const updateMotion = () => {
    reducedMotion.value = media?.matches ?? false
  }
  const updateDpr = () => {
    pixelRatio.value = Math.min(window.devicePixelRatio || 1, 2)
  }
  const updateDesktopPointer = () => {
    desktopPointer.value = desktopMedia?.matches ?? false
  }
  const updatePageVisibility = () => {
    pageVisible.value = document.visibilityState === 'visible'
  }
  onMounted(() => {
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl2')
    supported.value = Boolean(gl)
    halfFloatSupported.value = Boolean(gl?.getExtension('EXT_color_buffer_float'))
    gl?.getExtension('WEBGL_lose_context')?.loseContext()
    media = window.matchMedia('(prefers-reduced-motion: reduce)')
    desktopMedia = window.matchMedia('(min-width: 1024px) and (pointer: fine)')
    media.addEventListener('change', updateMotion)
    desktopMedia.addEventListener('change', updateDesktopPointer)
    window.addEventListener('resize', updateDpr, { passive: true })
    document.addEventListener('visibilitychange', updatePageVisibility)
    updateMotion()
    updateDesktopPointer()
    updatePageVisibility()
    updateDpr()
    observer = new IntersectionObserver(
      (entries) => {
        // A resize/scroll can queue several entries; the newest one owns visibility.
        for (const entry of entries) {
          if (entry.target === host.value) visible.value = entry.isIntersecting
        }
      },
      { rootMargin: '100px' },
    )
    if (host.value) observer.observe(host.value)
  })
  watch(host, (element, previous) => {
    if (previous) observer?.unobserve(previous)
    if (element) observer?.observe(element)
  })
  onScopeDispose(() => {
    observer?.disconnect()
    media?.removeEventListener('change', updateMotion)
    desktopMedia?.removeEventListener('change', updateDesktopPointer)
    window.removeEventListener('resize', updateDpr)
    document.removeEventListener('visibilitychange', updatePageVisibility)
  })
  const active = computed(() => visible.value && pageVisible.value && supported.value === true)
  const cinematicCapable = computed(
    () =>
      supported.value === true &&
      halfFloatSupported.value &&
      desktopPointer.value &&
      !reducedMotion.value,
  )
  return { supported, active, reducedMotion, pixelRatio, cinematicCapable }
}
