<script setup lang="ts">
import { computed, inject, nextTick, onScopeDispose, watch } from 'vue'
import { Check, Layers2, RotateCcw, X } from '@lucide/vue'
import { gsap } from 'gsap'
import { Button } from '@/components/ui/button'
import { gestureKey } from '@/lib/gesture/bridge'
import { useProductStore } from '@/stores/product'
import GesturePanel from './GesturePanel.vue'
import ProductGuide from './ProductGuide.vue'

defineProps<{ available: boolean }>()
const store = useProductStore()
const bridge = inject(gestureKey)!
const { selected } = bridge
const titles = {
  appearance: '外观与配色',
  details: '走近细节',
  structure: '观察结构',
  gesture: '用手探索',
  console: '完整控制台',
  info: '作品信息',
}
const title = computed(() => (store.panel ? titles[store.panel] : ''))
const shows = (section: string) => store.panel === section || store.panel === 'console'
let opener: HTMLElement | null = null
watch(
  () => store.panel,
  async (panel, previous) => {
    if (!previous && panel)
      opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    if (panel && window.innerWidth < 1024) {
      await nextTick()
      document
        .getElementById('studio-console')
        ?.scrollIntoView({ behavior: 'instant', block: 'start' })
    }
  },
)
function close() {
  store.panel = null
  opener?.focus({ preventScroll: true })
}
function escape(event: KeyboardEvent) {
  if (event.key === 'Escape' && store.panel && !store.catalogOpen) close()
}
window.addEventListener('keydown', escape)
onScopeDispose(() => window.removeEventListener('keydown', escape))
function transition(element: Element, done: () => void, entering: boolean) {
  gsap.killTweensOf(element)
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
  gsap.fromTo(
    element,
    { opacity: entering ? 0 : 1, x: entering ? 20 : 0 },
    {
      opacity: entering ? 1 : 0,
      x: entering ? 0 : 20,
      duration: reduced ? 0 : 0.24,
      ease: 'power2.out',
      onComplete: done,
    },
  )
}
function manual() {
  bridge.takeMouse()
  store.guideStep = null
}
function chooseFinish(id: string) {
  manual()
  store.finishId = id
}
function choosePart(id: string) {
  manual()
  store.activePartId = id
  bridge.showPart()
}
function closePart() {
  manual()
  bridge.hidePart()
}
function toggleStructure() {
  manual()
  selected.value = false
  store.setStructure(!store.exploded)
}
function reset() {
  manual()
  selected.value = false
  store.resetExperience()
}
</script>

<template>
  <Transition
    :css="false"
    @enter="(element, done) => transition(element, done, true)"
    @leave="(element, done) => transition(element, done, false)"
    @enter-cancelled="(element) => gsap.killTweensOf(element)"
    @leave-cancelled="(element) => gsap.killTweensOf(element)"
  >
    <aside
      v-show="store.panel"
      id="studio-console"
      class="studio-console"
      aria-labelledby="panel-heading"
      data-lenis-prevent
    >
      <header class="studio-console__header">
        <h2 id="panel-heading">{{ title }}</h2>
        <Button variant="ghost" size="icon" aria-label="收起面板" @click="close"
          ><X :size="18"
        /></Button>
      </header>
      <section
        v-show="shows('appearance')"
        class="console-section"
        aria-labelledby="finish-heading"
      >
        <div class="console-section__heading">
          <h3 id="finish-heading">选择表面</h3>
          <span>{{ store.activeFinish.name }}</span>
        </div>
        <div class="finish-options" role="group" aria-label="外壳配色">
          <Button
            v-for="finish in store.product.finishes"
            :key="finish.id"
            variant="ghost"
            :disabled="!available"
            :aria-pressed="store.finishId === finish.id"
            @click="chooseFinish(finish.id)"
          >
            <span class="finish-swatch" :style="{ backgroundColor: finish.swatch }"></span
            >{{ finish.name }}<Check v-if="store.finishId === finish.id" :size="14" />
          </Button>
        </div>
        <p class="console-note">转动商品，看看光线如何改变表面的色泽。</p>
      </section>
      <section v-show="shows('details')" class="console-section" aria-labelledby="parts-heading">
        <div class="console-section__heading"><h3 id="parts-heading">值得靠近的地方</h3></div>
        <div class="part-options" role="group" aria-label="部件聚焦">
          <Button
            v-for="part in store.product.hotspots"
            :key="part.id"
            variant="ghost"
            :disabled="!available"
            :aria-pressed="selected && store.activePartId === part.id"
            :aria-label="`了解${part.name}`"
            @click="choosePart(part.id)"
            >{{ part.name }}</Button
          >
        </div>
        <div
          v-if="selected && store.activePart"
          class="part-description"
          role="region"
          :aria-label="`${store.activePart.name}说明`"
        >
          <strong>{{ store.activePart.name }}</strong>
          <p>{{ store.activePart.description }}</p>
          <Button variant="ghost" @click="closePart">返回全景</Button>
        </div>
      </section>
      <ProductGuide v-show="shows('details')" :available="available" />
      <section
        v-show="shows('structure')"
        class="console-section"
        aria-labelledby="structure-heading"
      >
        <div class="console-section__heading"><h3 id="structure-heading">外观结构</h3></div>
        <Button
          class="structure-action"
          variant="outline"
          :disabled="!available || !store.product.structure.length"
          :aria-pressed="store.exploded"
          @click="toggleStructure"
        >
          <Layers2 :size="16" />{{
            !store.product.structure.length ? '整体观察' : store.exploded ? '合拢结构' : '展开结构'
          }}
        </Button>
        <p class="console-note">
          {{
            store.product.structure.length
              ? '让各个部分分开，观察它们的关系。这是外观分层示意，不代表内部构造。'
              : '这件作品适合整体欣赏，可以旋转、试色和走近细节。暂不支持拆分展示。'
          }}
        </p>
      </section>
      <section
        v-show="shows('gesture')"
        id="gesture-control"
        class="console-section console-gesture"
        aria-labelledby="gesture-heading"
      >
        <div class="console-section__heading"><h3 id="gesture-heading">自然手势</h3></div>
        <p>开启后，画面只在本机处理。随时移动鼠标即可接管。</p>
        <GesturePanel :active="available" />
      </section>
      <footer v-show="shows('info')" id="details" class="studio-console__footer">
        <h3>{{ store.product.label }} · 作品信息</h3>
        <p>三维商品展示与交互系统。当前展示只描述可见形态，试色与结构演示不代表真实商品规格。</p>
        <a
          v-if="store.product.source"
          class="console-source"
          :href="store.product.source.url"
          target="_blank"
          rel="noreferrer"
          >模型来源 · {{ store.product.source.author }} / {{ store.product.source.license }}</a
        >
        <p v-else>本站制作的概念音箱模型。</p>
        <p>反射环境：Studio Small 05，Greg Zaal / Poly Haven，CC0。</p>
      </footer>
      <div v-show="store.panel === 'console'" class="console-reset">
        <Button variant="ghost" :disabled="!available" aria-label="重置体验" @click="reset"
          ><RotateCcw :size="15" /> 重置体验</Button
        >
      </div>
    </aside>
  </Transition>
</template>
