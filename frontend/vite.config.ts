import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwind from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwind()],
  server: {
    host: 'localhost',
    port: 5175,
    strictPort: true,
    proxy: { '/api': process.env.SCALE_BACKEND_URL ?? 'http://127.0.0.1:5082' },
  },
})
