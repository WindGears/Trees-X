import { inject, provide, shallowRef, watch, type InjectionKey } from 'vue'
import type { MotionStatus } from './types'
import type { useWorkbenchStore } from '@/stores/workbench'

function createSession(store: ReturnType<typeof useWorkbenchStore>) {
  const states = shallowRef<Record<string, MotionStatus>>({})
  watch(
    () => store.revision,
    () => {
      states.value = {}
    },
    { flush: 'sync' },
  )
  return {
    states,
    snapshot: () => states.value,
    report(slug: string, revision: number, id: string, status: MotionStatus) {
      if (store.slug === slug && store.revision === revision)
        states.value = { ...states.value, [id]: status }
    },
  }
}
const key: InjectionKey<ReturnType<typeof createSession>> = Symbol('workbench-motion')
export function provideMotionSession(store: ReturnType<typeof useWorkbenchStore>) {
  provide(key, createSession(store))
}
export function useMotionSession() {
  const session = inject(key)
  if (!session) throw new Error('进度控制需要工作台会话')
  return session
}
