import type { Product } from './products'

export const reventon: Product = {
  id: 'reventon',
  name: 'Reventón',
  label: '兰博基尼 Reventón',
  collection: '机械',
  category: '汽车 · 结构演示',
  description: '打开剪刀门，靠近座舱，再观察车门、车轮与后舱盖的分离和归位。',
  modelUrl: `${import.meta.env.BASE_URL}models/reventon/reventon.glb`,
  coverUrl: `${import.meta.env.BASE_URL}models/reventon/reference.jpg`,
  finish: '石墨车身',
  finishes: [
    {
      id: 'original',
      name: '原始外观',
      swatch: '#424440',
      color: [0.05, 0.05, 0.05],
      roughness: 0.24,
      original: true,
    },
  ],
  finishNode: '',
  hotspots: [],
  structure: [],
  experience: 'reventon',
}
