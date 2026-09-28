import type { Vec3 } from './products'

export type FilmChapter = 'detail' | 'hero' | 'layers'
export interface FilmShot {
  chapter: FilmChapter
  title: string
  description: string
  position: Vec3
  target: Vec3
}
export const speakerFilm: FilmShot[] = [
  {
    chapter: 'detail',
    title: '光，沿着金属走。',
    description: '靠近旋钮，看见凹槽与细密的反射。',
    position: [0.94, 1.94, 1.05],
    target: [0.4, 1.34, 0.02],
  },
  {
    chapter: 'hero',
    title: '声音，也有轮廓。',
    description: '银色外壳、深色振膜，留给光线不同的表情。',
    position: [3.5, 1.1, 5.4],
    target: [0, -0.05, 0.05],
  },
  {
    chapter: 'layers',
    title: '让层次，慢慢浮现。',
    description: '外观部件在空间中分开，显露彼此的位置。',
    position: [5.1, 2.1, 6.1],
    target: [0, -0.06, 0.4],
  },
]
export function filmFor(productId: string) {
  return productId === 'form-01' ? speakerFilm : undefined
}
