<script setup lang="ts">
import { X } from '@lucide/vue'
import {
  DialogRoot,
  DialogPortal,
  DialogOverlay,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from 'reka-ui'
defineProps<{ open: boolean }>()
const emit = defineEmits<{ 'update:open': [value: boolean] }>()
</script>
<template>
  <DialogRoot :open="open" @update:open="emit('update:open', $event)">
    <DialogPortal
      ><DialogOverlay class="museum-dialog-shade" /><DialogContent
        class="museum-help museum-popover"
      >
        <header>
          <DialogTitle>亲手观察机械</DialogTitle
          ><DialogClose class="museum-icon" aria-label="关闭帮助"><X :size="18" /></DialogClose>
        </header>
        <DialogDescription>先自由观察，再选择一个章节，看看部件如何运动。</DialogDescription>
        <dl>
          <div>
            <dt>旋转与缩放</dt>
            <dd>左键拖动 · 滚轮缩放</dd>
          </div>
          <div>
            <dt>结构探索</dt>
            <dd>底部选择章节，运动时可暂停；拖动模型立即接管。</dd>
          </div>
          <div>
            <dt>查看部件</dt>
            <dd>点击引线标签，或在“部件”中搜索。</dd>
          </div>
          <div>
            <dt>键盘操作</dt>
            <dd>
              Tab 切换控件，Enter 确认，Esc 收起浮层。舞台获得焦点后，方向键旋转，＋／－缩放，Home
              复位视角。
            </dd>
          </div>
        </dl>
      </DialogContent></DialogPortal
    >
  </DialogRoot>
</template>
