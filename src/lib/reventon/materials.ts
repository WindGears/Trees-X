import { Mesh, MeshPhysicalMaterial, ShaderChunk } from 'three'
import type { Group } from 'three'

/** Preserve the recovered clear, zero-thickness glazing in Three's PBR pipeline. */
export function prepareReventonMaterials(model: Group) {
  model.traverse((object) => {
    if (!(object instanceof Mesh)) return
    const material = object.material
    if (!(material instanceof MeshPhysicalMaterial)) return
    if (!/\/ (15103|21865)$/.test(material.name)) return
    // The recovered studio plus runtime area lights overexpose the source's
    // thin glazing. Calibrate reflection strength while retaining physical
    // transmission and angle-dependent Fresnel (not an opacity substitute).
    material.specularIntensity = 0.22
    // Geometry-derivative roughness antialiases reflections, but must not turn a
    // smooth thin pane into frosted volume transmission at triangle boundaries.
    material.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <transmission_fragment>',
        ShaderChunk.transmission_fragment.replace(
          'n, v, material.roughness,',
          'n, v, roughnessFactor,',
        ),
      )
    }
    material.customProgramCacheKey = () => 'reventon-clear-thin-glass-v1'
    material.needsUpdate = true
  })
}
