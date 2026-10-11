export type LabMode = 'webgl' | 'webgpu' | 'pathtrace'
export type LabView = 'whole' | 'paint' | 'metal' | 'layers' | 'flat'
export type LabPhase = 'loading' | 'rendering' | 'ready' | 'paused' | 'error' | 'disposed'

export const labSettings = {
  version: 1,
  product: 'typewriter-study',
  environment: '/textures/studio_small_05_1k.hdr',
  environmentIntensity: 0.35,
  background: '#dfe4df',
  exposure: 1,
  toneMapping: 'ACESFilmicToneMapping',
  outputColorSpace: 'srgb',
  dpr: 1,
  fov: 38,
  near: 0.01,
  far: 100,
  zoom: 0.9375,
  viewOffset: { x: -58, y: 16 },
  metalHotspot: 'part-046',
  paintHotspot: 'part-095',
  geometryPreparation: {
    version: 1,
    attributes: ['normal', 'tangent'],
    index: 'identity only when absent',
    tangent: 'Three computeTangents for complete UV; zero vector otherwise',
    uv: 'source only; never generated',
  },
  pathtrace: {
    maxBounces: 12,
    maxTransparentBounces: 12,
    frameBudget: 1000000,
    renderScale: 1,
    dynamicLowRes: false,
    filterGlossyFactor: 0,
    clampDirect: 0,
    clampIndirect: 0,
    generateMissingAttributes: false,
    denoising: false,
    upscaling: false,
    stableNoise: true,
  },
  differencesFromProduction: [
    'Self-hosted Studio Small 05 HDR replaces the authored softbox-capture PMREM.',
    'Constant native Color background; no GLSL skybox or floor fade.',
    'Same physical pedestal and floor, without planar Reflector or contact-shadow shader.',
    'Only the shared three RectAreaLights; no production ambient or directional fill.',
    'All material envMapIntensity values normalized to 1; AO maps disabled in all modes.',
    'Unlit source decals become rough standard PBR in all modes; original maps remain.',
    'No DOM panels; each mode uses the same whole-view projection offset for all views.',
    'Raster modes have no RectAreaLight shadow maps or ray-traced interreflection.',
    'Path-traced material model and raster PBR may differ despite identical material inputs.',
    'Raw GLB meshes are not production InstancedMesh batches. The three lab modes share geometry; their draw counts are not a production performance comparison.',
    'Geometry attributes are prepared once for every mode. Missing UVs remain missing; only surfaces with source UVs receive calculated tangents.',
    'Path tracing has no direct or indirect energy clamp, denoising or upscaling; finite-sample noise and fireflies remain possible.',
  ],
} as const

export function readLabRequest(search: string) {
  const query = new URLSearchParams(search)
  const mode = query.get('mode') ?? 'webgl',
    view = query.get('view') ?? 'whole',
    samples = Number(query.get('samples') ?? 128)
  if (!['webgl', 'webgpu', 'pathtrace'].includes(mode)) throw new Error('未知渲染模式')
  if (!['whole', 'paint', 'metal', 'layers', 'flat'].includes(view)) throw new Error('未知观察内容')
  if (!Number.isInteger(samples) || samples < 1 || samples > 1024)
    throw new Error('样本数须为 1–1024 的整数')
  return { mode: mode as LabMode, view: view as LabView, samples }
}

export type LabRequest = ReturnType<typeof readLabRequest>
