<script setup lang="ts">
import { useProductDraft } from '@/lib/admin/productDraft'
const draft = useProductDraft()
</script>
<template>
  <section aria-label="高级配置">
    <h2>高级配置 JSON</h2>
    <p class="ad-muted">
      编辑完整配置：模型来源、材质绑定、运动轨道及舞台参数。应用到表单后仍需手动保存；不会自动升级配置版本。
    </p>
    <label for="ad-field-advanced">完整展示配置 JSON</label
    ><textarea
      id="ad-field-advanced"
      v-model="draft.json.value"
      class="ad-code"
      rows="22"
      spellcheck="false"
      :aria-invalid="Boolean(draft.jsonError.value)"
      aria-describedby="advanced-help"
    />
    <p id="advanced-help" class="ad-muted">
      v1/v2/v3沿用已有契约。资源必须同源；旋转轨道单段不超过180°，同一节点的变换通道不能重复占用。
    </p>
    <p v-if="draft.jsonError.value" role="alert" class="ad-error">
      {{ draft.jsonError.value }} 原表单未被覆盖，请修正或放弃输入。
    </p>
    <div class="ad-actions">
      <button type="button" :disabled="!draft.advancedDirty.value" @click="draft.applyJson()">
        应用到表单</button
      ><button type="button" :disabled="!draft.advancedDirty.value" @click="draft.discardJson()">
        放弃 JSON 输入
      </button>
    </div>
    <p role="status" class="ad-muted">
      {{
        draft.advancedDirty.value
          ? 'JSON尚未应用，暂不能保存或预览。'
          : 'JSON与表单一致。应用及表单修改均尚需保存到数据库。'
      }}
    </p>
  </section>
</template>
