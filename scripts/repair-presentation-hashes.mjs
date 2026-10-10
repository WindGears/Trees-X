/* global fetch, Headers, URLSearchParams */
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'

// Repair only manifest references, preserving all current administrator edits.
const base = 'http://127.0.0.1:8089'
const env = Object.fromEntries(
  (await readFile('server/.env.local', 'utf8'))
    .split(/\r?\n/)
    .filter((line) => /^TREES_ADMIN_/.test(line))
    .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
)
const jar = new Map()
async function request(path, options = {}) {
  const headers = new Headers(options.headers)
  headers.set('Cookie', [...jar].map(([key, value]) => key + '=' + value).join('; '))
  const response = await fetch(base + path, { ...options, headers, redirect: 'manual' })
  for (const entry of response.headers.getSetCookie()) {
    const cookie = entry.split(';')[0],
      index = cookie.indexOf('=')
    jar.set(cookie.slice(0, index), cookie.slice(index + 1))
  }
  if (!response.ok) throw new Error('Admin request failed: ' + path + ' ' + response.status)
  return response.status === 204 ? null : response.json()
}
async function write(path, body, method = 'PUT') {
  const csrf = await request('/api/v1/admin/session/csrf')
  return request(path, {
    method,
    headers: { 'Content-Type': 'application/json', [csrf.headerName]: csrf.token },
    body: JSON.stringify(body),
  })
}
const csrf = await request('/api/v1/admin/session/csrf')
await request('/api/v1/admin/session/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded', [csrf.headerName]: csrf.token },
  body: new URLSearchParams({
    username: env.TREES_ADMIN_USERNAME || 'admin',
    password: env.TREES_ADMIN_PASSWORD || '123456',
  }),
})
try {
  const directory = resolve(
    'artifacts/manifest-reference-repair',
    new Date().toISOString().replaceAll(/[:.]/g, '-'),
  )
  await mkdir(directory, { recursive: true })
  for (const [slug, name] of [
    ['typewriter-study', 'kimi-typewriter'],
    ['piano-cfx', 'kimi-piano'],
  ]) {
    const old = await request('/api/v1/admin/products/' + slug)
    if (old.presentation.source.bundle.id !== name)
      throw new Error('Unexpected resource package: ' + slug)
    const manifestPath = '/models/bundles/' + name + '/v1/manifest.json'
    if (old.presentation.source.bundle.manifest !== manifestPath)
      throw new Error('Unexpected manifest path')
    const bytes = await readFile('public' + manifestPath),
      manifest = JSON.parse(bytes)
    const digest = (data) => createHash('sha256').update(data).digest('hex')
    for (const file of manifest.files) {
      if (!/^[a-zA-Z0-9_.-]+$/.test(file.path) || file.path === '..')
        throw new Error('Invalid package file')
      const data = await readFile(resolve('public/models/bundles/' + name + '/v1', file.path))
      if (data.length !== file.bytes || digest(data) !== file.sha256)
        throw new Error('Original asset changed: ' + file.path)
    }
    const hash = digest(bytes)
    if (hash === old.presentation.source.bundle.sha256) continue
    const presentation = {
      ...old.presentation,
      source: {
        ...old.presentation.source,
        bundle: { ...old.presentation.source.bundle, sha256: hash },
      },
    }
    const { item } = old
    const body = {
      slug,
      name: item.name,
      categoryId: item.categoryId,
      description: item.description,
      cover: item.cover,
      displayStatus: item.displayStatus,
      sortOrder: item.sortOrder,
      revision: item.revision,
      presentation,
    }
    await write('/api/v1/admin/products/preview', body, 'POST')
    await writeFile(resolve(directory, slug + '-before.json'), JSON.stringify(old, null, 2))
    const saved = await write('/api/v1/admin/products/' + slug, body)
    if (saved.presentation.source.bundle.sha256 !== hash)
      throw new Error('Saved reference mismatch')
    console.log(
      JSON.stringify({
        slug,
        verifiedFiles: manifest.files.length,
        repaired: true,
        revision: saved.item.revision,
      }),
    )
  }
} finally {
  await write('/api/v1/admin/session/logout', {}, 'POST')
}
