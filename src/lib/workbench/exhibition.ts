import type { ProductSummary } from './types'

export interface ExhibitionOverviewItem {
  slug: string
  name: string
  description: string
  highlight: string
  cover: string
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
  ['typewriter-study', '按下一枚键，看看字杆如何被带动。', typewriterHero.whole],
  ['piano-cfx', '沿着键盘、击弦机构与弦列观察内部结构。', '/covers/showcase/piano-whole.webp'],
  ['reventon', '打开双门，从座舱近景观察车身结构。', carCover],
] as const

export function adminExhibitionSearch(search: string) {
  const query = new URLSearchParams(search)
  if (!query.size) query.set('renderPipeline', 'showcase')
  return query.toString()
}

export function exhibitionItems(products: ProductSummary[]): ExhibitionOverviewItem[] {
  return exhibits.flatMap(([slug, highlight, cover]) => {
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
