<script setup lang="ts">
import { ref, useId } from 'vue'

const props = defineProps<{
  apply: (value: number) => number | undefined
  applyLighting: (value: number) => number | undefined
}>()
const id = useId(),
  multiplier = ref(1),
  lighting = ref(1)
function set(value: number) {
  const applied = props.apply(value)
  if (applied !== undefined) multiplier.value = applied
}
function input(event: Event) {
  if (event.target instanceof HTMLInputElement) set(event.target.valueAsNumber)
}
function setLighting(value: number) {
  const applied = props.applyLighting(value)
  if (applied !== undefined) lighting.value = applied
}
</script>

<template>
  <div class="wb-showroom-debug" @pointerdown.stop @wheel.stop @keydown.stop>
    <div class="debug-heading">
      <label :for="`${id}-lighting`">摄影棚照明</label>
      <output :for="`${id}-lighting`">{{ Math.round(lighting * 100) }}%</output>
      <button type="button" :disabled="lighting === 1" @click="setLighting(1)">复原</button>
    </div>
    <input
      :id="`${id}-lighting`"
      type="range"
      min="0.25"
      max="2"
      step="0.05"
      :value="lighting"
      :aria-valuetext="`${Math.round(lighting * 100)}%`"
      :aria-describedby="`${id}-lighting-hint`"
      @change="setLighting(($event.target as HTMLInputElement).valueAsNumber)"
    />
    <p :id="`${id}-lighting-hint`" class="lighting-hint">灯光与反射联动，松开后更新。</p>
    <details>
      <summary>仅调整灯板外观</summary>
      <div class="debug-heading">
        <label :for="id">灯板亮度 · 调试</label>
        <output :for="id">{{ Math.round(multiplier * 100) }}%</output>
        <button type="button" :disabled="multiplier === 1" @click="set(1)">复原</button>
      </div>
      <input
        :id="id"
        type="range"
        min="0"
        max="3"
        step="0.05"
        :value="multiplier"
        :aria-valuetext="`${Math.round(multiplier * 100)}%`"
        :aria-describedby="`${id}-hint`"
        @input="input"
      />
      <p :id="`${id}-hint`">仅调灯板与柔光，不改变照明和环境反射。</p>
    </details>
  </div>
</template>

<style scoped>
.wb-showroom-debug {
  position: absolute;
  z-index: 7;
  left: 24px;
  bottom: 126px;
  width: min(300px, calc(100% - 48px));
  padding: 12px 14px;
  border-radius: 14px;
  background: rgb(246 248 244 / 92%);
  backdrop-filter: blur(16px);
  color: #29332e;
  box-shadow: 0 5px 18px rgb(0 0 0 / 12%);
  pointer-events: auto;
  font-size: 12px;
}
.debug-heading {
  display: flex;
  align-items: center;
  gap: 12px;
}
details {
  margin-top: 10px;
  border-top: 1px solid #cbd4cb;
  padding-top: 8px;
}
summary {
  cursor: pointer;
  padding: 4px 0;
}
details[open] summary {
  margin-bottom: 6px;
}
summary:focus-visible {
  outline: 2px solid #405c4c;
  outline-offset: 3px;
}
label {
  font-weight: 600;
}
output {
  margin-left: auto;
  font-variant-numeric: tabular-nums;
}
button {
  border: 0;
  border-radius: 6px;
  padding: 6px 8px;
  background: #e0e5df;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
button:hover:not(:disabled) {
  background: #cbd4cb;
}
button:disabled {
  opacity: 0.5;
  cursor: default;
}
input {
  display: block;
  width: 100%;
  margin: 4px 0;
  height: 28px;
  accent-color: #405c4c;
  cursor: pointer;
}
input:focus-visible,
button:focus-visible {
  outline: 2px solid #405c4c;
  outline-offset: 3px;
}
p {
  margin: 0;
  line-height: 1.5;
  color: #47544b;
}
@media (max-width: 600px) {
  .wb-showroom-debug {
    left: 12px;
    bottom: 218px;
    width: min(300px, calc(100% - 24px));
  }
}
@media (min-width: 601px) and (max-height: 850px) {
  .wb-showroom-debug {
    left: 156px;
    width: 260px;
  }
}
</style>
