<script setup lang="ts">
import { ArrowLeft, Check, ChevronDown } from '@lucide/vue'
import {
  DropdownMenuContent,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuRoot,
  DropdownMenuTrigger,
} from 'reka-ui'
import {
  exhibitionHome,
  isLocalLink,
  type ExhibitionOverviewItem,
} from '@/lib/workbench/exhibition'
import '@/assets/styles/workbench-exhibition.css'

defineProps<{
  exhibits: readonly ExhibitionOverviewItem[]
  slug: string
  name?: string
}>()
const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ overview: []; select: [slug: string] }>()

function back(event: MouseEvent) {
  if (!isLocalLink(event)) return
  event.preventDefault()
  emit('overview')
}
</script>

<template>
  <header class="wb-header wb-exhibition-header">
    <div class="wb-exhibition-home">
      <a class="wb-brand" :href="exhibitionHome" @click="back">Trees X</a>
      <a class="wb-exhibition-back" :href="exhibitionHome" @click="back">
        <ArrowLeft :size="16" aria-hidden="true" />展厅总览
      </a>
    </div>
    <h1 class="wb-exhibition-title">{{ name ?? '展品' }}</h1>
    <DropdownMenuRoot v-if="exhibits.length" v-model:open="open" :modal="false">
      <DropdownMenuTrigger class="wb-exhibition-switch">
        切换展品 <ChevronDown :size="15" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuPortal>
        <DropdownMenuContent
          class="wb-exhibit-menu"
          align="end"
          :side-offset="8"
          :collision-padding="12"
        >
          <DropdownMenuRadioGroup :model-value="slug">
            <DropdownMenuRadioItem
              v-for="exhibit in exhibits"
              :key="exhibit.slug"
              :value="exhibit.slug"
              class="wb-exhibit-menu-item"
              @select="emit('select', exhibit.slug)"
            >
              {{ exhibit.name }}
              <Check v-if="exhibit.slug === slug" :size="16" aria-hidden="true" />
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenuPortal>
    </DropdownMenuRoot>
  </header>
</template>
