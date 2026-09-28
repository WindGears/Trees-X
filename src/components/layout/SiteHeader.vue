<script setup lang="ts">
import { computed } from 'vue'
import { collection } from '@/data/collection'
import { useProductStore } from '@/stores/product'
const store = useProductStore()
const count = computed(() => String(collection.length).padStart(2, '0'))
const isStudy = computed(() => store.product.experience === 'study')
</script>
<template>
  <header class="site-header page-width">
    <a class="wordmark" href="#showcase" aria-label="Trees X 首页">
      <svg viewBox="0 0 28 28" aria-hidden="true"><path d="m6 5 16 18M22 5 6 23" /></svg>
      <span>TREES <span class="wordmark-slash">/</span> X</span>
    </a>
    <p class="header-object">物件之间，发现更多。</p>
    <nav aria-label="主导航">
      <button type="button" class="header-catalog" @click="store.catalogOpen = true">
        商品目录 <span>{{ count }}</span>
      </button>
      <button
        v-if="!isStudy"
        type="button"
        :aria-pressed="store.panel === 'console'"
        @click="store.openPanel(store.panel === 'console' ? null : 'console')"
      >
        完整控制台
      </button>
      <button
        v-if="store.cameraStatus === 'running' || store.cameraStatus === 'starting'"
        type="button"
        class="camera-live"
        @click="store.cameraStopRequest++"
      >
        <span aria-hidden="true"></span
        >{{ store.cameraStatus === 'starting' ? '取消开启摄像头' : '摄像头已开启 · 关闭' }}
      </button>
      <button v-else-if="!isStudy" type="button" @click="store.openPanel('info')">作品信息</button>
    </nav>
  </header>
</template>
