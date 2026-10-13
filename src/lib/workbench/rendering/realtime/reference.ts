/** Frozen node-one lighting input; later comparisons must not retune individual branches. */
export const realtimeReference = {
  version: 1,
  environment: {
    url: '/textures/studio_small_05_1k.hdr',
    bytes: 1723695,
    sha256: '358d532ee8233f17499830eb512591c1e308ce16ed181e0efc938cb7f0f0e11f',
    intensity: 0.35,
    source: 'Poly Haven / Studio Small 05 / Greg Zaal / CC0',
  },
  exposure: 1,
  supplementalLights: { ambient: 0.16, key: 0, rim: 0 },
  productAndStage: 'linear HDR, one final ACES and sRGB conversion before SMAA',
  sky: 'linear studio gradient in the same HDR beauty; one final ACES and sRGB conversion',
  softboxes: 'studio/design.ts: shared window, key and rim RectAreaLights',
} as const
