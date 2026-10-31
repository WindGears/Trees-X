/** Artistic display studies, not OEM color formulas or measured flake BRDFs.
 * Values are frozen for same-room comparisons. No extra texture, shader or pass.
 * Matte retains a rough outer coating; orange uses a smoother dielectric coat
 * over a colored base. Metalness is only an aggregate shading approximation. */
export const carPaintStudies = {
  graphite: {
    color: '#484b4f',
    roughness: 0.3,
    clearcoat: 0.65,
    clearcoatRoughness: 0.13,
  },
  metallic: {
    color: '#7b7e83',
    metalness: 0.65,
    roughness: 0.3,
    clearcoat: 0.65,
    clearcoatRoughness: 0.13,
  },
  matte: {
    color: '#777b79',
    metalness: 0.35,
    roughness: 0.44,
    clearcoat: 1,
    clearcoatRoughness: 0.42,
  },
  orange: {
    color: '#e96708',
    metalness: 0.2,
    roughness: 0.32,
    clearcoat: 1,
    clearcoatRoughness: 0.09,
  },
} as const

export type CarPaintStudy = keyof typeof carPaintStudies

export function isCarPaintStudy(value: unknown): value is CarPaintStudy {
  return typeof value === 'string' && Object.hasOwn(carPaintStudies, value)
}
