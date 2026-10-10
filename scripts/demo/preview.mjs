import { preview } from 'vite'
import { readDemoConfig } from './config.mjs'

const config = readDemoConfig()
if (!/^--run-id=[a-f0-9-]{36}$/.test(process.argv[2] ?? ''))
  throw new Error('预览进程必须由 demo:start 启动。')
const server = await preview({
  root: config.rootDir,
  configFile: false,
  envFile: false,
  build: { outDir: config.distDir },
  preview: {
    host: config.host,
    port: config.frontendPort,
    strictPort: true,
    proxy: { '/api': `http://${config.host}:${config.backendPort}` },
  },
})
for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, () => {
    server.httpServer.close(() => process.exit(0))
  })
console.log(`Trees X demo preview: ${config.baseUrl}`)
