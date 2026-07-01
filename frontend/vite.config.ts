/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

const backend = 'http://localhost:8080'

export default defineConfig({
  plugins: [vue()],
  server: {
    proxy: {
      '/api': backend,
      '/tiles': backend,
      '/health': backend,
    },
  },
  test: {
    environment: 'happy-dom',
  },
})
