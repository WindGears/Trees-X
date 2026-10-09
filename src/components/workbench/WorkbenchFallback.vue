<script setup lang="ts">
import { ref, watch } from 'vue'
import { useWorkbenchStore } from '@/stores/workbench'
const store = useWorkbenchStore()
const coverFailed = ref(false)
watch(
  () => store.product?.cover,
  () => {
    coverFailed.value = false
  },
)
</script>

<template>
  <div v-if="store.product" class="wb-content-fallback">
    <div class="wb-fallback-product">
      <h1 id="wb-product-title">{{ store.product.name }}</h1>
      <p>{{ store.product.description }}</p>
      <span class="wb-sample-label">{{
        store.product.displayStatus === 'formal' ? '正式展品' : '流程样板'
      }}</span>
    </div>
    <img
      v-if="store.product.cover && !coverFailed"
      class="wb-fallback-cover"
      :src="store.product.cover"
      :alt="`${store.product.name}的商品封面`"
      @error="coverFailed = true"
    />
    <p v-else class="wb-fallback-missing">暂无可用封面，仍可阅读下方商品说明。</p>
    <section class="wb-fallback-note" aria-labelledby="wb-compatibility-title">
      <h2 id="wb-compatibility-title">当前显示商品图文</h2>
      <p>
        {{ store.compatibilityReason }} 三维观察需要支持 WebGL 2
        的浏览器与显卡。可尝试启用浏览器硬件加速后重新打开页面。
      </p>
      <button type="button" @click="store.openPanel('catalog')">浏览其他商品</button>
    </section>
    <section
      v-if="store.presentation?.hotspots.length"
      class="wb-fallback-details"
      aria-label="商品观察内容"
    >
      <h2>可以了解什么</h2>
      <dl>
        <template
          v-for="part in store.presentation.hotspots.filter((part) => part.marker !== false)"
          :key="part.id"
        >
          <dt>{{ part.name }}</dt>
          <dd>{{ part.description }}</dd>
        </template>
      </dl>
    </section>
  </div>
</template>
