<script setup lang="ts">
import { Check, ChevronDown } from '@lucide/vue'
import {
  DropdownMenuContent,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuRoot,
  DropdownMenuTrigger,
} from 'reka-ui'
import type { exhibitMotionSteps } from '@/lib/workbench/exhibitionMotion'

defineProps<{ steps: ReturnType<typeof exhibitMotionSteps>; selected: number }>()
const emit = defineEmits<{ select: [index: number] }>()
</script>

<template>
  <DropdownMenuRoot :modal="false">
    <DropdownMenuTrigger
      >全部章节 <ChevronDown :size="15" aria-hidden="true"
    /></DropdownMenuTrigger>
    <DropdownMenuPortal>
      <DropdownMenuContent
        class="exhibit-chapter-menu"
        side="top"
        align="end"
        :side-offset="12"
        :collision-padding="16"
        aria-label="钢琴结构章节"
      >
        <DropdownMenuRadioGroup :model-value="String(selected)">
          <DropdownMenuRadioItem
            v-for="(step, index) in steps"
            :key="step.value"
            :value="String(index)"
            class="exhibit-chapter-item"
            @select="emit('select', index)"
          >
            <span aria-hidden="true">{{ index + 1 }}</span>
            {{ step.label }}
            <Check v-if="index === selected" :size="15" aria-hidden="true" />
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenuPortal>
  </DropdownMenuRoot>
</template>
