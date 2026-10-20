import { URL } from 'node:url'

export function localAuditOrigin(value) {
  const address = new URL(value)
  if (
    address.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(address.hostname) ||
    address.username ||
    address.password ||
    address.search ||
    address.hash ||
    address.pathname !== '/'
  )
    throw new Error('Audit origin must be local HTTP without credentials, path, query or hash')
  return address.origin
}
