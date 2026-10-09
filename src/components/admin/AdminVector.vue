<script setup lang="ts">
import type { Vec3 } from '@/lib/workbench/types'
import type { EditorSection } from '@/lib/admin/editor'
import AdminNumber from './AdminNumber.vue'
defineProps<{ value: Vec3; label: string; path: string; section: EditorSection }>()
</script>
<template>
  <fieldset class="ad-vector">
    <legend>{{ label }}</legend>
    <AdminNumber
      v-for="(axis, index) in ['X', 'Y', 'Z']"
      :key="axis"
      v-model="value[index]!"
      :label="label + ' ' + axis"
      :path="path + '.' + index"
      :section="section"
    />
  </fieldset>
</template>
