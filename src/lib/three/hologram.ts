import { AdditiveBlending, Color, DoubleSide, Mesh, ShaderMaterial, Uniform } from 'three'
import type { Group } from 'three'

const controllers = new WeakMap<Group, HologramOverlay>()

const vertexShader = /* glsl */ `
  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;
  void main() {
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPosition.xyz;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`

const fragmentShader = /* glsl */ `
  uniform vec3 uColor;
  uniform float uScan;
  uniform float uOutline;
  uniform float uOpacity;
  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;
  void main() {
    vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
    float fresnel = pow(1.0 - abs(dot(normalize(vWorldNormal), viewDirection)), 2.35);
    float distanceToBand = abs(vWorldPosition.y - uScan);
    float scanBand = exp(-distanceToBand * distanceToBand * 52.0);
    float scanCore = exp(-distanceToBand * distanceToBand * 420.0);
    float strength = scanBand * 2.5 + scanCore * 4.0 + fresnel * uOutline;
    float alpha = clamp((scanBand * 0.56 + scanCore + fresnel * uOutline) * uOpacity, 0.0, 0.9);
    gl_FragColor = vec4(uColor * strength, alpha);
  }
`

export interface HologramOverlay {
  readonly meshes: readonly Mesh[]
  readonly material: ShaderMaterial
  setScan(value: number): void
  setOutline(value: number): void
  setOpacity(value: number): void
  setWireframe(value: boolean): void
  dispose(): void
}

/** Owns overlay meshes and one material. Original loader geometries remain untouched. */
export function createHologramOverlay(root: Group): HologramOverlay {
  const existing = controllers.get(root)
  if (existing) return existing
  const material = new ShaderMaterial({
    uniforms: {
      uColor: new Uniform(new Color('#78d9ff')),
      uScan: new Uniform(3),
      uOutline: new Uniform(0.08),
      uOpacity: new Uniform(0.14),
    },
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    blending: AdditiveBlending,
    toneMapped: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  })
  const sources: Mesh[] = []
  root.traverse((object) => {
    if (object instanceof Mesh && object.userData.hologram !== true) sources.push(object)
  })
  const meshes = sources.map((source) => {
    const overlay = new Mesh(source.geometry, material)
    overlay.name = `${source.name || 'mesh'}_Hologram`
    overlay.userData.hologram = true
    overlay.renderOrder = 8
    overlay.frustumCulled = source.frustumCulled
    source.add(overlay)
    return overlay
  })
  let disposed = false
  const controller: HologramOverlay = {
    meshes,
    material,
    setScan: (value) => {
      material.uniforms.uScan!.value = value
    },
    setOutline: (value) => {
      material.uniforms.uOutline!.value = value
    },
    setOpacity: (value) => {
      material.uniforms.uOpacity!.value = value
    },
    setWireframe: (value) => {
      material.wireframe = value
    },
    dispose() {
      if (disposed) return
      disposed = true
      for (const mesh of meshes) mesh.removeFromParent()
      material.dispose()
      controllers.delete(root)
    },
  }
  controllers.set(root, controller)
  return controller
}
