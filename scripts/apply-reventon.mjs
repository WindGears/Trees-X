/* global URL, Headers, fetch, URLSearchParams, AbortSignal */
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { isDeepStrictEqual } from 'node:util'

const base = process.env.TREES_APPLY_API || 'http://127.0.0.1:8089'
const location = new URL(base)
if (
  !['127.0.0.1', 'localhost'].includes(location.hostname) ||
  !['http:', 'https:'].includes(location.protocol) ||
  location.username ||
  location.password ||
  location.search ||
  location.hash ||
  location.pathname !== '/'
)
  throw new Error('Only the local backend origin is supported')
let local = ''
try {
  local = await readFile('server/.env.local', 'utf8')
} catch (error) {
  if (error.code !== 'ENOENT') throw error
}
const env = Object.fromEntries(
  local
    .split(/\r?\n/)
    .filter((line) => /^TREES_ADMIN_/.test(line))
    .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
)
const jar = new Map()
// Jackson emits absent optional fields as null and may round a last decimal digit.
function comparable(value) {
  if (Array.isArray(value)) return value.map(comparable)
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== null && item !== undefined)
        .map(([key, item]) => [key, comparable(item)]),
    )
  return typeof value === 'number' ? Math.round(value * 1e12) / 1e12 : value
}
async function request(path, options = {}) {
  const headers = new Headers(options.headers)
  if (jar.size) headers.set('Cookie', [...jar].map(([key, value]) => key + '=' + value).join('; '))
  const response = await fetch(new URL(path, location), {
    ...options,
    headers,
    redirect: 'manual',
    signal: AbortSignal.timeout(30_000),
  })
  for (const entry of response.headers.getSetCookie()) {
    const cookie = entry.split(';')[0],
      index = cookie.indexOf('=')
    jar.set(cookie.slice(0, index), cookie.slice(index + 1))
  }
  if (!response.ok)
    throw new Error(
      'Backend rejected ' + path + ' (' + response.status + '): ' + (await response.text()),
    )
  return response.status === 204 ? null : response.json()
}
async function write(path, body, method = 'PUT') {
  const token = await request('/api/v1/admin/session/csrf')
  return request(path, {
    method,
    headers: { 'Content-Type': 'application/json', [token.headerName]: token.token },
    body: JSON.stringify(body),
  })
}
const model = JSON.parse(
  await readFile('server/src/main/resources/presentations/reventon-workbench-v1.json', 'utf8'),
)
if (model.slug !== 'reventon' || model.presentation.source.adapter !== 'reventon-v1')
  throw new Error('Expected the registered Reventon workbench configuration')
const token = await request('/api/v1/admin/session/csrf')
await request('/api/v1/admin/session/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded', [token.headerName]: token.token },
  body: new URLSearchParams({
    username: process.env.TREES_ADMIN_USERNAME || env.TREES_ADMIN_USERNAME || 'admin',
    password: process.env.TREES_ADMIN_PASSWORD || env.TREES_ADMIN_PASSWORD || '123456',
  }),
})
try {
  // This migration updates one existing record, never creates products or categories.
  const old = await request('/api/v1/admin/products/reventon')
  const typewriter = await request('/api/v1/admin/products/typewriter-study')
  const piano = await request('/api/v1/admin/products/piano-cfx')
  const body = {
    slug: old.item.slug,
    name: model.name,
    categoryId: old.item.categoryId,
    description: model.description,
    cover: process.env.TREES_CAR_COVER || old.item.cover,
    displayStatus: model.displayStatus,
    sortOrder: old.item.sortOrder,
    revision: old.item.revision,
    presentation: model.presentation,
  }
  await write('/api/v1/admin/products/preview', body, 'POST')
  if (process.env.TREES_APPLY !== '1')
    console.log(
      'Reventon presentation accepted; no product data written. Set TREES_APPLY=1 after runtime checks.',
    )
  else {
    const directory = resolve(
      'artifacts/reventon-migration/backups',
      new Date().toISOString().replaceAll(/[:.]/g, '-'),
    )
    await mkdir(directory, { recursive: true })
    await writeFile(
      resolve(directory, 'before.json'),
      JSON.stringify({ reventon: old, typewriter, piano }, null, 2),
    )
    const saved = await write('/api/v1/admin/products/reventon', body)
    const current = await request('/api/v1/admin/products/reventon')
    const currentTypewriter = await request('/api/v1/admin/products/typewriter-study')
    const currentPiano = await request('/api/v1/admin/products/piano-cfx')
    if (
      !isDeepStrictEqual(currentTypewriter, typewriter) ||
      !isDeepStrictEqual(currentPiano, piano)
    )
      throw new Error(
        'Another product changed during Reventon installation; inspect the saved backup',
      )
    if (
      current.item.listed !== old.item.listed ||
      current.item.categoryId !== old.item.categoryId ||
      current.item.cover !== body.cover ||
      current.item.sortOrder !== old.item.sortOrder ||
      current.presentation.source.adapter !== 'reventon-v1' ||
      current.presentation.hotspots.length !== 10 ||
      !isDeepStrictEqual(current.presentation.source.bundle, model.presentation.source.bundle) ||
      !isDeepStrictEqual(
        comparable(current.presentation.actions),
        comparable(model.presentation.actions),
      )
    )
      throw new Error(
        'Installed Reventon or preserved catalog fields do not match the expected state',
      )
    await writeFile(resolve(directory, 'after.json'), JSON.stringify(current, null, 2))
    console.log(
      JSON.stringify({
        applied: true,
        slug: current.item.slug,
        revision: saved.item.revision,
        hotspots: current.presentation.hotspots.length,
        homepage: 'typewriter-study (unchanged)',
        backup: directory,
      }),
    )
  }
} finally {
  await write('/api/v1/admin/session/logout', {}, 'POST')
}
