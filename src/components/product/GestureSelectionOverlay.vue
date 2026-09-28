<script setup lang="ts">
import { computed, inject } from 'vue'
import { Check, LockKeyhole, Plus } from '@lucide/vue'
import { gestureKey } from '@/lib/gesture/bridge'
import { useProductStore } from '@/stores/product'
import GesturePalette from './GesturePalette.vue'

defineProps<{ available: boolean }>()
const bridge = inject(gestureKey)!
const store = useProductStore()
const {
  hotspot,
  pointer,
  hovered,
  phase,
  projectedParts,
  candidateId,
  candidateLabel,
  pinchProgress,
} = bridge
const selecting = computed(() => bridge.sessionRunning.value && bridge.mode.value === 'select')
const parts = computed(() =>
  selecting.value
    ? projectedParts.value
    : [
        {
          ...hotspot.value,
          id: `part:${store.activePartId}`,
          partId: store.activePartId,
          label: store.activePart?.name ?? '部件',
        },
      ],
)
function select(id: string) {
  bridge.takeMouse()
  store.activePartId = id
  bridge.showPart()
}
</script>

<template>
  <template v-if="available && !bridge.filmPlaying.value">
    <template v-for="part in parts" :key="part.id">
      <button
        v-if="part.visible"
        class="model-hotspot"
        :class="{
          'is-quiet': store.product.id === 'form-01' && !selecting && !bridge.selected.value,
          'is-hovered': selecting && hovered && candidateId === part.id,
          'is-locked': candidateId === part.id && phase === 'locked',
        }"
        :data-gesture-target="part.id"
        :style="{ left: `${part.x * 100}%`, top: `${part.y * 100}%` }"
        :aria-label="`查看${part.label}`"
        :aria-pressed="bridge.selected.value && store.activePartId === part.partId"
        @click="select(part.partId)"
      >
        <Check
          v-if="candidateId === part.id && phase === 'confirmed'"
          :size="18"
          aria-hidden="true"
        />
        <LockKeyhole
          v-else-if="candidateId === part.id && phase === 'locked'"
          :size="18"
          aria-hidden="true"
        />
        <Plus v-else :size="18" aria-hidden="true" />
        <span class="hotspot-label">{{ part.label }}</span>
      </button>
    </template>
    <GesturePalette v-if="selecting" />
    <div
      v-if="selecting && pointer && bridge.owner.value === 'gesture'"
      class="gesture-selection-cursor"
      :class="{ 'is-captured': hovered, 'is-confirmed': phase === 'confirmed' }"
      :style="{ left: `${pointer.x * 100}%`, top: `${pointer.y * 100}%` }"
      aria-hidden="true"
    >
      <svg viewBox="0 0 48 48">
        <circle cx="24" cy="24" r="20" class="cursor-track" />
        <circle
          cx="24"
          cy="24"
          r="20"
          class="cursor-progress"
          pathLength="1"
          :stroke-dasharray="`${pinchProgress} 1`"
        />
      </svg>
      <Check v-if="phase === 'confirmed'" :size="16" /><span v-else class="cursor-center"></span>
      <span v-if="hovered" class="gesture-target-caption"
        >{{ candidateLabel
        }}<small>{{
          phase === 'confirmed'
            ? '已确认'
            : bridge.confirmation.value === 'dwell'
              ? '保持片刻'
              : pinchProgress < 1
                ? '捏合确认'
                : '松开确认'
        }}</small></span
      >
    </div>
  </template>
</template>
