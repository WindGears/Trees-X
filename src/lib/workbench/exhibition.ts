import type { ProductSummary } from './types'

export interface ExhibitionPoster {
  name: string
  cover: string
  description?: string
}

export interface ExhibitionOverviewItem extends ExhibitionPoster {
  slug: string
  description: string
  highlight: string
  href: string
}

export const exhibitionHome = '/?renderPipeline=showcase'
export const typewriterHero = {
  whole: '/covers/showcase/typewriter-whole.webp',
  layers: '/covers/showcase/typewriter-layers.webp',
}

const carCover = import.meta.env.VITE_HAS_R18_EXHIBITION_COVER
  ? '/covers/showcase/reventon-whole.webp'
  : '/covers/workbench/reventon-real.png'
const exhibits = [
  ['typewriter-study', '机械打字机', '按下一枚键，看看字杆如何被带动。', typewriterHero.whole],
  [
    'piano-cfx',
    '三角钢琴',
    '沿着键盘、击弦机构与弦列观察内部结构。',
    '/covers/showcase/piano-whole.webp',
  ],
  ['reventon', 'Reventón 汽车', '打开双门，从座舱近景观察车身结构。', carCover],
] as const

export function exhibitionPoster(slug: string): ExhibitionPoster | undefined {
  const exhibit = exhibits.find(([id]) => id === slug)
  return exhibit ? { name: exhibit[1], cover: exhibit[3] } : undefined
}

export function adminExhibitionSearch(search: string) {
  const query = new URLSearchParams(search)
  if (!query.size) query.set('renderPipeline', 'showcase')
  return query.toString()
}

export function exhibitionItems(products: ProductSummary[]): ExhibitionOverviewItem[] {
  return exhibits.flatMap(([slug, , highlight, cover]) => {
    const product = products.find((item) => item.slug === slug)
    return product
      ? [
          {
            ...product,
            highlight,
            cover,
            href: exhibitionHome + '&product=' + encodeURIComponent(slug),
          },
        ]
      : []
  })
}

export function isLocalLink(event: MouseEvent) {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey
}
