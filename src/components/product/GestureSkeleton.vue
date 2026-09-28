<script setup lang="ts">
import type { Point, Position } from '@/lib/gesture/detector'
defineProps<{ points: Point[]; raw: Position | null; filtered: Position | null }>()
const chains = [
  [0, 1, 2, 3, 4],
  [0, 5, 6, 7, 8],
  [5, 9, 10, 11, 12],
  [9, 13, 14, 15, 16],
  [13, 17, 18, 19, 20],
  [17, 0],
]
function line(points: Point[], chain: number[]) {
  return chain.map((i) => `${(1 - points[i]!.x) * 100},${points[i]!.y * 100}`).join(' ')
}
</script>
<template>
  <svg class="gesture-skeleton" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
    <g v-if="points.length === 21" fill="none" stroke="#a9b9f7" stroke-width="0.6">
      <polyline v-for="(chain, index) in chains" :key="index" :points="line(points, chain)" />
    </g>
    <circle
      v-if="raw"
      :cx="raw.x * 100"
      :cy="raw.y * 100"
      r="2"
      fill="none"
      stroke="white"
      stroke-width="0.7"
    />
    <rect
      v-if="filtered"
      :x="filtered.x * 100 - 1.5"
      :y="filtered.y * 100 - 1.5"
      width="3"
      height="3"
      fill="#a9b9f7"
    />
  </svg>
</template>
