<template>
  <div class="demo-container">
    <div class="demo-header">
      <h1>视觉增强方案演示</h1>
      <p>对比原有实现与增强后的表现力</p>
      <div class="demo-controls">
        <button class="toggle-btn" @click="toggleVersion">
          当前: {{ isEnhanced ? '增强版' : '原始版' }}
        </button>
        <button class="action-btn" @click="restartAnimation">重播入场</button>
      </div>
    </div>

    <div class="canvas-wrapper">
      <TresCanvas v-bind="gl">
        <TresPerspectiveCamera :position-y="1.5" :position-z="5" :fov="45" />

        <!-- 环境光 -->
        <TresAmbientLight :intensity="0.3" />

        <!-- 主光源 -->
        <TresDirectionalLight
          :position-x="keyLightPos[0]"
          :position-y="keyLightPos[1]"
          :position-z="keyLightPos[2]"
          :intensity="isEnhanced ? 2.5 : 2.0"
          :color="isEnhanced ? '#e8f4ff' : '#ffffff'"
        />

        <!-- 增强版：边缘光 -->
        <TresDirectionalLight
          v-if="isEnhanced"
          :position-x="-3"
          :position-y="1"
          :position-z="-2"
          :intensity="0.8"
          color="#ffd4a8"
        />

        <!-- 产品模型 -->
        <TresMesh
          :position-x="productPos[0]"
          :position-y="productPos[1]"
          :position-z="productPos[2]"
          :rotation="productRot"
        >
          <TresBoxGeometry :args="[1.5, 1.5, 1.5]" />
          <TresMeshStandardMaterial
            :color="currentColor"
            :metalness="isEnhanced ? 0.9 : 0.7"
            :roughness="materialRoughness"
            :env-map-intensity="isEnhanced ? 1.2 : 0.8"
          />
        </TresMesh>

        <!-- 增强版：智能粒子 -->
        <TresGroup v-if="isEnhanced">
          <TresMesh
            v-for="(particle, i) in particles"
            :key="`p-${i}`"
            :position-x="particle.pos[0]"
            :position-y="particle.pos[1]"
            :position-z="particle.pos[2]"
          >
            <TresSphereGeometry :args="[0.02, 8, 8]" />
            <TresMeshBasicMaterial
              :color="particle.color"
              :opacity="particle.opacity"
              transparent
            />
          </TresMesh>
        </TresGroup>

        <!-- 原始版：静态环形粒子 -->
        <TresGroup v-else>
          <TresMesh
            v-for="(position, i) in staticPositions"
            :key="`s-${i}`"
            :position-x="position[0]"
            :position-y="position[1]"
            :position-z="position[2]"
          >
            <TresSphereGeometry :args="[0.015, 6, 6]" />
            <TresMeshBasicMaterial color="#4a9eff" :opacity="0.6" transparent />
          </TresMesh>
        </TresGroup>

        <!-- 后期效果 -->
        <Suspense>
          <template #default>
            <Effects :enhanced="isEnhanced" />
          </template>
        </Suspense>
      </TresCanvas>
    </div>

    <!-- 说明面板 -->
    <div class="info-panel">
      <h3>{{ isEnhanced ? '增强版特性' : '原始版特性' }}</h3>
      <ul v-if="isEnhanced">
        <li>✨ 戏剧性入场动画（5秒4幕）</li>
        <li>🌊 待机呼吸动画</li>
        <li>🎯 景深效果（背景虚化）</li>
        <li>🔮 智能粒子（被产品吸引）</li>
        <li>💎 材质呼吸（roughness动态）</li>
        <li>🎨 双色温光源系统</li>
      </ul>
      <ul v-else>
        <li>静态入场</li>
        <li>固定环形粒子</li>
        <li>单一光源</li>
        <li>无景深</li>
        <li>静态材质</li>
      </ul>

      <div v-if="isEnhanced" class="interaction-hint">
        <button class="color-btn" @click="triggerColorChange">🎨 试色动画</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { TresCanvas } from '@tresjs/core'
import Effects from './DemoEffects.vue'
import { useEnhancedDemo } from '@/composables/useEnhancedDemo'
const {
  gl,
  isEnhanced,
  productPos,
  productRot,
  keyLightPos,
  currentColor,
  materialRoughness,
  particles,
  staticPositions,
  toggleVersion,
  restartAnimation,
  triggerColorChange,
} = useEnhancedDemo()
</script>
<style scoped src="./enhanced-demo.css"></style>
