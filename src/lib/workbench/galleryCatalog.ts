import type { ProductSummary } from './types'
import { exhibitionPoster } from './exhibition'

export const legacyExhibitSlugs = new Set([
  'gamepad',
  'gaming-console',
  'oak-side-table',
  'potted-plant',
  'home-furniture-set',
  'toy-racer',
])

export interface GalleryItem extends ProductSummary {
  cover: string
}

/** Public API controls availability; curated artwork never limits membership. */
export function galleryItems(products: readonly ProductSummary[]): GalleryItem[] {
  return products
    .filter((item) => item.displayStatus === 'formal' && !legacyExhibitSlugs.has(item.slug))
    .map((item) => ({
      ...item,
      cover:
        item.slug === 'typewriter-study'
          ? '/covers/museum/typewriter-whole.webp'
          : (exhibitionPoster(item.slug)?.cover ?? item.cover ?? ''),
    }))
}

export function filterGallery(items: readonly GalleryItem[], query: string, category: string) {
  const term = query.trim().toLocaleLowerCase()
  return items.filter(
    (item) =>
      (!category || item.category === category) &&
      (!term || `${item.name} ${item.description}`.toLocaleLowerCase().includes(term)),
  )
}
