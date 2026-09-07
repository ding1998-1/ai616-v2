export async function withDeadline(operation, milliseconds, message = '录音请求超时，请重试保存', onTimeout = () => {}) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          onTimeout();
          reject(new Error(message));
        }, milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function recordingRequest(url, options = {}, milliseconds = 30000) {
  const controller = new AbortController();
  return withDeadline(async () => {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const body = await response.text();
    return new Response(body || null, { status: response.status, headers: response.headers });
  }, milliseconds, '录音请求超时，已保留待保存数据，请重试', () => controller.abort());
}
