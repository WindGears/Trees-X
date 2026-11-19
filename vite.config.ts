import { fileURLToPath, URL } from 'node:url'
import { existsSync } from 'node:fs'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { templateCompilerOptions } from '@tresjs/core'

export default defineConfig({
  plugins: [vue({ ...templateCompilerOptions }), tailwindcss()],
  define: {
    'import.meta.env.VITE_HAS_R18_EXHIBITION_COVER': JSON.stringify(
      existsSync(new URL('./public/covers/showcase/reventon-whole.webp', import.meta.url)),
    ),
  },
  optimizeDeps: { entries: ['index.html', 'renderlab.html'] },
  build: {
    rolldownOptions: {
      input: {
        app: fileURLToPath(new URL('./index.html', import.meta.url)),
        renderlab: fileURLToPath(new URL('./renderlab.html', import.meta.url)),
      },
    },
  },
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: { port: 5181, proxy: { '/api': 'http://127.0.0.1:8089' } },
  preview: { proxy: { '/api': 'http://127.0.0.1:8089' } },
})
