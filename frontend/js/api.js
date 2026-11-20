/**
 * Fetch-based API client. Auth uses httpOnly cookies set by the backend,
 * so no token is ever stored in JavaScript. Every state-changing request
 * carries the X-Requested-With header required by the CSRF guard.
 */
// Deployed backend. When the page is opened from localhost (backend serving the frontend),
// keep calling the same origin so local development does not hit production.
const BACKEND_URL = 'https://eyecheck-five.vercel.app';
const IS_LOCAL = ['localhost', '127.0.0.1'].includes(window.location.hostname);
const BASE = IS_LOCAL ? '/api' : `${BACKEND_URL}/api`;
const DEFAULT_TIMEOUT = 30000;
const READ_TIMEOUT = 20000; // GETs that take longer than this are treated as failed (with a retry option)

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const MESSAGES = {
  NO_INTERNET: 'ไม่มีการเชื่อมต่ออินเทอร์เน็ต กรุณาตรวจสอบการเชื่อมต่อแล้วลองใหม่',
  TIMEOUT: 'เซิร์ฟเวอร์ใช้เวลาตอบกลับนานเกินไป (API Timeout) กรุณาลองใหม่',
  NETWORK: 'ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ กรุณาลองใหม่อีกครั้ง',
  BAD_RESPONSE: 'เซิร์ฟเวอร์ตอบกลับในรูปแบบที่ไม่ถูกต้อง',
};

function buildUrl(path, query) {
  const url = new URL(BASE + path, window.location.origin);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
    }
  }
  return url;
}

function handleBody(status, json) {
  if (json && json.success) return json.data;
  const err = json?.error ?? {};
  const e = new ApiError(status, err.code ?? `HTTP_${status}`, err.message ?? MESSAGES.BAD_RESPONSE, err.details);
  if (status === 401) window.dispatchEvent(new CustomEvent('auth:expired'));
  throw e;
}

async function request(method, path, { body, query, timeout = DEFAULT_TIMEOUT, keepalive = false } = {}) {
  if (!navigator.onLine) throw new ApiError(0, 'NO_INTERNET', MESSAGES.NO_INTERNET);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  const headers = { Accept: 'application/json', 'X-Requested-With': 'EyeCheck' };
  let payload;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }

  let res;
  try {
    res = await fetch(buildUrl(path, query), { method, headers, body: payload, credentials: 'include', signal: controller.signal, keepalive });
  } catch (err) {
    if (err.name === 'AbortError') throw new ApiError(0, 'TIMEOUT', MESSAGES.TIMEOUT);
    throw new ApiError(0, navigator.onLine ? 'NETWORK' : 'NO_INTERNET', navigator.onLine ? MESSAGES.NETWORK : MESSAGES.NO_INTERNET);
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 204) return null;
  let json = null;
  try { json = await res.json(); } catch { /* ignore */ }
  return handleBody(res.status, json);
}

/** Multipart upload with progress (XHR is the only way to get upload progress). */
function upload(path, formData, { onProgress, onUploaded, timeout = 120000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!navigator.onLine) { reject(new ApiError(0, 'NO_INTERNET', MESSAGES.NO_INTERNET)); return; }
    const xhr = new XMLHttpRequest();
    xhr.open('POST', buildUrl(path));
    xhr.setRequestHeader('X-Requested-With', 'EyeCheck');
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.timeout = timeout;
    xhr.withCredentials = true;
    xhr.upload.onprogress = (e) => { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); };
    xhr.upload.onload = () => onUploaded?.();
    xhr.onload = () => {
      let json = null;
      try { json = JSON.parse(xhr.responseText); } catch { /* ignore */ }
      try { resolve(handleBody(xhr.status, json)); } catch (e) { reject(e); }
    };
    xhr.onerror = () => reject(new ApiError(0, 'NETWORK', MESSAGES.NETWORK));
    xhr.ontimeout = () => reject(new ApiError(0, 'TIMEOUT', MESSAGES.TIMEOUT));
    xhr.send(formData);
  });
}

export const api = {
  get: (path, query, opts) => request('GET', path, { query, timeout: READ_TIMEOUT, ...opts }),
  post: (path, body, opts) => request('POST', path, { body, ...opts }),
  put: (path, body, opts) => request('PUT', path, { body, ...opts }),
  patch: (path, body, opts) => request('PATCH', path, { body, ...opts }),
  del: (path, body, opts) => request('DELETE', path, { body, ...opts }),
  upload,
};
