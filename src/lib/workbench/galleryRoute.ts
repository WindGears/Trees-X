/** Keep legacy stage readers and the host on the same explicit pipeline. */
export function galleryLocation(href: string, slug?: string) {
  const url = new URL(href)
  if (!url.searchParams.has('renderPipeline')) url.searchParams.set('renderPipeline', 'showcase')
  if (slug !== undefined) {
    if (slug) url.searchParams.set('product', slug)
    else url.searchParams.delete('product')
  }
  return url.pathname + url.search + url.hash
}
