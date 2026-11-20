<script setup lang="ts">
import { Ellipsis } from '@lucide/vue'
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuRoot,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from 'reka-ui'

defineProps<{ busy: boolean; dirty: boolean; listed: boolean }>()
const emit = defineEmits<{ visibility: []; reload: [] }>()
</script>

<template>
  <DropdownMenuRoot :modal="false">
    <DropdownMenuTrigger type="button" class="ad-more" aria-label="更多操作">
      <Ellipsis :size="20" aria-hidden="true" />
    </DropdownMenuTrigger>
    <DropdownMenuPortal to=".tx-admin">
      <DropdownMenuContent class="ad-menu" align="end" :side-offset="8" :collision-padding="12">
        <DropdownMenuItem
          class="ad-menu-item"
          :aria-label="listed ? '下架商品' : '上架商品'"
          aria-describedby="ad-menu-visibility-description"
          :disabled="busy || dirty"
          @select="emit('visibility')"
        >
          <span>{{ listed ? '下架商品' : '上架商品' }}</span>
          <small id="ad-menu-visibility-description">
            {{
              dirty
                ? '先保存修改，再调整上架状态。'
                : listed
                  ? '从展厅目录移除，并停用访客商品链接。'
                  : '将已保存的配置展示在展厅目录。'
            }}
          </small>
        </DropdownMenuItem>
        <DropdownMenuSeparator class="ad-menu-divider" />
        <DropdownMenuItem
          class="ad-menu-item"
          aria-label="重新读取"
          aria-describedby="ad-menu-reload-description"
          :disabled="busy"
          @select="emit('reload')"
        >
          <span>重新读取</span>
          <small id="ad-menu-reload-description">读取最新配置。有未保存修改时会先询问。</small>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenuPortal>
  </DropdownMenuRoot>
</template>
