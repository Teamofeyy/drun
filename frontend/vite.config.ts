import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

/** Прокси на backend; нужен и для `vite dev`, и для `vite preview` (в preview по умолчанию нет proxy). */
const backendProxy = {
  '/api': {
    target: 'http://127.0.0.1:8080',
    changeOrigin: true,
    ws: true,
  },
  '/health': {
    target: 'http://127.0.0.1:8080',
    changeOrigin: true,
  },
} as const

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: { ...backendProxy },
  },
  preview: {
    proxy: { ...backendProxy },
  },
})
