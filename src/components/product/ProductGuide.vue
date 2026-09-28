<script setup lang="ts">
import { inject } from 'vue'
import { ArrowLeft, ArrowRight, ScanSearch } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { gestureKey } from '@/lib/gesture/bridge'
import { useProductStore } from '@/stores/product'
defineProps<{ available: boolean }>()
const store = useProductStore()
const bridge = inject(gestureKey)!
function guide(step: number) {
  bridge.takeMouse()
  store.goToGuideStep(step)
  bridge.selected.value = Boolean(store.storySteps[step]?.partId)
}
</script>
<template>
  <section class="console-section console-guide" aria-labelledby="guide-heading">
    <div class="console-section__heading">
      <h3 id="guide-heading">跟着看一看</h3>
      <span>{{ store.guideLength }} 个观察角度</span>
    </div>
    <template v-if="store.guideStep === null">
      <p>从轮廓走到细节，发现这件商品值得停留的地方。</p>
      <Button variant="outline" :disabled="!available" @click="guide(0)"
        ><ScanSearch :size="16" /> 开始导览</Button
      >
    </template>
    <template v-else>
      <div class="guide-progress" aria-hidden="true">
        <span
          v-for="index in store.guideLength"
          :key="index"
          :class="{ active: index <= store.guideStep + 1 }"
        ></span>
      </div>
      <div class="guide-copy" role="status">
        <strong
          >{{ store.guideStep + 1 }} / {{ store.guideLength }} ·
          {{ store.storySteps[store.guideStep]?.title }}</strong
        >
        <p>{{ store.storySteps[store.guideStep]?.description }}</p>
      </div>
      <div class="guide-actions">
        <Button
          variant="ghost"
          :disabled="!available || store.guideStep === 0"
          @click="guide(store.guideStep - 1)"
          ><ArrowLeft :size="14" /> 上一步</Button
        >
        <Button
          v-if="store.guideStep < store.guideLength - 1"
          variant="outline"
          :disabled="!available"
          @click="guide(store.guideStep + 1)"
          >下一步 <ArrowRight :size="14"
        /></Button>
        <Button v-else variant="outline" @click="store.guideStep = null">完成导览</Button>
        <Button variant="ghost" @click="store.guideStep = null">退出导览</Button>
      </div>
    </template>
  </section>
</template>
