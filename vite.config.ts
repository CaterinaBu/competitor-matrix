import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  plugins: [react()],
  base: '/competitor-matrix/',   // для GitHub Pages
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'), // ← алиас @ -> src
    },
  },
})
