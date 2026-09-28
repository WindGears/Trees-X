<script setup lang="ts">
import { inject, onScopeDispose, useTemplateRef } from 'vue'
import { gestureKey } from '@/lib/gesture/bridge'

const props = defineProps<{
  id: string
  label: string
  disabled?: boolean
  pressed?: boolean
  compact?: boolean
}>()
const emit = defineEmits<{ activate: [] }>()
const bridge = inject(gestureKey)!
const button = useTemplateRef('button')
const unregister = bridge.targets.register(props.id, () => {
  const element = button.value
  const rect = element?.getBoundingClientRect()
  const host = element?.closest('.canvas-host')?.getBoundingClientRect()
  return {
    id: props.id,
    label: props.label,
    priority: 10,
    x: rect && host?.width ? (rect.left + rect.width / 2 - host.left) / host.width : 0,
    y: rect && host?.height ? (rect.top + rect.height / 2 - host.top) / host.height : 0,
    halfWidth: (rect?.width ?? 0) / 2,
    halfHeight: (rect?.height ?? 0) / 2,
    visible: Boolean(
      rect?.width &&
      host?.width &&
      !props.disabled &&
      bridge.sceneActive.value &&
      bridge.owner.value !== 'animation',
    ),
    activate: () => emit('activate'),
  }
})
function manual() {
  bridge.takeMouse()
  emit('activate')
}
onScopeDispose(unregister)
</script>

<template>
  <button
    ref="button"
    class="gesture-target-button"
    :class="{ 'is-aimed': bridge.candidateId.value === id, 'is-compact': compact }"
    :data-gesture-target="id"
    :aria-label="`手势：${label}`"
    :aria-pressed="pressed"
    :disabled="disabled"
    @click.stop="manual"
  >
    <slot>{{ label }}</slot>
  </button>
</template>
