<script setup lang="ts">
import { computed } from 'vue'
import { useProductDraft } from '@/lib/admin/productDraft'
import { fieldId } from '@/lib/admin/editor'
const props = defineProps<{
  modelValue: string
  label: string
  path: string
  options: { value: string; label: string }[]
  emptyLabel?: string
}>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const draft = useProductDraft()
const error = computed(() => draft.issues.value.find((i) => i.path === props.path)?.message)
const missing = computed(
  () => props.modelValue && !props.options.some((o) => o.value === props.modelValue),
)
</script>
<template>
  <label :for="fieldId(path)"
    >{{ label }}
    <select
      :id="fieldId(path)"
      :value="modelValue"
      :aria-label="label"
      :aria-invalid="Boolean(error)"
      :aria-describedby="fieldId(path) + '-help'"
      @change="emit('update:modelValue', ($event.target as HTMLSelectElement).value)"
    >
      <option v-if="emptyLabel" value="">{{ emptyLabel }}</option>
      <option v-if="missing" :value="modelValue" disabled>失效引用：{{ modelValue }}</option>
      <option v-for="option in options" :key="option.value" :value="option.value">
        {{ option.label }}
      </option>
    </select>
    <small :id="fieldId(path) + '-help'" class="ad-field-error">{{ error }}</small>
  </label>
</template>
