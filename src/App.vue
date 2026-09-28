<script setup lang="ts">
import SiteHeader from '@/components/layout/SiteHeader.vue'
import ProductShowcase from '@/components/product/ProductShowcase.vue'
import { useSmoothScroll } from '@/composables/useSmoothScroll'

useSmoothScroll()
</script>

<template>
  <a class="skip-link" href="#main">跳转到内容</a>
  <SiteHeader />
  <main id="main">
    <ProductShowcase />
  </main>
</template>
