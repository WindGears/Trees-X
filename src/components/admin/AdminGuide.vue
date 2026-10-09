<script setup lang="ts">
import { computed } from 'vue'
import { useProductDraft } from '@/lib/admin/productDraft'
import { copy, nextId, moveItem } from '@/lib/admin/editor'
import type { GuideStep } from '@/lib/workbench/types'
import AdminField from './AdminField.vue'
import AdminNumber from './AdminNumber.vue'
import AdminRowTools from './AdminRowTools.vue'
import AdminReference from './AdminReference.vue'
const { presentation: p } = useProductDraft()
const progressActions = computed(() => p.value.actions.filter((a) => a.kind === 'progress'))
function add(index?: number) {
  const base = index === undefined ? { title: '', description: '' } : copy(p.value.guide[index]!)
  p.value.guide.push({ ...base, id: nextId(p.value.guide, 'step') })
}
function progress(step: GuideStep, enabled: boolean) {
  if (enabled && progressActions.value[0])
    step.progress = { actionId: progressActions.value[0].id, value: 0 }
  else delete step.progress
}
function reference(step: GuideStep, key: 'view' | 'hotspotId' | 'actionId', value: string) {
  if (value) step[key] = value
  else delete step[key]
}
function structure(step: GuideStep, value: string) {
  if (value === '') delete step.explode
  else step.explode = value === 'true'
}
</script>
<template>
  <section aria-label="导览配置">
    <header class="ad-section-title">
      <div>
        <h2>导览步骤</h2>
        <p class="ad-muted">每一步说明一个观察重点。引用内容来自当前商品配置。</p>
      </div>
      <button type="button" @click="add()">新增步骤</button>
    </header>
    <p v-if="!p.guide.length" class="ad-empty">没有导览步骤，访客仍可自由观察。</p>
    <article v-for="(step, index) in p.guide" :key="step.id" class="ad-entry">
      <h3>
        第{{ index + 1 }}步 · {{ step.title || '未命名步骤' }} <small>{{ step.id }}</small>
      </h3>
      <div class="ad-fields">
        <AdminField
          v-model="step.title"
          label="导览标题"
          :path="`guide.${step.id}.title`"
        /><AdminField
          v-model="step.description"
          label="导览说明"
          :path="`guide.${step.id}.description`"
          multiline
          class="ad-wide"
        />
      </div>
      <label class="ad-checkbox"
        ><input v-model="step.overview" type="checkbox" />此步返回全景</label
      >
      <p v-if="step.overview" class="ad-muted">
        返回全景会合拢动作并恢复全景镜头。下方执行项暂不参与，已填内容仍保留。
      </p>
      <fieldset :disabled="step.overview" class="ad-fields ad-guide-bindings">
        <AdminReference
          :model-value="step.view ?? ''"
          label="观察视角"
          :path="`guide.${step.id}.view`"
          :options="p.views.map((v) => ({ value: v.id, label: v.label }))"
          empty-label="不指定"
          @update:model-value="reference(step, 'view', $event)"
        />
        <AdminReference
          :model-value="step.hotspotId ?? ''"
          label="聚焦部件"
          :path="`guide.${step.id}.hotspotId`"
          :options="p.hotspots.map((v) => ({ value: v.id, label: v.name }))"
          empty-label="不指定"
          @update:model-value="reference(step, 'hotspotId', $event)"
        />
        <AdminReference
          :model-value="step.actionId ?? ''"
          label="执行动作"
          :path="`guide.${step.id}.actionId`"
          :options="p.actions.map((v) => ({ value: v.id, label: v.label }))"
          empty-label="不执行"
          @update:model-value="reference(step, 'actionId', $event)"
        />
        <label v-if="p.structure"
          >结构状态<select
            aria-label="结构状态"
            :value="step.explode == null ? '' : String(step.explode)"
            @change="structure(step, ($event.target as HTMLSelectElement).value)"
          >
            <option value="">保持当前</option>
            <option value="true">展开</option>
            <option value="false">合拢</option>
          </select></label
        >
        <div v-if="p.version === 3" class="ad-wide">
          <label class="ad-checkbox"
            ><input
              type="checkbox"
              :checked="Boolean(step.progress)"
              :disabled="!progressActions.length || step.overview"
              @change="progress(step, ($event.target as HTMLInputElement).checked)"
            />指定停留进度</label
          >
          <div v-if="step.progress" class="ad-fields">
            <AdminReference
              v-model="step.progress.actionId"
              label="停留动作"
              :path="`guide.${step.id}.progressAction`"
              :options="progressActions.map((v) => ({ value: v.id, label: v.label }))"
            /><AdminNumber
              :model-value="step.progress.value * 100"
              label="停留进度（%）"
              :path="`guide.${step.id}.progress`"
              section="guide"
              :min="0"
              :max="100"
              :step="0.1"
              @update:model-value="step.progress.value = $event / 100"
            />
          </div>
        </div>
      </fieldset>
      <p class="ad-muted">同时指定视角和部件时，最终镜头聚焦部件；停留进度在动作指令之后生效。</p>
      <AdminRowTools
        :index="index"
        :count="p.guide.length"
        :name="step.title || step.id"
        @move="moveItem(p.guide, index, $event)"
        @copy="add(index)"
        @remove="p.guide.splice(index, 1)"
      />
    </article>
  </section>
</template>
