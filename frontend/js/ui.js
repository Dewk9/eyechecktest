import { icons } from './icons.js';
import { FINDINGS, RISK_LEVELS, AI_STATUS, DISEASES } from './constants.js';

export const qs = (sel, root = document) => root.querySelector(sel);
export const qsa = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Escape any untrusted value before putting it into innerHTML. */
export function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const TZ = 'Asia/Bangkok';
export function formatDateTime(iso) {
  if (!iso) return '-';
  return new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeStyle: 'short', timeZone: TZ }).format(new Date(iso));
}
export function formatDate(iso) {
  if (!iso) return '-';
  const d = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T00:00:00+07:00`) : new Date(iso);
  return new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeZone: TZ }).format(d);
}
export function todayISO() {
  return new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
}
export function daysAgoISO(n) {
  return new Date(Date.now() + 7 * 3600e3 - n * 864e5).toISOString().slice(0, 10);
}
export function calcAge(birth) {
  if (!birth) return null;
  const b = new Date(`${birth}T00:00:00`);
  const now = new Date();
  let a = now.getFullYear() - b.getFullYear();
  const m = now.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) a--;
  return a;
}
export const pct = (v) => (typeof v === 'number' ? `${(v * 100).toFixed(1)}%` : '-');

// ---------- badges ----------
export function riskBadge(level) {
  if (!level) return '<span class="badge badge-muted">ยังไม่ประเมิน</span>';
  const r = RISK_LEVELS[level] ?? RISK_LEVELS.inconclusive;
  return `<span class="badge risk-${esc(level)}">${icons[r.icon] ?? ''}${esc(r.th)}</span>`;
}
export function findingLabel(key) {
  return FINDINGS[key]?.th ?? (key ? esc(key) : 'ยังไม่มีผล');
}
export function findingBadge(key) {
  if (!key) return '<span class="badge badge-muted">ยังไม่มีผล</span>';
  const isDisease = key in DISEASES;
  const cls = isDisease ? 'badge-warning' : key === 'inconclusive' ? 'badge-muted' : 'badge-success';
  return `<span class="badge ${cls}">${esc(FINDINGS[key]?.th ?? key)}</span>`;
}
export function aiStatusBadge(s) {
  const a = AI_STATUS[s] ?? AI_STATUS.pending;
  return `<span class="badge ${a.cls}">${esc(a.th)}</span>`;
}

// ---------- toast ----------
function toastRegion() {
  let r = qs('.toast-region');
  if (!r) {
    r = document.createElement('div');
    r.className = 'toast-region';
    r.setAttribute('role', 'status');
    r.setAttribute('aria-live', 'polite');
    document.body.append(r);
  }
  return r;
}
export function toast(message, type = 'info', ms = 4500) {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  const icon = { success: icons.checkCircle, error: icons.xCircle, warning: icons.alert }[type] ?? icons.info;
  el.innerHTML = `${icon}<div></div>`;
  el.querySelector('div').textContent = message;
  toastRegion().append(el);
  // slide out instead of disappearing; hovering pauses the timer so it can be read
  const leave = () => {
    if (el.classList.contains('is-leaving')) return;
    el.classList.add('is-leaving');
    const done = () => el.remove();
    el.addEventListener('animationend', done, { once: true });
    setTimeout(done, 450); // fallback when animations are disabled
  };
  let timer = setTimeout(leave, ms);
  el.addEventListener('mouseenter', () => clearTimeout(timer));
  el.addEventListener('mouseleave', () => { clearTimeout(timer); timer = setTimeout(leave, 1500); });
}

// ---------- page states ----------
const STATE_ICONS = { empty: icons.clipboard, error: icons.xCircle, forbidden: icons.lock, offline: icons.wifiOff, notfound: icons.search, unauthorized: icons.lock };

export function errorMessage(err) {
  return err?.message || 'เกิดข้อผิดพลาด กรุณาลองใหม่';
}

export function stateFromError(err) {
  const map = { NO_INTERNET: 'offline', UNAUTHORIZED: 'unauthorized', FORBIDDEN: 'forbidden', NOT_FOUND: 'notfound', ACCOUNT_SUSPENDED: 'forbidden' };
  return map[err?.code] ?? (err?.status === 403 ? 'forbidden' : err?.status === 404 ? 'notfound' : 'error');
}

// ---------- loading (central, reusable) ----------
/**
 * Loading indicator markup. It fades in only after a short delay (CSS), so requests
 * that finish quickly never flash a loader; if a request is unusually slow a
 * "taking longer than usual" hint appears (also CSS). It is removed as soon as the
 * caller renders the real content or an error — never on a timer.
 */
export function loaderHTML(message = 'กำลังโหลดข้อมูล...', { page = false } = {}) {
  return `<div class="loader${page ? ' loader-page' : ''}" role="status" aria-live="polite" aria-busy="true">
    <div class="loader-mark" aria-hidden="true">${icons.eye}</div>
    <p class="loader-text">${esc(message)}</p>
    <div class="loader-bar" aria-hidden="true"><span></span></div>
    <p class="loader-slow">ใช้เวลานานกว่าปกติเล็กน้อย กรุณารอสักครู่</p>
  </div>`;
}

const SK_LINE = (w, cls = '') => `<span class="skeleton sk-line ${cls}" style="width:${w}"></span>`;
const SK_ROWS = {
  /** table / list rows */
  table: (n) => `<div class="sk-table">${Array.from({ length: n }, (_, i) => `<div class="sk-row">${SK_LINE(`${18 + (i % 3) * 4}%`)}${SK_LINE(`${28 - (i % 2) * 6}%`)}${SK_LINE('14%')}${SK_LINE('12%', 'sk-pill')}</div>`).join('')}</div>`,
  /** stacked cards with an avatar */
  list: (n) => `<div class="sk-list">${Array.from({ length: n }, (_, i) => `<div class="sk-item"><span class="skeleton sk-avatar"></span><div class="sk-lines">${SK_LINE(`${46 + (i % 3) * 10}%`)}${SK_LINE(`${30 + (i % 2) * 12}%`, 'sk-sm')}</div></div>`).join('')}</div>`,
  /** stat tiles + chart blocks (dashboards) */
  dashboard: () => `<div class="sk-dash"><div class="sk-tiles">${'<div class="sk-tile"><span class="skeleton sk-line sk-sm" style="width:55%"></span><span class="skeleton sk-line sk-xl" style="width:40%"></span></div>'.repeat(4)}</div>
    <div class="sk-panels"><span class="skeleton sk-block"></span><span class="skeleton sk-block"></span></div></div>`,
  /** a form / detail card */
  form: (n) => `<div class="sk-form">${Array.from({ length: n }, (_, i) => `<div class="sk-field">${SK_LINE(`${20 + (i % 3) * 6}%`, 'sk-sm')}<span class="skeleton sk-input"></span></div>`).join('')}</div>`,
};

/** Skeleton placeholder shaped like the content that is loading (no full-screen cover). */
export function skeletonHTML(kind = 'table', rows = 5, message = 'กำลังโหลดข้อมูล...') {
  const body = (SK_ROWS[kind] ?? SK_ROWS.table)(rows);
  return `<div class="sk" role="status" aria-busy="true"><span class="sr-only">${esc(message)}</span>${body}</div>`;
}

/**
 * Render a loading / empty / error state into `el`. Replaces the element's content,
 * so loaders can never stack.
 * @param {HTMLElement} el
 * @param {{type:'loading'|'empty'|'error'|'forbidden'|'offline'|'notfound'|'unauthorized', title?:string, message?:string, retry?:Function, action?:{href:string,label:string}, skeleton?:'table'|'list'|'dashboard'|'form', rows?:number}} o
 */
export function renderState(el, { type, title, message, retry, action, skeleton, rows }) {
  if (!el) return;
  if (type === 'loading') {
    el.innerHTML = skeleton ? skeletonHTML(skeleton, rows ?? 5, message ?? 'กำลังโหลดข้อมูล...') : loaderHTML(message ?? 'กำลังโหลดข้อมูล...');
    return;
  }
  const titles = { empty: 'ยังไม่มีข้อมูล', error: 'เกิดข้อผิดพลาด', forbidden: 'ไม่มีสิทธิ์เข้าถึง (Permission Denied)', offline: 'ไม่มีการเชื่อมต่ออินเทอร์เน็ต', notfound: 'ไม่พบข้อมูล', unauthorized: 'กรุณาเข้าสู่ระบบ' };
  el.innerHTML = `<div class="state" role="${type === 'empty' ? 'status' : 'alert'}">
    ${STATE_ICONS[type] ?? icons.info}
    <h3>${esc(title ?? titles[type] ?? '')}</h3>
    ${message ? `<p>${esc(message)}</p>` : ''}
    <div class="row" style="justify-content:center">
      ${retry ? `<button type="button" class="btn btn-primary" data-retry>${icons.refresh}ลองอีกครั้ง</button>` : ''}
      ${type === 'unauthorized' ? `<a class="btn btn-primary" href="/pages/login.html?next=${encodeURIComponent(location.pathname + location.search)}">เข้าสู่ระบบ</a>` : ''}
      ${action ? `<a class="btn" href="${esc(action.href)}">${esc(action.label)}</a>` : ''}
    </div>
  </div>`;
  if (retry) {
    const btn = qs('[data-retry]', el);
    let used = false;
    const run = () => { if (used) return; used = true; btn.disabled = true; retry(); };
    btn.addEventListener('click', run);
    // offline: retry automatically as soon as the connection comes back (if this state is still shown)
    if (type === 'offline') window.addEventListener('online', () => { if (btn.isConnected) run(); }, { once: true });
  }
}

/** Errors that may succeed if tried again (connection, timeout, server unavailable). */
export function isTransientError(err) {
  return ['NETWORK', 'TIMEOUT', 'NO_INTERNET'].includes(err?.code) || err?.status === 0 || err?.status >= 500;
}

export function renderErrorState(el, err, retry) {
  // never leave the user stuck: transient failures always get a "ลองอีกครั้ง" button
  // (falls back to reloading the page when the caller has no finer-grained retry)
  const fallback = !retry && isTransientError(err) ? () => location.reload() : undefined;
  renderState(el, { type: stateFromError(err), message: errorMessage(err), retry: retry ?? fallback });
}

// ---------- forms ----------
export function setBusy(btn, busy) {
  if (!btn) return;
  btn.classList.toggle('is-busy', busy);
  btn.disabled = busy;
  btn.setAttribute('aria-busy', String(busy));
}

export function clearFieldErrors(form) {
  qsa('[aria-invalid="true"]', form).forEach((el) => el.removeAttribute('aria-invalid'));
  qsa('.field-error', form).forEach((el) => { el.textContent = ''; });
}

/** Show server validation details ({field, message}) next to inputs. */
export function showFieldErrors(form, details = []) {
  let first = null;
  for (const d of details) {
    const name = d.field?.split('.')[0];
    const input = name ? form.querySelector(`[name="${CSS.escape(name)}"]`) : null;
    const slot = name ? form.querySelector(`[data-error-for="${CSS.escape(name)}"]`) : null;
    if (input) { input.setAttribute('aria-invalid', 'true'); first ??= input; }
    if (slot) slot.textContent = d.message;
  }
  first?.focus();
}

export function formToObject(form) {
  const fd = new FormData(form);
  const out = {};
  for (const [k, v] of fd.entries()) out[k] = typeof v === 'string' ? v.trim() : v;
  return out;
}

// ---------- pagination ----------
export function renderPagination(el, { page, totalPages, total }, onPage) {
  if (!el) return;
  if (!total) { el.innerHTML = ''; return; }
  el.innerHTML = `
    <span class="muted small">ทั้งหมด ${total.toLocaleString('th-TH')} รายการ · หน้า ${page}/${totalPages}</span>
    <button type="button" class="btn btn-sm" data-p="${page - 1}" ${page <= 1 ? 'disabled' : ''}>ก่อนหน้า</button>
    <button type="button" class="btn btn-sm" data-p="${page + 1}" ${page >= totalPages ? 'disabled' : ''}>ถัดไป</button>`;
  el.onclick = (e) => {
    const b = e.target.closest('[data-p]');
    if (b && !b.disabled) onPage(Number(b.dataset.p));
  };
}

export function debounce(fn, ms = 350) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

export function param(name) {
  return new URLSearchParams(location.search).get(name);
}
