<script setup lang="ts">
import { computed } from 'vue'
import { Check, RotateCcw } from '@lucide/vue'
import { useWorkbenchStore } from '@/stores/workbench'
import { progressActions } from '@/lib/workbench/motionConfig'
import WorkbenchProgress from './WorkbenchProgress.vue'
import WorkbenchParts from './WorkbenchParts.vue'
import WorkbenchLayoutMotion from './WorkbenchLayoutMotion.vue'
import WorkbenchPianoMotion from './WorkbenchPianoMotion.vue'
import '@/assets/styles/workbench-parts.css'
const store = useWorkbenchStore()
const step = computed(() => store.presentation?.guide[store.guideStep])
const motions = computed(() => (store.presentation ? progressActions(store.presentation) : []))
const discrete = computed(
  () => store.presentation?.actions.filter((a) => a.kind !== 'progress') ?? [],
)
</script>
<template>
  <div v-if="store.presentation" class="wb-panel-content">
    <template v-if="store.panel === 'appearance'">
      <h3>选择外壳颜色</h3>
      <p>旋转商品，观察同一表面在不同角度的变化。</p>
      <div class="wb-finishes">
        <button
          v-for="finish in store.presentation.finishes"
          :key="finish.id"
          type="button"
          :disabled="!store.available"
          :aria-pressed="store.finishId === finish.id"
          @click="store.finish(finish.id)"
        >
          <span class="wb-swatch" :style="{ background: finish.color }"></span>{{ finish.name }}
          <Check v-if="store.finishId === finish.id" :size="16" />
        </button>
      </div>
      <p class="wb-note">展示配色用于观察材质，不代表真实可购款式。</p>
    </template>
    <template v-else-if="store.panel === 'details'">
      <WorkbenchParts />
    </template>
    <template v-else-if="store.panel === 'actions'">
      <h3>看看它如何变化</h3>
      <p>旋转、缩放或选择部件会暂停结构播放，保留当前变化。</p>
      <div class="wb-action-list">
        <button
          v-for="action in discrete"
          :key="action.id"
          type="button"
          :disabled="!store.available"
          :aria-pressed="action.kind === 'toggle' ? Boolean(store.actions[action.id]) : undefined"
          @click="store.action(action.id)"
        >
          {{ action.label
          }}<span v-if="action.kind === 'toggle'">{{
            store.actions[action.id] ? '已开启' : '未开启'
          }}</span>
        </button>
        <template v-for="action in motions" :key="action.id">
          <WorkbenchPianoMotion
            v-if="action.motion.program?.type === 'piano-sound-path-v1'"
            :action="action"
          />
          <WorkbenchLayoutMotion v-else-if="action.motion.program" :action="action" />
          <WorkbenchProgress v-else :action="action" />
        </template>
        <button
          v-if="store.presentation.structure && !store.presentation.structureActionId"
          type="button"
          :disabled="!store.available"
          :aria-pressed="store.exploded"
          @click="store.structure(!store.exploded)"
        >
          {{ store.exploded ? '合拢部件' : '展开部件' }}
        </button>
      </div>
      <p class="wb-note">分层只演示现有部件关系，不表示真实维修拆解顺序。</p>
    </template>
    <template v-else-if="store.panel === 'guide'">
      <h3>从整体，走到细节</h3>
      <p v-if="!step">
        按自己的节奏看完
        {{ store.presentation.guide.length }} 个观察点。任何时候拖动或缩放，都可以回到自由观察。
      </p>
      <button v-if="!step" type="button" :disabled="!store.available" @click="store.guide(0)">
        开始导览
      </button>
      <template v-else>
        <p class="wb-guide-count">
          {{ store.guideStep + 1 }} / {{ store.presentation.guide.length }}
        </p>
        <h3>{{ step.title }}</h3>
        <p role="status">{{ step.description }}</p>
        <div class="wb-inline-actions">
          <button
            type="button"
            :disabled="store.guideStep === 0 || !store.available"
            @click="store.guide(store.guideStep - 1)"
          >
            上一步
          </button>
          <button
            v-if="store.guideStep < store.presentation.guide.length - 1"
            type="button"
            :disabled="!store.available"
            @click="store.guide(store.guideStep + 1)"
          >
            下一步
          </button>
          <button v-else type="button" @click="store.manual()">完成导览</button>
        </div>
        <button type="button" class="wb-text-button" @click="store.manual()">
          退出导览，保留当前观察
        </button>
      </template>
    </template>
    <div class="wb-panel-reset">
      <button type="button" :disabled="!store.available" @click="store.restore()">
        <RotateCcw :size="16" />还原商品</button
      ><small>恢复默认配色、动作、结构与镜头。</small>
    </div>
  </div>
</template>
