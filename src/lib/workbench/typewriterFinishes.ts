import type { MeshStandardMaterial } from 'three'

// Owner's source material treatment. glTF preserves PBR values and textures;
// these object-space microfinishes are registered code, never database scripts.
export function applyTypewriterFinishes(materials: Set<MeshStandardMaterial>, scale = 1) {
  const metals = new Set(['steel', 'chrome', 'iron', 'edge', 'goldEdge', 'goldChrome'])
  for (const material of materials) {
    const intensity: unknown = material.userData.sourceEnvMapIntensity
    if (typeof intensity === 'number' && Number.isFinite(intensity))
      material.envMapIntensity = intensity
    if (material.name === 'enamel') {
      material.customProgramCacheKey = () => 'trees-typewriter-enamel-v1'
      material.onBeforeCompile = (shader) => {
        shader.uniforms.typewriterWorldScale = { value: scale }
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nvarying vec3 vEnamelFinish;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\nvEnamelFinish=position;')
        shader.fragmentShader = shader.fragmentShader
          .replace(
            '#include <common>',
            `#include <common>
varying vec3 vEnamelFinish;
uniform float typewriterWorldScale;
float enamelHash(vec3 p){p=fract(p*.3183099+vec3(.13,.71,.37));p*=17.0;return fract(p.x*p.y*p.z*(p.x+p.y+p.z));}
float enamelNoise(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(mix(enamelHash(i),enamelHash(i+vec3(1,0,0)),f.x),mix(enamelHash(i+vec3(0,1,0)),enamelHash(i+vec3(1,1,0)),f.x),f.y),mix(mix(enamelHash(i+vec3(0,0,1)),enamelHash(i+vec3(1,0,1)),f.x),mix(enamelHash(i+vec3(0,1,1)),enamelHash(i+vec3(1,1,1)),f.x),f.y),f.z);}
float enamelRelief(vec3 p){float footprint=max(length(dFdx(p)),length(dFdy(p)));float grain=enamelNoise(p*64.0+enamelNoise(p*21.0)*1.3);float pore=enamelNoise(p*147.0);return typewriterWorldScale*((grain-.5)*.0007*(1.0-smoothstep(.009,.030,footprint))+(pore-.5)*.00015*(1.0-smoothstep(.003,.011,footprint)));}
`,
          )
          .replace(
            '#include <roughnessmap_fragment>',
            `#include <roughnessmap_fragment>
float enamelVariation=enamelNoise(vEnamelFinish*4.3);
roughnessFactor=clamp(roughnessFactor+(enamelVariation-.5)*.020,.33,.43);
diffuseColor.rgb*=.985+enamelVariation*.025;
`,
          )
          .replace(
            '#include <normal_fragment_maps>',
            `#include <normal_fragment_maps>
float enamelHeight=enamelRelief(vEnamelFinish);
vec3 enamelDx=dFdx(-vViewPosition),enamelDy=dFdy(-vViewPosition);
vec3 enamelR1=cross(enamelDy,normal),enamelR2=cross(normal,enamelDx);
float enamelDet=dot(enamelDx,enamelR1)*faceDirection;
vec3 enamelGradient=sign(enamelDet)*(dFdx(enamelHeight)*enamelR1+dFdy(enamelHeight)*enamelR2);
normal=normalize(max(abs(enamelDet),1e-7)*normal-enamelGradient);
`,
          )
      }
    } else if (metals.has(material.name)) {
      material.customProgramCacheKey = () => 'trees-typewriter-metal-v1'
      material.onBeforeCompile = (shader) => {
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nvarying vec3 vFinish;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFinish=position;')
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', '#include <common>\nvarying vec3 vFinish;')
          .replace(
            '#include <roughnessmap_fragment>',
            '#include <roughnessmap_fragment>\nfloat linePhase=vFinish.x*950.0+sin(vFinish.z*13.0)*2.0;float band=sin(linePhase)*(1.0-smoothstep(.65,2.0,fwidth(linePhase)));roughnessFactor=clamp(roughnessFactor+band*.065,.16,.95);',
          )
      }
    }
  }
}
