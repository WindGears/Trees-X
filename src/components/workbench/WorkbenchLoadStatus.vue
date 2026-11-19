<script setup lang="ts">
import { computed, onScopeDispose } from 'vue'
import { phaseLabels } from '@/lib/workbench/assetBundle'
import { createInterfaceMotion } from '@/lib/workbench/interfaceMotion'
import {
  exhibitionHome,
  isLocalLink,
  type ExhibitionOverviewItem,
} from '@/lib/workbench/exhibition'
import { useWorkbenchStore } from '@/stores/workbench'

const props = defineProps<{
  preview?: boolean
  exhibition?: boolean
  exhibit?: ExhibitionOverviewItem
}>()
const emit = defineEmits<{ overview: [] }>()
const store = useWorkbenchStore()
const motion = createInterfaceMotion()
const shown = computed(() => store.status === 'loading' || store.status === 'error')
const failed = computed(() => store.status === 'error')
const title = computed(() => store.product?.name || props.exhibit?.name)

function back(event: MouseEvent) {
  if (!isLocalLink(event)) return
  event.preventDefault()
  emit('overview')
}

onScopeDispose(motion.dispose)
</script>

<template>
  <Transition
    :css="false"
    :on-leave="exhibition ? motion.leave : undefined"
    @leave-cancelled="motion.cancel"
  >
    <div
      v-if="shown"
      class="wb-stage-status"
      :class="{ 'wb-stage-status--poster': exhibition }"
      :role="failed ? 'alert' : 'status'"
    >
      <img
        v-if="exhibition && exhibit?.cover"
        :key="exhibit.slug"
        :src="exhibit.cover"
        class="wb-transition-cover"
        alt=""
      />
      <div class="wb-stage-status-copy">
        <h2>{{ exhibition && title ? title : failed ? '暂时无法展示' : '正在准备商品' }}</h2>
        <p>{{ failed ? store.error : phaseLabels[store.loadPhase] }}</p>
        <p v-if="exhibition && failed && exhibit">{{ exhibit.description }}</p>
        <div v-if="failed" class="wb-inline-actions">
          <button type="button" @click="store.retry()">重新加载</button>
          <a v-if="exhibition" :href="exhibitionHome" @click="back">返回展厅</a>
          <button v-else-if="!preview" type="button" @click="store.panel = 'catalog'">
            打开目录
          </button>
        </div>
      </div>
    </div>
  </Transition>
</template>
