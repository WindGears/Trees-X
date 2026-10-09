<script setup lang="ts">
import { computed, onScopeDispose, watch } from 'vue'
import { useProductDraft } from '@/lib/admin/productDraft'
import { fieldId, type EditorSection } from '@/lib/admin/editor'
const props = defineProps<{
  modelValue: number
  label: string
  path: string
  section: EditorSection
  min?: number
  max?: number
  step?: number
  help?: string
}>()
const emit = defineEmits<{ 'update:modelValue': [value: number] }>()
const draft = useProductDraft()
const id = computed(() => fieldId(props.path))
const error = computed(() => draft.issues.value.find((i) => i.path === props.path)?.message)
watch(
  () => [props.path, props.modelValue] as const,
  () => {
    draft.numberLabels[props.path] = { section: props.section, label: props.label }
    const raw = draft.numbers[props.path]
    if (
      raw === undefined ||
      (raw.trim() && Number.isFinite(Number(raw)) && Number(raw) !== props.modelValue)
    )
      draft.numbers[props.path] = String(props.modelValue)
  },
  { immediate: true, flush: 'sync' },
)
function input(event: Event) {
  const raw = (event.target as HTMLInputElement).value
  draft.numbers[props.path] = raw
  if (raw.trim() && Number.isFinite(Number(raw))) emit('update:modelValue', Number(raw))
}
onScopeDispose(() => {
  delete draft.numbers[props.path]
  delete draft.numberLabels[props.path]
})
</script>
<template>
  <label :for="id" class="ad-field">
    <span>{{ label }}</span>
    <input
      :id="id"
      type="number"
      :value="draft.numbers[path] ?? String(modelValue)"
      :min="min"
      :max="max"
      :step="step ?? 'any'"
      :aria-label="label"
      :aria-invalid="Boolean(error)"
      :aria-describedby="id + '-help'"
      @input="input"
    />
    <small :id="id + '-help'" :class="{ 'ad-field-error': error }">{{ error || help }}</small>
  </label>
</template>
