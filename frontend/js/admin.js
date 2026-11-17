/**
 * Admin panel shell — separate sidebar, same design system. Visible only to
 * administrators; every API it calls is also enforced on the backend.
 */
import { icons } from './icons.js';
import { qs, qsa, renderErrorState, renderState } from './ui.js';
import { requireUser } from './auth.js';

const SECTIONS = [
  { group: 'ภาพรวม', items: [
    { key: 'overview', label: 'Admin Overview', icon: 'chart', load: () => import('./admin/overview.js').then((m) => m.renderOverview) },
    { key: 'activity', label: 'กิจกรรมเว็บไซต์', icon: 'activity', load: () => import('./admin/overview.js').then((m) => m.renderActivity) },
  ] },
  { group: 'ข้อมูล', items: [
    { key: 'users', label: 'จัดการสมาชิก', icon: 'users', load: () => import('./admin/users.js').then((m) => m.render) },
    { key: 'screenings', label: 'จัดการผลการตรวจ', icon: 'clipboard', load: () => import('./admin/screenings.js').then((m) => m.render) },
  ] },
  { group: 'AI & Dataset', items: [
    { key: 'roboflow', label: 'Roboflow Connection', icon: 'link', load: () => import('./admin/ai.js').then((m) => m.renderConnection) },
    { key: 'dataset', label: 'Dataset Management', icon: 'image', load: () => import('./admin/dataset.js').then((m) => m.renderDataset) },
    { key: 'review', label: 'ตรวจสอบภาพ (Review)', icon: 'checkCircle', load: () => import('./admin/dataset.js').then((m) => m.renderReview) },
    { key: 'training', label: 'AI Training', icon: 'cpu', load: () => import('./admin/ai.js').then((m) => m.renderTraining) },
  ] },
  { group: 'ระบบ', items: [
    { key: 'codes', label: 'โค้ดสมัครเจ้าหน้าที่', icon: 'key', load: () => import('./admin/system.js').then((m) => m.renderCodes) },
    { key: 'settings', label: 'ตั้งค่า & สถานะระบบ', icon: 'settings', load: () => import('./admin/system.js').then((m) => m.renderSettings) },
  ] },
];
const ALL = SECTIONS.flatMap((g) => g.items);

export async function init() {
  const rootEl = qs('#page-root');
  try { await requireUser({ admin: true }); } catch (err) { rootEl.innerHTML = '<div class="container" id="err"></div>'; renderErrorState(qs('#err'), err); return; }

  rootEl.innerHTML = `
    <div class="admin-shell">
      <nav class="admin-sidebar" id="admin-nav" aria-label="เมนูผู้ดูแลระบบ">
        ${SECTIONS.map((g) => `<h2>${g.group}</h2>${g.items.map((i) => `<a href="#${i.key}" data-key="${i.key}">${icons[i.icon]}${i.label}</a>`).join('')}`).join('')}
      </nav>
      <div class="admin-main">
        <button class="btn admin-toggle" id="admin-toggle" aria-expanded="false" aria-controls="admin-nav">${icons.menu}เมนูผู้ดูแลระบบ</button>
        <div id="admin-section"></div>
      </div>
    </div>`;
  qs('#admin-toggle').addEventListener('click', (e) => {
    const open = qs('#admin-nav').classList.toggle('open');
    e.currentTarget.setAttribute('aria-expanded', String(open));
  });
  window.addEventListener('hashchange', route);
  route();
}

let routeSeq = 0;
async function route() {
  const key = location.hash.slice(1) || 'overview';
  const item = ALL.find((i) => i.key === key) ?? ALL[0];
  qsa('#admin-nav a').forEach((a) => a.toggleAttribute('aria-current', a.dataset.key === item.key));
  qsa('#admin-nav a[aria-current]').forEach((a) => a.setAttribute('aria-current', 'page'));
  qs('#admin-nav').classList.remove('open');
  const box = qs('#admin-section');
  const seq = ++routeSeq;
  renderState(box, { type: 'loading', message: 'กำลังเปิดเมนู...' });
  try {
    const render = await item.load();
    if (seq !== routeSeq) return; // user already switched to another section
    await render(box);
  } catch (err) {
    if (seq === routeSeq) renderErrorState(box, err, route);
  }
}
