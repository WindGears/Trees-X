import { BackSide, BoxGeometry, Color, Mesh, ShaderMaterial } from 'three'
import { studioDesign } from './design'

/** A translation-free, direction-shaded skybox; no finite wall or per-face seam. */
export function createStudioBackdrop(intensity = 1) {
  const geometry = new BoxGeometry(2, 2, 2)
  const material = new ShaderMaterial({
    name: 'TreesXStudioSkybox',
    uniforms: {
      topColor: { value: new Color(studioDesign.backdrop.top).multiplyScalar(intensity) },
      middleColor: { value: new Color(studioDesign.backdrop.middle).multiplyScalar(intensity) },
      bottomColor: { value: new Color(studioDesign.backdrop.bottom).multiplyScalar(intensity) },
    },
    vertexShader: `varying vec3 vStudioDirection;
      void main() {
        vStudioDirection = position;
        vec4 projected = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
        gl_Position = projected.xyww;
      }`,
    fragmentShader: `uniform vec3 topColor; uniform vec3 middleColor; uniform vec3 bottomColor;
      varying vec3 vStudioDirection;
      void main() {
        float elevation = normalize(vStudioDirection).y;
        vec3 upper = mix(middleColor, topColor, smoothstep(0.0, 0.85, elevation));
        vec3 color = mix(upper, bottomColor, smoothstep(0.0, 0.85, -elevation));
        gl_FragColor = vec4(color, 1.0);
        #include <colorspace_fragment>
      }`,
    side: BackSide,
    depthWrite: false,
    toneMapped: false,
    fog: false,
  })
  const mesh = new Mesh(geometry, material)
  mesh.name = 'Trees X / studio skybox'
  mesh.frustumCulled = false
  mesh.renderOrder = -1000
  let disposed = false
  return {
    mesh,
    dispose() {
      if (disposed) return
      disposed = true
      mesh.removeFromParent()
      geometry.dispose()
      material.dispose()
    },
  }
}
