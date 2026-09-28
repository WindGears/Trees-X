<script setup lang="ts">
import { inject, onScopeDispose, toRef, useTemplateRef, watch } from 'vue'
import { Button } from '@/components/ui/button'
import { gestureKey } from '@/lib/gesture/bridge'
import { useGestureSession } from '@/composables/useGestureSession'
import GestureCalibration from './GestureCalibration.vue'
import GestureSkeleton from './GestureSkeleton.vue'
import GestureOnboarding from './GestureOnboarding.vue'
import { useProductStore } from '@/stores/product'

const props = defineProps<{ active: boolean }>()
const bridge = inject(gestureKey)!
const store = useProductStore()
const video = useTemplateRef('video')
const session = useGestureSession(video, toRef(props, 'active'), bridge)
const {
  status,
  message,
  tracked,
  inferenceMs,
  ratio,
  hz,
  landmarks,
  rawPointer,
  filteredPointer,
  thresholds,
  calibrated,
  calibrationState,
} = session
const { mode, owner, phase, motionPhase, confirmation, pinchProgress } = bridge
watch(
  status,
  (value) => {
    store.cameraStatus = value
  },
  { immediate: true },
)
watch(
  () => store.cameraStopRequest,
  () => session.stop(),
)
onScopeDispose(() => {
  store.cameraStatus = 'off'
})
const motionLabels = {
  idle: '张开手掌，准备观察',
  arming: '正在接回控制 · 保持片刻',
  tracking: '已连接 · 左右移动手掌',
  braking: '正在停稳',
  coasting: '惯性滑行 · 将手移回取景框',
  missing: '将手移回取景框',
}
const phaseLabels = {
  idle: '先张开两指，再靠近热点。',
  aiming: '正在瞄准，保持片刻…',
  aimed: '已瞄准 · 捏合两指',
  locked: '已锁定 · 松开两指确认',
  dwell: '保持片刻 · 正在确认',
  missing: '暂时未看到手 · 动作已暂停',
  confirmed: '已确认 · 移开指针可继续选择',
  cancelled: '已取消 · 张开两指，重新瞄准',
}
function resume() {
  bridge.reset()
  owner.value = 'gesture'
}
</script>

<template>
  <section class="gesture-panel" aria-label="手势体验">
    <GestureOnboarding :running="status === 'running'" :tracked="tracked" />
    <div class="gesture-actions">
      <Button
        v-if="status === 'off' || status === 'error'"
        variant="outline"
        :disabled="!active"
        @click="session.start"
        >开启手势体验</Button
      >
      <Button v-else variant="outline" @click="session.stop()">{{
        status === 'starting' ? '取消开启' : '关闭摄像头'
      }}</Button>
      <Button v-if="status === 'running' && owner !== 'gesture'" variant="outline" @click="resume"
        >恢复手势</Button
      >
    </div>
    <p role="status">{{ message }}</p>
    <template v-if="status === 'running'">
      <div class="gesture-actions" role="group" aria-label="手势操作模式">
        <Button variant="ghost" :aria-pressed="mode === 'rotate'" @click="mode = 'rotate'"
          >旋转</Button
        >
        <Button variant="ghost" :aria-pressed="mode === 'select'" @click="mode = 'select'"
          >选择</Button
        >
        <span>{{
          owner === 'animation'
            ? '镜头正在移动'
            : owner === 'mouse'
              ? '鼠标已接管'
              : tracked
                ? '已识别手部'
                : '请将一只手放入画面'
        }}</span>
      </div>
      <details v-if="mode === 'select'" class="gesture-advanced">
        <summary>
          进阶选项 · {{ confirmation === 'dwell' ? '当前为悬停确认' : '当前为捏合确认' }}
        </summary>
        <div class="gesture-actions" role="group" aria-label="选择确认方式">
          <Button
            variant="ghost"
            :aria-pressed="confirmation === 'dwell'"
            @click="confirmation = 'dwell'"
            >悬停确认</Button
          >
          <Button
            variant="ghost"
            :aria-pressed="confirmation === 'pinch'"
            @click="confirmation = 'pinch'"
            >捏合确认</Button
          >
        </div>
      </details>
      <p>
        {{
          mode === 'rotate'
            ? '张掌左右移动，停手即可停稳。手离开画面后会缓慢停下；重新入镜先保持片刻。'
            : confirmation === 'dwell'
              ? '食指靠近热点或操作按钮，停留至进度环完成。移开后可再次选择。'
              : '先张开两指，食指靠近目标；瞄准后捏合，进度完成再松开。锁定后不用保持指尖位置。'
        }}
      </p>
      <p v-if="mode === 'rotate' && owner === 'gesture'" class="gesture-feedback" role="status">
        {{ motionLabels[motionPhase] }}
      </p>
      <p
        v-if="
          mode === 'select' &&
          owner === 'gesture' &&
          !['open', 'prepare-pinch', 'pinch'].includes(calibrationState.stage)
        "
        class="gesture-feedback"
        role="status"
      >
        {{ phase === 'locked' && pinchProgress < 1 ? '捏合中 · 保持片刻' : phaseLabels[phase] }}
      </p>
      <GestureCalibration
        v-if="mode === 'select' && confirmation === 'pinch'"
        :state="calibrationState"
        :calibrated="calibrated"
        :active="active"
        @start="session.startCalibration"
        @cancel="session.cancelCalibration"
        @reset="session.resetCalibration"
      />
    </template>
    <div v-show="status === 'running'" class="gesture-preview-media">
      <video ref="video" autoplay muted playsinline aria-label="本地镜像摄像头预览"></video>
      <GestureSkeleton :points="landmarks" :raw="rawPointer" :filtered="filteredPointer" />
      <span class="gesture-frame" aria-hidden="true"></span>
    </div>
    <p v-if="status === 'running'">
      镜像预览 · {{ tracked ? '已看见你的手' : '将一只手放入框内' }}
    </p>
    <details v-show="status === 'running'" class="gesture-preview">
      <summary>识别诊断</summary>
      <p>空心圆：原始指尖 · 实心方块：平滑后指针</p>
      <p>
        两指距离比 {{ ratio === null ? '—' : ratio.toFixed(2) }} · 捏合阈值
        {{ thresholds.close.toFixed(2) }} / 松开阈值 {{ thresholds.open.toFixed(2) }}
      </p>
      <p>最近一帧推理 {{ inferenceMs }} ms · 返回结果 {{ hz }} 次/秒（非渲染帧率）</p>
      <p>画面仅本机处理，不上传、不保存。</p>
    </details>
  </section>
</template>
