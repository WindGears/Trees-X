import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cacheEvidence, cacheHeaders } from './cache-evidence.mjs'

test('response evidence retains only explicitly allowed cache headers regardless of casing', () => {
  assert.deepEqual(
    cacheHeaders({
      'Cache-Control': 'no-cache',
      ETag: 'W/"example"',
      'CONTENT-LENGTH': 120,
      'Set-Cookie': 'private-session',
      Authorization: 'private-token',
      'WWW-Authenticate': 'private-challenge',
    }),
    { 'cache-control': 'no-cache', etag: 'W/"example"', 'content-length': '120' },
  )
  assert.deepEqual(cacheHeaders(), {})
})

test('real network 304 evidence stays distinct from cache-normalized 200 responses', () => {
  const network = [
    {
      requestId: 'original',
      url: 'http://127.0.0.1:5181/models/reventon/a.png',
      status: 200,
      encodedDataLength: 300,
    },
    {
      requestId: 'candidate',
      url: 'http://127.0.0.1:5181/models/reventon-runtime-v2/a.ktx2',
      fromDiskCache: true,
      servedFromCache: true,
      encodedDataLength: 0,
    },
    { requestId: 'script', url: 'http://127.0.0.1:5181/assets/app.js', encodedDataLength: 400 },
  ]
  const result = cacheEvidence(network, [
    { requestId: 'original', statusCode: 304 },
    { requestId: 'script', statusCode: 304 },
  ])
  assert.equal(result.modelRequests, 2)
  assert.equal(result.modelNotModifiedResponses, 1)
  assert.equal(result.modelDiskCacheResponses, 1)
  assert.equal(result.modelServedFromCacheEvents, 1)
  assert.equal(result.modelEncodedDataLengthBytes, 300)
})

test('a repeated full transfer with no cache evidence is reported honestly as zero cache reuse', () => {
  const result = cacheEvidence(
    [{ requestId: 'full', url: 'http://localhost/models/reventon/a.png', status: 200 }],
    [],
  )
  assert.equal(result.modelNotModifiedResponses, 0)
  assert.equal(result.modelDiskCacheResponses, 0)
  assert.equal(result.modelServedFromCacheEvents, 0)
})
