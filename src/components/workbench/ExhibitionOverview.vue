<script setup lang="ts">
import { ArrowDown, ArrowRight, ArrowUpRight } from '@lucide/vue'
import { computed, ref } from 'vue'
import {
  isLocalLink,
  typewriterHero,
  type ExhibitionOverviewItem,
} from '@/lib/workbench/exhibition'
import '@/assets/styles/exhibition-overview.css'

const props = defineProps<{
  exhibits: readonly ExhibitionOverviewItem[]
  catalogStatus: 'loading' | 'ready' | 'error'
}>()
const emit = defineEmits<{ open: [slug: string]; retry: [] }>()

const typewriter = computed(() => props.exhibits.find((item) => item.slug === 'typewriter-study'))
const shots = [
  {
    id: 'whole',
    label: '整机',
    source: typewriterHero.whole,
    alt: '装配状态的机械打字机，机盖位于键盘上方，滚筒位于后方',
  },
  {
    id: 'layers',
    label: '分层',
    source: typewriterHero.layers,
    alt: '分层状态的同一台机械打字机，上盖、键盘机构和底座沿高度分开',
  },
] as const
type Shot = (typeof shots)[number]['id']
const selectedShot = ref<Shot>('layers')
const failedShots = ref(new Set<Shot>())
const failedCovers = ref(new Set<string>())

function open(event: MouseEvent, slug: string) {
  if (!isLocalLink(event)) return
  event.preventDefault()
  emit('open', slug)
}
</script>

<template>
  <div class="exhibition">
    <a class="skip-link" href="#exhibition-main">跳转到展厅内容</a>
    <header class="exhibition-header">
      <div class="exhibition-frame exhibition-header-inner">
        <span class="exhibition-brand">Trees X</span>
        <a class="exhibition-index-link" href="#exhibition-index">
          展品索引 <ArrowDown :size="15" aria-hidden="true" />
        </a>
      </div>
    </header>

    <main id="exhibition-main" class="exhibition-frame" tabindex="-1">
      <section
        class="exhibition-hero"
        :class="{ 'is-without-feature': catalogStatus === 'ready' && !typewriter }"
        aria-labelledby="exhibition-title"
      >
        <div class="exhibition-intro">
          <h1 id="exhibition-title">看见机械<span>如何运作</span></h1>
          <p>旋转整机、拆开部件，顺着一次动作看清内部结构。</p>
          <a
            v-if="typewriter"
            class="exhibition-primary"
            :href="typewriter.href"
            @click="open($event, typewriter.slug)"
          >
            探索打字机 <ArrowRight :size="18" aria-hidden="true" />
          </a>
          <a v-else class="exhibition-primary" href="#exhibition-index">
            查看展品索引 <ArrowDown :size="18" aria-hidden="true" />
          </a>
        </div>

        <figure v-if="typewriter || catalogStatus !== 'ready'" class="exhibition-plate">
          <div class="exhibition-plate-image">
            <img
              v-for="shot in shots"
              v-show="!failedShots.has(shot.id)"
              :key="shot.id"
              :src="shot.source"
              :alt="shot.alt"
              :aria-hidden="selectedShot !== shot.id ? 'true' : undefined"
              :class="{ 'is-visible': selectedShot === shot.id }"
              :fetchpriority="shot.id === 'layers' ? 'high' : 'low'"
              decoding="async"
              @error="failedShots.add(shot.id)"
            />
            <p v-if="failedShots.has(selectedShot)" class="exhibition-image-message" role="status">
              展示图暂不可用。
            </p>
          </div>
          <figcaption class="exhibition-plate-caption">
            <span>{{ typewriter?.name || '机械打字机' }}</span>
            <div class="exhibition-shots" role="group" aria-label="打字机展示图">
              <button
                v-for="shot in shots"
                :key="shot.id"
                type="button"
                :aria-pressed="selectedShot === shot.id"
                @click="selectedShot = shot.id"
              >
                {{ shot.label }}
              </button>
            </div>
          </figcaption>
        </figure>
      </section>

      <section
        id="exhibition-index"
        class="exhibition-index"
        aria-labelledby="exhibition-index-title"
      >
        <h2 id="exhibition-index-title">展品索引</h2>
        <p v-if="catalogStatus === 'loading'" class="exhibition-status" role="status">
          正在读取展品目录…
        </p>
        <div v-else-if="catalogStatus === 'error'" class="exhibition-status" role="alert">
          <p>展品目录暂时无法读取。</p>
          <button type="button" @click="emit('retry')">重新读取</button>
        </div>
        <p v-else-if="!exhibits.length" class="exhibition-status" role="status">
          当前没有上架展品。
        </p>
        <ul v-else class="exhibition-index-list">
          <li v-for="item in exhibits" :key="item.slug">
            <a :href="item.href" class="exhibition-exhibit" @click="open($event, item.slug)">
              <span class="exhibition-exhibit-image" aria-hidden="true">
                <img
                  v-if="item.cover && !failedCovers.has(item.cover)"
                  :src="item.cover"
                  alt=""
                  decoding="async"
                  @error="failedCovers.add(item.cover)"
                />
              </span>
              <span class="exhibition-exhibit-copy">
                <strong>{{ item.name }}</strong>
                <span>{{ item.highlight }}</span>
              </span>
              <ArrowUpRight :size="17" aria-hidden="true" />
            </a>
          </li>
        </ul>
      </section>
    </main>
  </div>
</template>
