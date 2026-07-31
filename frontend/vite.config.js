import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom'],
          'vendor-antd': ['antd', '@ant-design/x'],
          'vendor-antd-icons': ['@ant-design/icons'],
          'vendor-editor': ['@tiptap/react', '@tiptap/starter-kit', 'reactjs-tiptap-editor'],
          'vendor-markdown': ['react-markdown', 'remark-gfm'],
        },
      },
    },
  },
  server: {
    host: '0.0.0.0',
    port: 3001,
    allowedHosts: true,
    proxy: {
      // /api/doc/* -> strip /api prefix, forward to backend /doc/*
      '/api/doc': {
        target: 'http://127.0.0.1:8002',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/doc/, '/doc'),
      },
      // /api/knowledge_files/* -> keep /api prefix (backend has /api/knowledge_files)
      '/api/knowledge_files': {
        target: 'http://127.0.0.1:8002',
        changeOrigin: true,
      },
      '/api/knowledge_files/': {
        target: 'http://127.0.0.1:8002',
        changeOrigin: true,
      },
      '/parse_file': {
        target: 'http://127.0.0.1:8002',
        changeOrigin: true,
      },
      '/ingest_file': {
        target: 'http://127.0.0.1:8002',
        changeOrigin: true,
      },
      '/doc': {
        target: 'http://127.0.0.1:8002',
        changeOrigin: true,
      },
      '/api/audit_stream': {
        target: 'http://127.0.0.1:8002',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/audit_stream/, '/audit_stream'),
      },
      '/api/audit_history': {
        target: 'http://127.0.0.1:8002',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/audit_history/, '/api/audit_history'),
      },
      '/api/kb_stream': {
        target: 'http://127.0.0.1:8002',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/kb_stream/, '/api/kb_stream'),
      },
      '/api/kb_stats': {
        target: 'http://127.0.0.1:8002',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/kb_stats/, '/api/kb_stats'),
      },
      '/api/generate_template': {
        target: 'http://127.0.0.1:8002',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/generate_template/, '/api/generate_template'),
      },
      '/api/auth': {
        target: 'http://127.0.0.1:8002',
        changeOrigin: true,
      },
      '/api/users': {
        target: 'http://127.0.0.1:8002',
        changeOrigin: true,
      },
      '/api/meeting': {
        target: 'http://127.0.0.1:8002',
        changeOrigin: true,
        ws: true,
      },
      '/api/ocr': {
        target: 'http://127.0.0.1:8002',
        changeOrigin: true,
      },
      '/api/custom_rules': {
        target: 'http://127.0.0.1:8002',
        changeOrigin: true,
      },
      '/api/rules_gallery': {
        target: 'http://127.0.0.1:8002',
        changeOrigin: true,
      },
      '/api/rules_images': {
        target: 'http://127.0.0.1:8002',
        changeOrigin: true,
      },
      '/api/demo_assets': {
        target: 'http://127.0.0.1:8002',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/demo_assets/, '/api\/demo_assets'),
      },
      '/matter-types': {
        target: 'http://127.0.0.1:8002',
        changeOrigin: true,
      },
      '/contract': {
        target: 'http://127.0.0.1:8002',
        changeOrigin: true,
      },
      '/api/contract': {
        target: 'http://127.0.0.1:8002',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/contract/, '/contract'),
      },
    }
  }
})
