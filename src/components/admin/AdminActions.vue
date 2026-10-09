<script setup lang="ts">
import { useProductDraft } from '@/lib/admin/productDraft'
import AdminField from './AdminField.vue'
import AdminNumber from './AdminNumber.vue'
const { presentation: p } = useProductDraft()
</script>
<template>
  <section aria-label="动作配置">
    <h2>动作文字与时长</h2>
    <p class="ad-muted">
      保持已验证的节点和运动轨道。新增或修改动作绑定请使用高级配置，并检查预览。
    </p>
    <p v-if="!p.actions.length" class="ad-empty">此商品尚未配置动作。</p>
    <article v-for="action in p.actions" :key="action.id" class="ad-entry">
      <h3>
        {{ action.label || '未命名动作' }} <small>{{ action.id }}</small>
      </h3>
      <div class="ad-fields">
        <AdminField v-model="action.label" label="动作名称" :path="`actions.${action.id}.label`" />
        <template v-if="action.motion"
          ><AdminNumber
            v-model="action.motion.duration"
            label="完整行程（秒）"
            :path="`actions.${action.id}.duration`"
            section="actions"
            :min="0" /><AdminField
            v-model="action.motion.openLabel"
            label="展开文字"
            :path="`actions.${action.id}.openLabel`" /><AdminField
            v-model="action.motion.closeLabel"
            label="合拢文字"
            :path="`actions.${action.id}.closeLabel`"
        /></template>
      </div>
      <p class="ad-muted">
        {{
          action.kind === 'progress'
            ? '进度动作'
            : action.kind === 'pulse'
              ? '单次动作'
              : '开关动作'
        }}
        · 绑定 {{ action.node
        }}<span v-if="action.motion?.tracks"> · {{ action.motion.tracks.length }}条运动轨道</span>
        <span v-else-if="action.motion?.program"> · 已注册的多阶段展示</span>
      </p>
    </article>
  </section>
</template>
