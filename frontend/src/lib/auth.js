const TOKEN_KEY = 'ai_compliance_token';

export function getStoredToken() {
  return localStorage.getItem(TOKEN_KEY) || '';
}

export function setStoredToken(token) {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_KEY);
  }
}

export function authHeaders() {
  const token = getStoredToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function authFetch(url, options = {}) {
  const token = getStoredToken();
  const headers = new Headers(options.headers || {});
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  if (!(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  return fetch(url, { ...options, headers });
}

export async function authFetchJson(url, options = {}) {
  const response = await authFetch(url, options);
  if (!response.ok) {
    let detail = `HTTP ${response.status}`;
    try {
      const json = await response.json();
      detail = json.detail || json.message || detail;
    } catch (_) {
      // 响应不是 JSON（可能是 nginx 错误页 HTML），用状态码文本兜底
      detail = `服务异常 (HTTP ${response.status})`;
    }
    throw new Error(detail);
  }
  // 检查 Content-Type 避免把 HTML 当 JSON 解析
  const ct = response.headers.get('content-type') || '';
  if (ct.includes('text/html')) {
    throw new Error('服务返回了异常页面，请刷新后重试');
  }
  return response.json();
}
