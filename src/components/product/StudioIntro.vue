<script setup lang="ts">
import { ArrowUpRight } from '@lucide/vue'
import { useProductStore } from '@/stores/product'
import ProductSwitcher from './ProductSwitcher.vue'
import ProductFilm from './ProductFilm.vue'
import { computed, inject } from 'vue'
import { gestureKey } from '@/lib/gesture/bridge'
import { filmFor } from '@/data/productFilms'

const store = useProductStore()
const bridge = inject(gestureKey)!
const film = computed(() => filmFor(store.product.id))
const shot = computed(() =>
  bridge.filmPlaying.value
    ? film.value?.find((item) => item.chapter === bridge.filmPhase.value)
    : undefined,
)
</script>

<template>
  <div class="studio-intro">
    <h1 id="showcase-heading" tabindex="-1">
      {{ shot?.title ?? store.product.label ?? '桌面音箱' }}
    </h1>
    <p class="studio-intro__index">
      {{ store.product.name }} <span>·</span> {{ store.product.collection }}
    </p>
    <p class="studio-intro__description">{{ shot?.description ?? store.product.description }}</p>
    <ProductFilm v-if="film" />
    <button class="studio-intro__action" type="button" @click="store.openPanel('details')">
      探索细节 <ArrowUpRight :size="18" aria-hidden="true" />
    </button>
    <ProductSwitcher />
  </div>
</template>
