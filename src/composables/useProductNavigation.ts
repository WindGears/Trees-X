import { onMounted, onScopeDispose, watch } from 'vue'
import { useProductStore } from '@/stores/product'

/** Query-based navigation keeps product links and browser Back without replacing the Canvas. */
export function useProductNavigation() {
  const store = useProductStore()
  let reading = false
  function read() {
    reading = true
    const id = new URL(window.location.href).searchParams.get('product') ?? 'form-01'
    if (!store.selectProduct(id)) store.catalogOpen = true
    reading = false
  }
  onMounted(() => {
    read()
    window.addEventListener('popstate', read)
  })
  watch(
    () => store.product.id,
    (id) => {
      document.title = `${store.product.label ?? store.product.name} · Trees X`
      if (reading) return
      const url = new URL(window.location.href)
      url.searchParams.set('product', id)
      window.history.pushState(null, '', url)
    },
    { flush: 'sync' },
  )
  onScopeDispose(() => window.removeEventListener('popstate', read))
}
