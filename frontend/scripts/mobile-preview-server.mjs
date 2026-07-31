import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import httpProxy from 'http-proxy';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');
const port = Number(process.env.MOBILE_PREVIEW_PORT || 3101);
const backend = process.env.BACKEND_URL || 'http://127.0.0.1:8000';

const proxy = httpProxy.createProxyServer({
  target: backend,
  changeOrigin: true,
  ws: true,
});

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function sendFile(res, filePath) {
  fs.readFile(filePath, (error, content) => {
    if (error) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': mimeTypes[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
    });
    res.end(content);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/contract') || url.pathname.startsWith('/doc')) {
    proxy.web(req, res, {}, (error) => {
      res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, detail: error.message }));
    });
    return;
  }

  const requestedPath = decodeURIComponent(url.pathname);
  const safePath = requestedPath === '/' ? '/index.html' : requestedPath;
  const filePath = path.normalize(path.join(distDir, safePath));
  if (filePath.startsWith(distDir) && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    sendFile(res, filePath);
    return;
  }
  sendFile(res, path.join(distDir, 'index.html'));
});

server.on('upgrade', (req, socket, head) => {
  if ((req.url || '').startsWith('/api/')) {
    proxy.ws(req, socket, head);
    return;
  }
  socket.destroy();
});

server.listen(port, '0.0.0.0', () => {
  console.log(`Mobile preview listening on http://0.0.0.0:${port}`);
  console.log(`Proxying API and WebSocket requests to ${backend}`);
});
