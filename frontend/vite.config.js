import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 后端地址：默认本机 8002，可通过环境变量 BACKEND_URL 覆盖
// 部署到其他机器时：BACKEND_URL=http://192.168.66.44:8002 npm run dev
const BACKEND = process.env.BACKEND_URL || 'http://127.0.0.1:8002'

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
        target: BACKEND,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/doc/, '/doc'),
      },
      // /api/knowledge_files/* -> keep /api prefix (backend has /api/knowledge_files)
      '/api/knowledge_files': {
        target: BACKEND,
        changeOrigin: true,
      },
      '/api/knowledge_files/': {
        target: BACKEND,
        changeOrigin: true,
      },
      '/parse_file': {
        target: BACKEND,
        changeOrigin: true,
      },
      '/ingest_file': {
        target: BACKEND,
        changeOrigin: true,
      },
      '/doc': {
        target: BACKEND,
        changeOrigin: true,
      },
      '/api/audit_stream': {
        target: BACKEND,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/audit_stream/, '/audit_stream'),
      },
      '/api/audit_history': {
        target: BACKEND,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/audit_history/, '/api/audit_history'),
      },
      '/api/kb_stream': {
        target: BACKEND,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/kb_stream/, '/api/kb_stream'),
      },
      '/api/kb_stats': {
        target: BACKEND,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/kb_stats/, '/api/kb_stats'),
      },
      '/api/generate_template': {
        target: BACKEND,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/generate_template/, '/api/generate_template'),
      },
      '/api/auth': {
        target: BACKEND,
        changeOrigin: true,
      },
      '/api/users': {
        target: BACKEND,
        changeOrigin: true,
      },
      '/api/meeting': {
        target: BACKEND,
        changeOrigin: true,
        ws: true,
      },
      '/api/ocr': {
        target: BACKEND,
        changeOrigin: true,
      },
      '/api/custom_rules': {
        target: BACKEND,
        changeOrigin: true,
      },
      '/api/rules_gallery': {
        target: BACKEND,
        changeOrigin: true,
      },
      '/api/rules_images': {
        target: BACKEND,
        changeOrigin: true,
      },
      '/api/demo_assets': {
        target: BACKEND,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/demo_assets/, '/api\/demo_assets'),
      },
      '/matter-types': {
        target: BACKEND,
        changeOrigin: true,
      },
      '/contract': {
        target: BACKEND,
        changeOrigin: true,
      },
      '/api/contract': {
        target: BACKEND,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/contract/, '/contract'),
      },
    }
  }
})
