import type { Product } from '@/data/products'
import type { ModelStatus } from '@/stores/product'

export interface ModelSelection {
  readonly product: Product
  readonly revision: number
}
export interface ModelEvent {
  productId: string
  revision: number
  status?: ModelStatus
  error?: string
  visualReady?: boolean
  meshes?: string[]
}
export function isCurrentModel(event: ModelEvent, productId: string, revision: number) {
  return event.productId === productId && event.revision === revision
}
