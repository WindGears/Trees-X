import js from '@eslint/js'
import pluginVue from 'eslint-plugin-vue'
import { defineConfigWithVueTs, vueTsConfigs } from '@vue/eslint-config-typescript'
import skipFormatting from '@vue/eslint-config-prettier/skip-formatting'

export default defineConfigWithVueTs(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      '.impeccable/**',
      'artifacts/**',
      'public/gesture/vision_bundle.js',
      'public/gesture/wasm/**',
      'public/draco/**',
    ],
  },
  js.configs.recommended,
  pluginVue.configs['flat/recommended'],
  vueTsConfigs.recommended,
  {
    files: ['src/**/*.vue'],
    rules: {
      'vue/multi-word-component-names': 'off',
      'vue/no-undef-components': ['error', { ignorePatterns: ['^Tres', '^primitive$'] }],
    },
  },
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: { globals: { console: 'readonly', process: 'readonly', Buffer: 'readonly' } },
  },
  skipFormatting,
  {
    files: ['scripts/*check.mjs'],
    languageOptions: {
      globals: {
        document: 'readonly',
        window: 'readonly',
        innerWidth: 'readonly',
        HTMLCanvasElement: 'readonly',
      },
    },
  },
  {
    files: ['public/gesture/worker.js'],
    languageOptions: { globals: { performance: 'readonly' } },
  },
  {
    files: ['src/components/ui/**/*.vue'],
    rules: { 'vue/require-default-prop': 'off' },
  },
)
