<script setup lang="ts">
import { inject } from 'vue'
import { Play, Square } from '@lucide/vue'
import { gestureKey } from '@/lib/gesture/bridge'
import { useProductStore } from '@/stores/product'
import { usePreferredReducedMotion } from '@vueuse/core'
const bridge = inject(gestureKey)!
const store = useProductStore()
const reduced = usePreferredReducedMotion()
</script>
<template>
  <div class="product-film">
    <button
      class="film-action"
      type="button"
      :disabled="store.status !== 'ready'"
      :aria-pressed="bridge.filmPlaying.value"
      @click="bridge.filmPlaying.value ? bridge.takeMouse() : bridge.playFilm()"
    >
      <Square v-if="bridge.filmPlaying.value" :size="14" /><Play v-else :size="15" />
      {{ bridge.filmPlaying.value ? '接手探索' : reduced === 'reduce' ? '静态欣赏' : '观看演绎' }}
      <span v-if="!bridge.filmPlaying.value && reduced !== 'reduce'">8 秒</span>
    </button>
    <p class="film-help" role="status">
      {{
        bridge.filmPlaying.value
          ? '拖动或按 Esc，随时接手。'
          : bridge.filmPhase.value === 'complete'
            ? '轮到你了。转动它，继续发现。'
            : '旋钮特写 / 完整轮廓 / 外观分层'
      }}
    </p>
  </div>
</template>
