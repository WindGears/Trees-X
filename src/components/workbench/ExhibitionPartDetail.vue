<script setup lang="ts">
import { ArrowUpRight, X } from '@lucide/vue'
import { useWorkbenchStore } from '@/stores/workbench'
import type { Hotspot } from '@/lib/workbench/types'
import '@/assets/styles/exhibition-controls.css'

const props = defineProps<{ part?: Hotspot; currentView: string; requiresExpansion?: boolean }>()
const emit = defineEmits<{ dismiss: []; reveal: [id: string] }>()
const store = useWorkbenchStore()

function returnToChapter() {
  store.view(props.currentView)
  emit('dismiss')
}
</script>

<template>
  <aside v-if="part" class="exhibit-part-detail" aria-labelledby="exhibit-part-heading">
    <header>
      <h2 id="exhibit-part-heading">{{ part.name }}</h2>
      <button
        type="button"
        class="exhibit-part-close"
        aria-label="关闭部件详情"
        @click="emit('dismiss')"
      >
        <X :size="18" aria-hidden="true" />
      </button>
    </header>
    <p>{{ part.description }}</p>
    <div class="exhibit-part-actions">
      <button
        v-if="requiresExpansion"
        type="button"
        class="exhibit-control-primary"
        @click="emit('reveal', part.id)"
      >
        展开后查看 <ArrowUpRight :size="16" aria-hidden="true" />
      </button>
      <button v-else type="button" @click="returnToChapter">回到本段</button>
    </div>
  </aside>
</template>
