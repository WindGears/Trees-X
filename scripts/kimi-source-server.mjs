import { createServer } from 'node:http'
import { URL } from 'node:url'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { resolve, relative, extname, isAbsolute } from 'node:path'
const root = resolve('artifacts/kimi-imports')
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
}
createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1:5183').pathname)
    const file = resolve(root, '.' + pathname + (pathname.endsWith('/') ? 'index.html' : ''))
    const path = relative(root, file)
    if (path === '..' || path.startsWith('..\\') || path.startsWith('../') || isAbsolute(path)) {
      res.writeHead(403).end()
      return
    }
    const info = await stat(file)
    if (!info.isFile()) {
      res.writeHead(404).end()
      return
    }
    res.writeHead(200, {
      'Content-Type': types[extname(file)] || 'application/octet-stream',
      'Content-Length': info.size,
      'Cache-Control': 'no-store',
    })
    if (req.method === 'HEAD') res.end()
    else createReadStream(file).pipe(res)
  } catch {
    res.writeHead(404).end('Not found')
  }
}).listen(5183, '127.0.0.1', () =>
  console.log('Local backed-up Kimi sources: http://127.0.0.1:5183/piano-cfx/sound-path.html'),
)
