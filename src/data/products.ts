export interface ProductPart {
  id: string
  node: string
  name: string
  description: string
  cameraOffset: [number, number, number]
  face: 'front' | 'top' | 'any'
  localPoint?: [number, number, number]
}

export interface ProductFinish {
  id: string
  name: string
  swatch: string
  color: [number, number, number]
  roughness: number
  original?: boolean
}

export type Vec3 = [number, number, number]
export interface CameraPose {
  position: Vec3
  target?: Vec3
}
export interface ProductStage {
  kind: 'metal' | 'play' | 'botanical' | 'neutral'
  accent: string
  keyColor: string
  fillColor: string
  rimColor: string
  keyIntensity: number
  fillIntensity: number
  rimIntensity: number
  environmentIntensity: number
  ringOpacity: number
  bloom: number
}
export interface ProductStoryStep {
  title: string
  description: string
  partId?: string
  view?: 'perspective' | 'front' | 'back' | 'structure'
}

export interface Product {
  collection?: '数码' | '家居' | '潮玩' | '机械'
  /** study=独立研究体验（自带 Canvas 与交互，不走 GLB 管线） */
  experience?: 'study'
  coverUrl?: string
  label?: string
  source?: { author: string; url: string; license: string }
  structureSpace?: 'world'
  camera?: Partial<Record<'perspective' | 'front' | 'back' | 'structure', Vec3 | CameraPose>>
  zoomRange?: [number, number]
  featuredRank?: number
  stage?: ProductStage
  storySteps?: ProductStoryStep[]
  hotspots: ProductPart[]
  finishes: ProductFinish[]
  finishNode: string
  structure: { nodes: string[]; offset: [number, number, number] }[]
  id: string
  name: string
  category: string
  modelUrl: string
  finish: string
  description: string
}

export const demoProduct: Product = {
  finishNode: 'Chassis',
  finishes: [
    { id: 'silver', name: '雾银', swatch: '#b7bdc9', color: [0.58, 0.61, 0.66], roughness: 0.3 },
    { id: 'graphite', name: '石墨', swatch: '#545964', color: [0.11, 0.13, 0.17], roughness: 0.36 },
    { id: 'champagne', name: '香槟', swatch: '#c7b49b', color: [0.66, 0.5, 0.32], roughness: 0.32 },
  ],
  structure: [
    {
      nodes: ['Front_Baffle', 'Indicator', ...[0, 1, 2, 3].map((i) => `Front_Fastener_${i}`)],
      offset: [0, 0, 0.28],
    },
    {
      nodes: ['Woofer_Frame', 'Woofer_Bed', 'Woofer_Surround', 'Woofer_Cone', 'Woofer_Dustcap'],
      offset: [-0.28, -0.08, 0.95],
    },
    { nodes: ['Tweeter_Frame', 'Tweeter_Surround', 'Tweeter_Dome'], offset: [0.3, 0.12, 0.85] },
    {
      nodes: ['Volume_Base', 'Volume_Dial', ...[0, 1, 2, 3].map((i) => `Dial_Groove_${i}`)],
      offset: [0, 0.4, 0],
    },
    { nodes: ['Rear_Panel', 'Rear_Port_Rim', 'Rear_Port', 'Rear_Connector'], offset: [0, 0, -0.6] },
    { nodes: ['Base'], offset: [0, -0.25, 0] },
  ],
  hotspots: [
    {
      id: 'woofer',
      node: 'Woofer_Frame',
      name: '低音单元',
      cameraOffset: [0, 0.15, 3.6],
      face: 'front',
      description:
        '概念模型中的低音单元由金属压圈、柔性悬边和振膜组成，用于展示层次与材质，不代表真实声学参数。',
    },
    {
      id: 'tweeter',
      node: 'Tweeter_Frame',
      name: '高音单元',
      cameraOffset: [0.35, 0.15, 3.6],
      face: 'front',
      description:
        '上方的小型圆形单元以金属边框和深色球顶形成对比。这里展示外观造型，不代表真实频响或发声性能。',
    },
    {
      id: 'dial',
      node: 'Volume_Dial',
      name: '顶部旋钮',
      cameraOffset: [1.4, 2.2, 2.6],
      face: 'top',
      description:
        '顶部旋钮保留四道环形凹槽，便于观察金属在不同角度下的反射。当前为造型展示，不连接音量控制。',
    },
  ],
  id: 'form-01',
  name: 'FORM / 01',
  category: '桌面音箱 · 概念设计',
  modelUrl: `${import.meta.env.BASE_URL}models/form-01.glb`,
  finish: '银色铝合金',
  description: '简洁的轮廓，藏着值得靠近的细节。转动视角，让材质与光线自己说话。',
}
