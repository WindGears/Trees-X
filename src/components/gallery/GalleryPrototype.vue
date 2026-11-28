<script setup lang="ts">
import { computed, ref } from 'vue'
import { Box, Camera, Layers, MoreHorizontal, Play, X } from '@lucide/vue'
import GalleryHeader from './GalleryHeader.vue'
import GalleryLibrary from './GalleryLibrary.vue'
import GalleryHelp from './GalleryHelp.vue'
import UiLoadingTrack from '@/components/ui/UiLoadingTrack.vue'
import { galleryItems } from '@/lib/workbench/galleryCatalog'
import '@/assets/styles/museum.css'

const items = galleryItems([
  {
    slug: 'typewriter-study',
    name: '机械打字机',
    category: '机械',
    description: '按下一枚键，观察字杆与传动机构的联动。',
    displayStatus: 'formal',
  },
  {
    slug: 'piano-cfx',
    name: '三角钢琴',
    category: '乐器',
    description: '沿八段结构探索键盘、击弦机构与弦列。',
    displayStatus: 'formal',
  },
  {
    slug: 'reventon',
    name: 'Reventón 汽车',
    category: '汽车',
    description: '打开双门，从座舱近景观察车身结构。',
    displayStatus: 'formal',
  },
])
const slug = ref('typewriter-study')
const item = computed(() => items.find((item) => item.slug === slug.value) ?? items[0]!)
const library = ref(false)
const help = ref(false)
const state = ref<'cover' | 'live' | 'loading' | 'error'>('cover')
const chapter = ref(0)
const panel = ref('')
const image = computed(() =>
  slug.value === 'typewriter-study' && chapter.value
    ? '/covers/showcase/typewriter-layers.webp'
    : item.value.cover,
)
function select(id: string) {
  slug.value = id
  chapter.value = 0
  panel.value = ''
}
function inspectRod() {
  chapter.value = 1
  panel.value = '字杆'
}
function reset() {
  chapter.value = 0
  panel.value = ''
}
</script>

<template>
  <main class="museum" aria-label="机械探索馆交互原型">
    <img class="museum-poster" :src="image" :alt="item.name" />
    <div class="museum-top-scrim" />
    <GalleryHeader
      :items="items"
      :current="slug"
      :name="item.name"
      @select="select"
      @library="library = true"
      @help="help = true"
    />
    <div class="museum-identity">
      <h1>{{ item.name }}</h1>
      <p>{{ item.description }}</p>
    </div>
    <span class="museum-prototype-note">交互原型 · 实机静帧 · 未加载三维</span>
    <nav class="museum-prototype-states" aria-label="原型状态">
      <button @click="state = 'cover'">封面</button
      ><button @click="state = 'loading'">加载示意</button
      ><button @click="state = 'error'">失败示意</button
      ><button @click="state = 'live'">观察示意</button>
    </nav>
    <button v-if="state === 'cover'" class="museum-start museum-primary" @click="state = 'live'">
      <Play :size="17" />开始互动
    </button>
    <div v-else-if="state === 'loading' || state === 'error'" class="museum-load">
      <p>{{ state === 'loading' ? '正在准备模型 · 原型示意' : '加载失败 · 原型示意' }}</p>
      <UiLoadingTrack v-if="state === 'loading'" /><template v-else
        ><button class="museum-button" @click="state = 'loading'">重试</button
        ><button class="museum-button" @click="library = true">打开展品库</button></template
      >
    </div>
    <template v-else>
      <div class="museum-dock" aria-label="结构章节">
        <button
          v-for="(name, index) in ['整机', '分层', '平铺']"
          :key="name"
          :aria-pressed="chapter === index"
          @click="chapter = index"
        >
          {{ name }}</button
        ><button class="museum-strike" @click="panel = '字杆'">敲击 A 键</button>
      </div>
      <div class="museum-tools">
        <button @click="panel = '部件'"><Box :size="17" />部件</button
        ><button @click="panel = '外观'"><Layers :size="17" />外观</button
        ><button @click="panel = '视角'"><Camera :size="17" />视角</button
        ><button aria-label="更多操作" @click="panel = '更多'">
          <MoreHorizontal :size="19" />
        </button>
      </div>
      <p class="museum-hint">拖动旋转 · 滚轮缩放</p>
    </template>
    <aside v-if="panel" class="museum-inspector">
      <header>
        <h2>{{ panel }}</h2>
        <button class="museum-icon" aria-label="关闭面板" @click="panel = ''">
          <X :size="18" />
        </button>
      </header>
      <template v-if="panel === '部件'"
        ><label class="museum-search"><input placeholder="搜索部件" aria-label="搜索部件" /></label
        ><button class="museum-button" @click="inspectRod">字杆</button
        ><button class="museum-button" @click="panel = '键盘'">键盘</button></template
      ><template v-else-if="panel === '外观'"
        ><p>选择已有外观方案</p>
        <button class="museum-button">经典黑金 · 当前外观</button></template
      ><template v-else-if="panel === '视角'"
        ><button v-for="name in ['全景', '正面', '俯视']" :key="name" class="museum-button">
          {{ name }}
        </button></template
      ><template v-else-if="panel === '更多'"
        ><button class="museum-button" @click="help = true">操作帮助</button
        ><button class="museum-button" @click="reset">复原结构</button></template
      ><template v-else
        ><p>按下按键，观察字杆向纸面摆动。这是部件详情的静态布局示意。</p>
        <button class="museum-button" @click="panel = ''">回到本段</button></template
      >
    </aside>
    <GalleryLibrary v-model:open="library" :items="items" :current="slug" @select="select" />
    <GalleryHelp v-model:open="help" />
  </main>
</template>
