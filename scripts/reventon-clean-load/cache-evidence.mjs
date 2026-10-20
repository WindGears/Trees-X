import { URL } from 'node:url'

const cacheHeaderNames = new Set(['cache-control', 'etag', 'content-length'])

/** Never persist cookies, authorization, raw header blocks or other response metadata. */
export function cacheHeaders(headers = {}) {
  return Object.fromEntries(
    Object.entries(headers)
      .map(([key, value]) => [key.toLowerCase(), String(value)])
      .filter(([key]) => cacheHeaderNames.has(key)),
  )
}

export function cacheEvidence(network, extraResponses) {
  const model = network.filter((entry) => {
    const path = new URL(entry.url).pathname
    return path.startsWith('/models/reventon/') || path.startsWith('/models/reventon-runtime-v2/')
  })
  const ids = new Set(model.map((entry) => entry.requestId))
  return {
    modelRequests: model.length,
    modelDiskCacheResponses: model.filter((entry) => entry.fromDiskCache).length,
    modelServedFromCacheEvents: model.filter((entry) => entry.servedFromCache).length,
    modelNotModifiedResponses: extraResponses.filter(
      (entry) => ids.has(entry.requestId) && entry.statusCode === 304,
    ).length,
    modelEncodedDataLengthBytes: model.reduce(
      (sum, entry) => sum + (entry.encodedDataLength ?? 0),
      0,
    ),
    meaning:
      '304 counts come only from CDP responseReceivedExtraInfo statusCode, not the cache-normalized responseReceived status. EncodedDataLength includes network protocol overhead; it is not decoded texture bytes. Zero cache hits or 304s are retained as observed, not inferred to mean a successful warm cache.',
  }
}
