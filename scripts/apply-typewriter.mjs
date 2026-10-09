/* global URL, Headers, fetch, URLSearchParams */
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
const base = process.env.TREES_APPLY_API || 'http://127.0.0.1:8089'
if (!['127.0.0.1', 'localhost'].includes(new URL(base).hostname))
  throw new Error('Local backend only')
const env = Object.fromEntries(
  (await readFile('server/.env.local', 'utf8'))
    .split(/\r?\n/)
    .filter((line) => /^TREES_ADMIN_/.test(line))
    .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
)
const jar = new Map()
async function request(path, options = {}) {
  const headers = new Headers(options.headers)
  if (jar.size) headers.set('Cookie', [...jar].map(([key, value]) => key + '=' + value).join('; '))
  const response = await fetch(base + path, { ...options, headers, redirect: 'manual' })
  for (const entry of response.headers.getSetCookie()) {
    const cookie = entry.split(';')[0],
      index = cookie.indexOf('=')
    jar.set(cookie.slice(0, index), cookie.slice(index + 1))
  }
  if (!response.ok) throw new Error('Backend rejected ' + path + ' (' + response.status + ')')
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
const token = await request('/api/v1/admin/session/csrf')
await request('/api/v1/admin/session/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded', [token.headerName]: token.token },
  body: new URLSearchParams({
    username: env.TREES_ADMIN_USERNAME || 'admin',
    password: env.TREES_ADMIN_PASSWORD || '123456',
  }),
})
try {
  const old = await request('/api/v1/admin/products/typewriter-study')
  const speaker = await request('/api/v1/admin/products/form-01')
  const model = JSON.parse(
    await readFile('server/src/main/resources/presentations/typewriter-kimi-v1.json', 'utf8'),
  )
  const body = {
    ...old.item,
    name: model.name,
    description: model.description,
    cover: model.cover,
    displayStatus: model.displayStatus,
    sortOrder: 0,
    presentation: model.presentation,
  }
  await write('/api/v1/admin/products/preview', body, 'POST')
  if (process.env.TREES_APPLY !== '1')
    console.log(
      'Presentation accepted by real backend; no database writes. Set TREES_APPLY=1 to apply.',
    )
  else {
    const directory = resolve(
      'artifacts/typewriter-migration/backups',
      new Date().toISOString().replaceAll(/[:.]/g, '-'),
    )
    await mkdir(directory, { recursive: true })
    await writeFile(
      resolve(directory, 'before.json'),
      JSON.stringify({ typewriter: old, speaker }, null, 2),
    )
    const saved = await write('/api/v1/admin/products/typewriter-study', body)
    if (!saved.item.listed)
      await write('/api/v1/admin/products/typewriter-study/visibility', {
        revision: saved.item.revision,
        listed: true,
      })
    if (speaker.item.listed)
      await write('/api/v1/admin/products/form-01/visibility', {
        revision: speaker.item.revision,
        listed: false,
      })
    const current = await request('/api/v1/products/typewriter-study')
    if (
      current.presentation.source.adapter !== 'typewriter-v1' ||
      current.presentation.hotspots.length !== 572
    )
      throw new Error('Published read does not match saved presentation')
    await writeFile(resolve(directory, 'after.json'), JSON.stringify(current, null, 2))
    console.log(
      JSON.stringify({
        applied: true,
        slug: current.slug,
        adapter: current.presentation.source.adapter,
        parts: current.presentation.hotspots.length,
        speaker: 'unlisted; source and legacy assets retained',
        backup: directory,
      }),
    )
  }
} finally {
  await write('/api/v1/admin/session/logout', {}, 'POST')
}
