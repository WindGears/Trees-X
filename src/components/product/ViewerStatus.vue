<script setup lang="ts">
import { RotateCcw } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { useProductStore } from '@/stores/product'
defineProps<{ supported: boolean | null; error: string; available: boolean }>()
defineEmits<{ retry: [] }>()
const store = useProductStore()
</script>

<template>
  <div v-if="supported === false" class="scene-message" role="status">
    <h3>换个窗口，继续探索。</h3>
    <p>当前浏览器未能开启三维画面。请启用硬件加速，或使用支持 WebGL 2 的浏览器。</p>
    <Button variant="outline" @click="store.catalogOpen = true">浏览商品目录</Button>
  </div>
  <div v-else-if="error" class="scene-message" role="alert">
    <h3>暂时没有遇见它。</h3>
    <p>{{ error }}</p>
    <Button variant="outline" @click="$emit('retry')"
      ><RotateCcw :size="15" aria-hidden="true" />重新加载</Button
    >
    <Button variant="ghost" @click="store.catalogOpen = true">返回目录</Button>
  </div>
  <div v-else-if="!available" class="scene-message" role="status">
    <img
      v-if="store.product.coverUrl"
      class="loading-cover"
      :src="store.product.coverUrl"
      :alt="store.product.label"
    />
    <span class="loading-mark" aria-hidden="true"></span>
    <p>正在准备你的观察视角…</p>
  </div>
</template>
