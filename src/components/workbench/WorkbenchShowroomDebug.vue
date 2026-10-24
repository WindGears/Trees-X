<script setup lang="ts">
import { ref, useId } from 'vue'

const props = defineProps<{ apply: (value: number) => number | undefined }>()
const id = useId(),
  multiplier = ref(1)
function set(value: number) {
  const applied = props.apply(value)
  if (applied !== undefined) multiplier.value = applied
}
function input(event: Event) {
  if (event.target instanceof HTMLInputElement) set(event.target.valueAsNumber)
}
</script>

<template>
  <div class="wb-showroom-debug" @pointerdown.stop @wheel.stop @keydown.stop>
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
</style>
