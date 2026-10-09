<script setup lang="ts">
import { computed } from 'vue'
import { useProductDraft } from '@/lib/admin/productDraft'
import { fieldId } from '@/lib/admin/editor'
const props = defineProps<{
  modelValue: string
  label: string
  path: string
  help?: string
  multiline?: boolean
  readonly?: boolean
  maxlength?: number
}>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const draft = useProductDraft()
const error = computed(() => draft.issues.value.find((i) => i.path === props.path)?.message)
const id = computed(() => fieldId(props.path))
function input(event: Event) {
  emit('update:modelValue', (event.target as HTMLInputElement).value)
}
</script>
<template>
  <label :for="id" class="ad-field">
    <span>{{ label }}</span>
    <textarea
      v-if="multiline"
      :id="id"
      :value="modelValue"
      rows="3"
      :maxlength="maxlength"
      :aria-label="label"
      :aria-invalid="Boolean(error)"
      :aria-describedby="id + '-help'"
      @input="input"
    />
    <input
      v-else
      :id="id"
      :value="modelValue"
      :readonly="readonly"
      :aria-label="label"
      :maxlength="maxlength"
      :aria-invalid="Boolean(error)"
      :aria-describedby="id + '-help'"
      @input="input"
    />
    <small :id="id + '-help'" :class="{ 'ad-field-error': error }">{{ error || help }}</small>
  </label>
</template>
