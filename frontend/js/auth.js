/**
 * Session helpers. The session itself lives in httpOnly cookies managed by
 * the backend; the browser only keeps an in-memory copy of the profile.
 */
import { api } from './api.js';

let current; // undefined = not loaded yet, null = signed out
let pending = null;

export async function getCurrentUser({ refresh = false } = {}) {
  if (!refresh && current !== undefined) return current;
  if (!pending) {
    pending = api.get('/auth/me')
      .then((d) => { current = d?.profile ?? null; return current; })
      .catch((err) => { if (err.code === 'NO_INTERNET' || err.code === 'NETWORK') throw err; current = null; return null; })
      .finally(() => { pending = null; });
  }
  return pending;
}

export function clearCurrentUser() {
  current = null;
}

export async function login(username, password, remember) {
  const d = await api.post('/auth/login', { username, password, remember });
  current = d.profile;
  return d.profile;
}

export async function register(payload) {
  return api.post('/auth/register', payload);
}

export async function logout() {
  try { await api.post('/auth/logout'); } finally {
    current = null;
    sessionStorage.removeItem('ec_workflow');
    sessionStorage.removeItem('ec_capture');
  }
}

export function loginUrl() {
  return `/pages/login.html?next=${encodeURIComponent(location.pathname + location.search)}`;
}

/**
 * Guard for protected pages. Returns the user or redirects.
 * @param {{ accountTypes?: string[], admin?: boolean }} opts
 */
export async function requireUser(opts = {}) {
  const user = await getCurrentUser();
  if (!user) {
    location.replace(loginUrl());
    return new Promise(() => {}); // halt page init while redirecting
  }
  if (opts.admin && user.role !== 'admin') throw Object.assign(new Error('เฉพาะผู้ดูแลระบบเท่านั้น'), { code: 'FORBIDDEN', status: 403 });
  if (opts.accountTypes && !opts.accountTypes.includes(user.account_type)) {
    throw Object.assign(new Error('ประเภทบัญชีของคุณไม่สามารถใช้งานหน้านี้ได้'), { code: 'FORBIDDEN', status: 403 });
  }
  return user;
}

export const isStaff = (u) => u?.account_type === 'staff';
export const isAdmin = (u) => u?.role === 'admin';

/** Safe internal redirect target from ?next= */
export function safeNext(fallback = '/pages/dashboard.html') {
  const next = new URLSearchParams(location.search).get('next');
  if (next && next.startsWith('/') && !next.startsWith('//')) return next;
  return fallback;
}
