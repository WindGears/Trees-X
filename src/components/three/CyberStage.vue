<script setup lang="ts">
import { inject, markRaw, onMounted, onScopeDispose, watch } from 'vue'
import { useLoop, useTres } from '@tresjs/core'
import { gsap } from 'gsap'
import {
  AdditiveBlending,
  Color,
  BufferAttribute,
  BufferGeometry,
  Mesh,
  PlaneGeometry,
  Points,
  ShaderMaterial,
  Uniform,
  Vector3,
} from 'three'
import { useProductStore } from '@/stores/product'
import { createParticleData } from '@/lib/three/cyber'
import { gestureKey } from '@/lib/gesture/bridge'

const props = defineProps<{ particleCount: number }>()
const emit = defineEmits<{ ready: [] }>()
const bridge = inject(gestureKey)!
const store = useProductStore()
const { camera, invalidate } = useTres()
const ringUniforms = {
  uTime: new Uniform(0),
  uColor: new Uniform(new Color(store.stage.accent)),
  uOpacity: new Uniform(0.5),
}
const particleUniforms = {
  uTime: new Uniform(0),
  uColor: new Uniform(new Color(store.stage.accent)),
  uGather: new Uniform(1),
  uOpacity: new Uniform(0.54),
}
const ringGeometry = new PlaneGeometry(6.4, 6.4)
const ringMaterial = new ShaderMaterial({
  uniforms: ringUniforms,
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform float uTime;
    uniform float uOpacity;
    uniform vec3 uColor;
    varying vec2 vUv;
    void main() {
      vec2 centered = vUv - 0.5;
      float radius = length(centered);
      float angle = atan(centered.y, centered.x);
      float ring = smoothstep(0.018, 0.002, abs(radius - 0.315));
      float inner = smoothstep(0.009, 0.001, abs(radius - 0.265));
      float arc = smoothstep(0.1, 0.95, sin(angle * 6.0 - uTime * 0.55) * 0.5 + 0.5);
      float energy = ring * (1.1 + arc * 1.8) + inner * 0.55;
      vec3 color = uColor * (1.0 + arc);
      gl_FragColor = vec4(color * energy, energy * uOpacity);
    }
  `,
  transparent: true,
  depthWrite: false,
  blending: AdditiveBlending,
  toneMapped: false,
})
const ring = markRaw(new Mesh(ringGeometry, ringMaterial))
ring.renderOrder = -2

const particleData = createParticleData(props.particleCount)
const particleGeometry = new BufferGeometry()
particleGeometry.setAttribute('position', new BufferAttribute(particleData.positions, 3))
particleGeometry.setAttribute('aSeed', new BufferAttribute(particleData.seeds, 1))
const particleMaterial = new ShaderMaterial({
  uniforms: particleUniforms,
  vertexShader: /* glsl */ `
    uniform float uTime;
    uniform float uGather;
    attribute float aSeed;
    varying float vAlpha;
    void main() {
      vec3 stable = position;
      stable.y += sin(uTime * (0.12 + aSeed * 0.12) + aSeed * 20.0) * 0.08;
      vec3 gathered = normalize(position + vec3(0.001)) * (0.36 + aSeed * 0.28);
      vec3 transformed = mix(gathered, stable, uGather);
      vec4 viewPosition = modelViewMatrix * vec4(transformed, 1.0);
      gl_Position = projectionMatrix * viewPosition;
      gl_PointSize = (1.5 + aSeed * 2.3) * min(2.4, 8.5 / -viewPosition.z);
      vAlpha = 0.3 + aSeed * 0.7;
    }
  `,
  fragmentShader: /* glsl */ `
    uniform float uOpacity;
    uniform vec3 uColor;
    varying float vAlpha;
    void main() {
      float distanceToCenter = length(gl_PointCoord - 0.5);
      float dot = 1.0 - smoothstep(0.08, 0.5, distanceToCenter);
      gl_FragColor = vec4(uColor * 1.4, dot * vAlpha * uOpacity);
    }
  `,
  transparent: true,
  depthWrite: false,
  blending: AdditiveBlending,
  toneMapped: false,
})
const particles = markRaw(new Points(particleGeometry, particleMaterial))
particles.renderOrder = -1
const forward = new Vector3()
const state = {
  ringScale: 1,
  ringOpacity: store.stage.ringOpacity,
  gather: 1,
  particleOpacity: store.stage.kind === 'botanical' ? 0.12 : 0.22,
}
let timeline: gsap.core.Timeline | undefined

function apply() {
  particles.visible = store.product.id !== 'form-01'
  ring.visible = store.product.id !== 'form-01'
  ring.scale.setScalar(state.ringScale)
  ringUniforms.uOpacity.value = state.ringOpacity
  particleUniforms.uGather.value = state.gather
  particleUniforms.uOpacity.value = state.particleOpacity
  invalidate()
}
function settle() {
  timeline?.kill()
  timeline = undefined
  Object.assign(state, {
    ringScale: 1,
    ringOpacity: store.stage.ringOpacity,
    gather: 1,
    particleOpacity: store.stage.kind === 'botanical' ? 0.12 : 0.22,
  })
  apply()
}
function replay() {
  timeline?.kill()
  Object.assign(state, { ringScale: 0.25, ringOpacity: 0, gather: 0, particleOpacity: 0 })
  apply()
  timeline = gsap
    .timeline({ onUpdate: apply, onComplete: settle })
    .to(
      state,
      {
        ringScale: 1,
        ringOpacity: store.stage.ringOpacity * 2,
        duration: 0.35,
        ease: 'power3.out',
      },
      0,
    )
    .to(
      state,
      {
        particleOpacity: store.stage.kind === 'botanical' ? 0.12 : 0.22,
        duration: 0.7,
        ease: 'power2.out',
      },
      0,
    )
    .to(state, { gather: 1, duration: 1.35, ease: 'power3.inOut' }, 0.1)
    .to(state, { ringOpacity: store.stage.ringOpacity, duration: 0.6, ease: 'power2.out' }, 1.8)
}

watch(
  () => store.stage,
  () => {
    ringUniforms.uColor.value.set(store.stage.accent)
    particleUniforms.uColor.value.set(store.stage.accent)
    settle()
  },
)
const unregister = bridge.registerVisual(settle, replay)
useLoop().onBeforeRender(({ delta }) => {
  ringUniforms.uTime.value += delta
  particleUniforms.uTime.value += delta
  const instance = camera.value
  if (!instance) return
  instance.getWorldDirection(forward)
  ring.position.copy(forward).multiplyScalar(1.55)
  ring.quaternion.copy(instance.quaternion)
})
onMounted(() => {
  settle()
  emit('ready')
})
onScopeDispose(() => {
  unregister()
  timeline?.kill()
  particleGeometry.dispose()
  particleMaterial.dispose()
  ringGeometry.dispose()
  ringMaterial.dispose()
})
</script>

<template>
  <primitive :object="particles" :dispose="null" />
  <primitive :object="ring" :dispose="null" />
</template>
