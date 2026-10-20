import assert from 'node:assert/strict'
import { test } from 'node:test'
import { localAuditOrigin } from './audit-origin.mjs'

test('audit origins accept only local HTTP origins, including IPv6 loopback', () => {
  for (const hostname of ['127.0.0.1', 'localhost', '[::1]']) {
    const origin = `http://${hostname}:5181`
    assert.equal(localAuditOrigin(origin), origin)
    assert.equal(localAuditOrigin(origin + '/'), origin)
  }
})

test('credentials, nonroot paths, queries, hashes and remote origins are rejected without echo', () => {
  for (const value of [
    'http://admin:private-password@localhost:5181',
    'http://admin@localhost:5181',
    'http://localhost:5181/admin',
    'http://localhost:5181/?token=private-token',
    'http://localhost:5181/#private-token',
    'https://localhost:5181',
    'http://example.com:5181',
    'http://127.0.0.2:5181',
  ])
    assert.throws(
      () => localAuditOrigin(value),
      (error) => {
        assert.match(error.message, /local HTTP without/)
        assert.doesNotMatch(error.message, /private-|admin@/)
        return true
      },
    )
})
