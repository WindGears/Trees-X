import { MeshPhysicalMaterial, type MeshStandardMaterial } from 'three'

// The loader owns these materials and textures. Finishes only tune their existing
// PBR layers and install deterministic object-space microstructure; no cloning.
const paint = new Map([
  ['enamel', { roughness: 0.26, clearcoat: 0.76, coatRoughness: 0.15 }],
  ['shellGloss', { roughness: 0.21, clearcoat: 0.84, coatRoughness: 0.12 }],
  ['shellRim', { roughness: 0.33, clearcoat: 0.36, coatRoughness: 0.22 }],
])
const metal = new Map([
  ['steel', { roughness: 0.29, anisotropy: 0, variation: 0.018 }],
  ['chrome', { roughness: 0.17, anisotropy: 0.12, variation: 0.009 }],
  ['iron', { roughness: 0.44, anisotropy: 0, variation: 0.025 }],
  ['edge', { roughness: 0.23, anisotropy: 0.22, variation: 0.014 }],
  ['goldEdge', { roughness: 0.27, anisotropy: 0.2, variation: 0.014 }],
  ['goldChrome', { roughness: 0.19, anisotropy: 0.1, variation: 0.009 }],
])
const microstructure = `
varying vec3 vTypewriterFinish;
uniform float typewriterWorldScale;
float typewriterHash(vec3 p){p=fract(p*.3183099+vec3(.13,.71,.37));p*=17.0;return fract(p.x*p.y*p.z*(p.x+p.y+p.z));}
float typewriterNoise(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(mix(typewriterHash(i),typewriterHash(i+vec3(1,0,0)),f.x),mix(typewriterHash(i+vec3(0,1,0)),typewriterHash(i+vec3(1,1,0)),f.x),f.y),mix(mix(typewriterHash(i+vec3(0,0,1)),typewriterHash(i+vec3(1,0,1)),f.x),mix(typewriterHash(i+vec3(0,1,1)),typewriterHash(i+vec3(1,1,1)),f.x),f.y),f.z);}
float typewriterPaintRelief(vec3 p){float footprint=max(length(dFdx(p)),length(dFdy(p)));float grain=typewriterNoise(p*64.0+typewriterNoise(p*21.0)*1.3);float pore=typewriterNoise(p*147.0);return typewriterWorldScale*((grain-.5)*.00008*(1.0-smoothstep(.009,.030,footprint))+(pore-.5)*.000018*(1.0-smoothstep(.003,.011,footprint)));}
`

export function applyTypewriterFinishes(materials: Set<MeshStandardMaterial>, scale = 1) {
  const worldScale = Number.isFinite(scale) && scale > 0 ? scale : 1
  for (const material of materials) {
    const intensity: unknown = material.userData.sourceEnvMapIntensity
    if (typeof intensity === 'number' && Number.isFinite(intensity))
      material.envMapIntensity = intensity
    const paintProfile = paint.get(material.name),
      metalProfile = metal.get(material.name)
    if (!paintProfile && !metalProfile) continue // Decals, keys, ribbon and rubber remain intact.
    material.roughness = paintProfile?.roughness ?? metalProfile!.roughness
    if (material instanceof MeshPhysicalMaterial) {
      if (paintProfile) {
        // Paint is a dielectric coat over metal; its visible base is not bare metal.
        material.metalness = 0.035
        material.clearcoat = paintProfile.clearcoat
        material.clearcoatRoughness = paintProfile.coatRoughness
      } else {
        // All these source meshes have UVs except steel/iron, kept isotropic.
        material.anisotropy = metalProfile!.anisotropy
        material.anisotropyRotation = Math.PI / 2
      }
    }
    const cacheKey = paintProfile ? 'trees-typewriter-paint-v2' : 'trees-typewriter-metal-v2'
    if (material.customProgramCacheKey() !== cacheKey) material.needsUpdate = true
    material.customProgramCacheKey = () => cacheKey
    material.onBeforeCompile = (shader) => {
      shader.uniforms.typewriterWorldScale = { value: worldScale }
      shader.uniforms.typewriterFinishVariation = { value: metalProfile?.variation ?? 0.014 }
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vTypewriterFinish;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTypewriterFinish=position;')
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <common>',
        '#include <common>\n' + microstructure + '\nuniform float typewriterFinishVariation;',
      )
      if (paintProfile) {
        shader.fragmentShader = shader.fragmentShader
          .replace(
            '#include <roughnessmap_fragment>',
            `#include <roughnessmap_fragment>
float paintVariation=typewriterNoise(vTypewriterFinish*4.3);
roughnessFactor=clamp(roughnessFactor+(paintVariation-.5)*.014,.12,.95);
`,
          )
          .replace(
            '#include <normal_fragment_maps>',
            `#include <normal_fragment_maps>
float paintHeight=typewriterPaintRelief(vTypewriterFinish);
vec3 paintDx=dFdx(-vViewPosition),paintDy=dFdy(-vViewPosition);
vec3 paintR1=cross(paintDy,normal),paintR2=cross(normal,paintDx);
float paintDet=dot(paintDx,paintR1)*faceDirection;
vec3 paintGradient=sign(paintDet)*(dFdx(paintHeight)*paintR1+dFdy(paintHeight)*paintR2);
normal=normalize(max(abs(paintDet),1e-7)*normal-paintGradient);
`,
          )
      } else {
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <roughnessmap_fragment>',
          `#include <roughnessmap_fragment>
float linePhase=vTypewriterFinish.x*950.0+sin(vTypewriterFinish.z*13.0)*2.0;
float brushBand=sin(linePhase)*(1.0-smoothstep(.65,2.0,fwidth(linePhase)));
roughnessFactor=clamp(roughnessFactor+brushBand*typewriterFinishVariation,.12,.95);
`,
        )
      }
    }
  }
}
