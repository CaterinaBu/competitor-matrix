import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// ЗАМЕНИ "competitor-matrix" на точное имя твоего репо
export default defineConfig({
  plugins: [react()],
  base: '/competitor-matrix/',
})
