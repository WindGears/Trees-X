import { onScopeDispose } from 'vue'
import { gsap } from 'gsap'

export function useAnimation() {
  const context = gsap.context(() => {})
  function run(callback: () => void) {
    context.add(callback)
  }
  onScopeDispose(() => context.revert())
  return { run }
}
