import { getStoredToken } from './auth';

let demoAssetsPromise = null;

export async function fetchJson(url, options = {}) {
  const token = getStoredToken();
  const headers = new Headers(options.headers || {});
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  if (!(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const response = await fetch(url, { ...options, headers });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  // 检查 Content-Type 避免把 HTML 当 JSON 解析
  const ct = response.headers.get('content-type') || '';
  if (ct.includes('text/html')) {
    throw new Error('服务返回了异常页面，请刷新后重试');
  }
  return response.json();
}

export async function loadDemoAssets(force = false) {
  if (!demoAssetsPromise || force) {
    demoAssetsPromise = fetchJson('/api/demo_assets');
  }
  return demoAssetsPromise;
}
