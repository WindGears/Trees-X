<script setup lang="ts">
import { onScopeDispose } from 'vue'
import { Color, RectAreaLight, Vector3 } from 'three'
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js'
RectAreaLightUniformsLib.init()
const key = new RectAreaLight('#ffffff', 7, 6, 3)
key.position.set(-1, 4, -3)
key.lookAt(0, 0.5, 0)
const strip = new RectAreaLight('#ffffff', 4, 4, 1.2)
strip.position.set(3, 2, 1)
strip.lookAt(0, 0.5, 0)
onScopeDispose(() => {
  key.dispose()
  strip.dispose()
})
const lightPosition = new Vector3(-3, 6, 4)
const cameraPosition = new Vector3(6, 3, 7)
// An infinite studio sweep behind the real geometry and live contact projection.
const backdrop = {
  uniforms: {
    edge: { value: new Color('#939691') },
    center: { value: new Color('#dededb') },
  },
  vertexShader: `varying vec2 vUv;
    void main() { vUv = uv; gl_Position = vec4(position.xy, 0.9999, 1.0); }`,
  fragmentShader: `uniform vec3 edge; uniform vec3 center; varying vec2 vUv;
    void main() {
      vec2 p = (vUv - vec2(0.52, 0.50)) / vec2(0.56, 0.70);
      float light = exp(-1.7 * dot(p, p));
      gl_FragColor = vec4(mix(edge, center, light), 1.0);
      #include <colorspace_fragment>
    }`,
  depthTest: false,
  depthWrite: false,
  toneMapped: false,
}
const shadow = {
  'shadow-mapSize-width': 4096,
  'shadow-mapSize-height': 4096,
  'shadow-camera-left': -5,
  'shadow-camera-right': 5,
  'shadow-camera-top': 5,
  'shadow-camera-bottom': -5,
  'shadow-camera-near': 0.1,
  'shadow-camera-far': 20,
  'shadow-normalBias': 0.002,
  'shadow-bias': -0.00005,
  'shadow-radius': 4,
}
</script>

<template>
  <TresPerspectiveCamera :position="cameraPosition" :near="0.015" :far="80" />
  <primitive :object="key" :dispose="null" />
  <primitive :object="strip" :dispose="null" />
  <TresDirectionalLight :position="lightPosition" :intensity="0.25" cast-shadow v-bind="shadow" />
  <TresMesh :render-order="-1000" :frustum-culled="false">
    <TresPlaneGeometry :args="[2, 2]" />
    <TresShaderMaterial :args="[backdrop]" />
  </TresMesh>
</template>
