import {
  Matrix4,
  Shape,
  ShapeGeometry,
  Vector2,
  Vector4,
  type Scene,
  type ShaderMaterial,
} from 'three'
import { Reflector } from 'three/addons/objects/Reflector.js'
import { studioDesign } from './design'

/** A softened planar bounce layered over the physical pedestal, never a mirror floor. */
export function createStudioReflection(groundY: number = studioDesign.groundY) {
  const width = studioDesign.width - studioDesign.radius * 2
  const depth = studioDesign.depth - studioDesign.radius * 2
  const radius = studioDesign.radius
  const shape = new Shape()
  const x = -width / 2,
    y = -depth / 2
  shape.moveTo(x + radius, y)
  shape.lineTo(x + width - radius, y)
  shape.quadraticCurveTo(x + width, y, x + width, y + radius)
  shape.lineTo(x + width, y + depth - radius)
  shape.quadraticCurveTo(x + width, y + depth, x + width - radius, y + depth)
  shape.lineTo(x + radius, y + depth)
  shape.quadraticCurveTo(x, y + depth, x, y + depth - radius)
  shape.lineTo(x, y + radius)
  shape.quadraticCurveTo(x, y, x + radius, y)
  const geometry = new ShapeGeometry(shape, 12)
  const reflection = new Reflector(geometry, {
    textureWidth: 1024,
    textureHeight: 1024,
    clipBias: 0.0015,
    multisample: 4,
    shader: {
      name: 'TreesXStudioSoftReflection',
      uniforms: {
        tDiffuse: { value: null },
        color: { value: null },
        textureMatrix: { value: new Matrix4() },
        texelSize: { value: new Vector2(1 / 1024, 1 / 1024) },
        strength: { value: 0.28 },
      },
      vertexShader: `uniform mat4 textureMatrix; varying vec4 vReflectionUv;
        varying vec3 vWorldPosition; varying vec3 vWorldNormal;
        #include <common>
        #include <logdepthbuf_pars_vertex>
        void main() {
          vReflectionUv = textureMatrix * vec4(position, 1.0);
          vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
          vWorldNormal = normalize(mat3(modelMatrix) * normal);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          #include <logdepthbuf_vertex>
        }`,
      fragmentShader: `uniform sampler2D tDiffuse; uniform vec2 texelSize;
        uniform float strength; varying vec4 vReflectionUv;
        varying vec3 vWorldPosition; varying vec3 vWorldNormal;
        #include <logdepthbuf_pars_fragment>
        void main() {
          #include <logdepthbuf_fragment>
          vec2 uv = vReflectionUv.xy / vReflectionUv.w;
          const float weights[5] = float[5](1.0, 4.0, 6.0, 4.0, 1.0);
          vec2 stepSize = texelSize * 1.5;
          vec3 reflected = vec3(0.0);
          for (int y = 0; y < 5; y++) {
            for (int x = 0; x < 5; x++) {
              vec2 offset = vec2(float(x - 2), float(y - 2)) * stepSize;
              reflected += texture2D(tDiffuse, uv + offset).rgb * weights[x] * weights[y] / 256.0;
            }
          }
          float grazing = pow(1.0 - abs(dot(normalize(cameraPosition - vWorldPosition), normalize(vWorldNormal))), 3.0);
          float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0) * step(0.0, vReflectionUv.w);
          gl_FragColor = vec4(reflected, strength * mix(0.45, 1.0, grazing) * inside);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    },
  })
  reflection.name = 'Trees X / studio reflection'
  reflection.rotation.x = -Math.PI / 2
  reflection.position.y = groundY + 0.00035
  const material = reflection.material as ShaderMaterial
  material.transparent = true
  material.depthWrite = false
  reflection.renderOrder = 1
  const render = reflection.onBeforeRender
  const viewport = new Vector4(),
    scissor = new Vector4()
  // Reflector's built-in fast path restores its target, but an interrupted draw
  // also needs exception-safe viewport/XR/shadow restoration for the shared host.
  reflection.onBeforeRender = function (renderer, scene, camera, geometry, material, group) {
    const target = renderer.getRenderTarget()
    const cubeFace = renderer.getActiveCubeFace(),
      mip = renderer.getActiveMipmapLevel()
    renderer.getViewport(viewport)
    renderer.getScissor(scissor)
    const scissorTest = renderer.getScissorTest()
    const xr = renderer.xr.enabled,
      shadow = renderer.shadowMap.autoUpdate
    const visible = reflection.visible
    try {
      render.call(reflection, renderer, scene, camera, geometry, material, group)
    } finally {
      reflection.visible = visible
      renderer.xr.enabled = xr
      renderer.shadowMap.autoUpdate = shadow
      renderer.setRenderTarget(target, cubeFace, mip)
      renderer.setViewport(viewport)
      renderer.setScissor(scissor)
      renderer.setScissorTest(scissorTest)
    }
  }
  let disposed = false
  return {
    reflection,
    attach(scene: Scene) {
      scene.add(reflection)
    },
    dispose() {
      if (disposed) return
      disposed = true
      reflection.removeFromParent()
      reflection.dispose()
      geometry.dispose()
    },
  }
}
