<script setup lang="ts">
import { inject, onScopeDispose, useTemplateRef } from 'vue'
import { Hand } from '@lucide/vue'
import { gestureKey } from '@/lib/gesture/bridge'

defineProps<{ active: boolean }>()
const bridge = inject(gestureKey)!
const { motionPhase, owner, mode, sessionRunning } = bridge
const display = useTemplateRef('display')
const speed = useTemplateRef('speed')
const labels = {
  idle: '张开手掌，开始观察',
  arming: '接回控制',
  tracking: '已连接',
  braking: '正在停稳',
  coasting: '惯性滑行',
  missing: '将手移回取景框',
}
onScopeDispose(
  bridge.observeMotion((velocity, angle) => {
    // The camera controller supplies its actual orbit angle for the visible diagnostic.
    if (display.value) {
      display.value.dataset.cameraAngle = String(angle)
      display.value.dataset.angularVelocity = String(velocity)
    }
    if (speed.value)
      speed.value.style.transform = `scaleX(${Math.min(1, Math.abs(velocity) / 1.5)})`
  }),
)
</script>

<template>
  <div
    v-if="active && sessionRunning && mode === 'rotate'"
    ref="display"
    class="gesture-motion-status"
    :data-motion-phase="motionPhase"
    :data-input-owner="owner"
    aria-live="polite"
  >
    <Hand :size="15" aria-hidden="true" />
    <span>{{
      owner === 'gesture'
        ? `观察 · ${labels[motionPhase]}`
        : owner === 'animation'
          ? '镜头移动中'
          : '鼠标已接管 · 可在控制台恢复手势'
    }}</span>
    <i v-if="owner === 'gesture'" class="gesture-speed-track" aria-hidden="true"
      ><i ref="speed"></i
    ></i>
  </div>
</template>
