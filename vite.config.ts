import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  build: {
    chunkSizeWarningLimit: 2500,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return undefined
          if (id.includes('@vladmandic/human')) return 'face'
          if (/recharts|d3-/.test(id)) return 'charts'
          if (/jspdf|exceljs|html2canvas/.test(id)) return 'export'
          if (/leaflet/.test(id)) return 'maps'
          if (/@supabase|@tanstack/.test(id)) return 'data'
          if (/react-dom|react-router|scheduler|\/react\//.test(id)) return 'react'
          return undefined
        },
      },
    },
  },
})
