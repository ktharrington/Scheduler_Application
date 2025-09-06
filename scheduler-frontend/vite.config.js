import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, '.') }
  },
  server: {
    proxy: { '/api': 'http://localhost:8080' }
  },
  // 👇 tell esbuild (during optimizeDeps) that .js files may contain JSX
  optimizeDeps: {
    esbuildOptions: {
      loader: {
        '.js': 'jsx'
      }
    }
  }
})
