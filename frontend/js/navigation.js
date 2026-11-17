import { icons } from './icons.js';
import { esc, qs, qsa, toast } from './ui.js';
import { getCurrentUser, logout, isAdmin } from './auth.js';
import { ACCOUNT_TYPES } from './constants.js';
import { confirmDialog } from '../components/modal.js';

const SCREENING_STEPS = [
  { href: '/pages/medical-history.html', label: 'ซักประวัติผู้เข้ารับการตรวจ' },
  { href: '/pages/vision-test.html', label: 'ทดสอบการมองเห็น' },
  { href: '/pages/scan.html', label: 'สแกนดวงตา' },
  { href: '/pages/analyze.html', label: 'วิเคราะห์ผลด้วย AI' },
  { href: '/pages/result.html', label: 'ผลการตรวจ' },
];

const FONT_KEY = 'ec_font_scale';
const HEADER_CACHE = 'ec_header_v1';

function applyFontScale(n) {
  const v = Math.max(0, Math.min(3, n));
  document.documentElement.dataset.fontScale = String(v);
  try { localStorage.setItem(FONT_KEY, String(v)); } catch { /* storage unavailable */ }
  return v;
}

function isCurrent(href) {
  const p = location.pathname.replace(/\/index\.html$/, '/');
  return p === href || (href !== '/' && p.startsWith(href.replace(/\.html$/, '')));
}

export async function initNavigation() {
  try { applyFontScale(Number(localStorage.getItem(FONT_KEY) || 0)); } catch { /* ignore */ }

  const header = qs('#site-header');
  if (!header) return null;
  let user = null;
  try { user = await getCurrentUser(); } catch { user = null; }

  const screeningActive = SCREENING_STEPS.some((s) => isCurrent(s.href)) || isCurrent('/pages/patients.html');
  const initials = user ? esc(user.full_name.trim().charAt(0) || 'U') : '';
  const roleLabel = user ? (isAdmin(user) ? 'ผู้ดูแลระบบ' : ACCOUNT_TYPES[user.account_type] ?? '') : '';

  header.className = 'site-header';
  header.innerHTML = `
    <a class="skip-link" href="#main">ข้ามไปยังเนื้อหาหลัก</a>
    <nav class="container nav" aria-label="เมนูหลัก">
      <a class="brand" href="/" aria-label="EYE Check หน้าแรก">
        <img src="/assets/logo.svg" alt="" width="38" height="38">
        <span>EYE Check<small>AI Eye Screening</small></span>
      </a>
      <button class="btn btn-ghost btn-icon hamburger" type="button" aria-expanded="false" aria-controls="nav-collapse" aria-label="เปิดเมนู">${icons.menu}</button>
      <div class="nav-collapse" id="nav-collapse">
        <ul class="nav-menu">
          <li><a class="nav-link" href="/" ${isCurrent('/') ? 'aria-current="page"' : ''}>${icons.home}หน้าแรก</a></li>
          <li>
            <button class="nav-link" type="button" aria-expanded="false" aria-haspopup="true" aria-controls="dd-screening" ${screeningActive ? 'aria-current="page"' : ''}>${icons.eye}สแกนดวงตา ${icons.chevron}</button>
            <ul class="dropdown" id="dd-screening">
              ${SCREENING_STEPS.map((s, i) => `<li><a href="${s.href}"><span class="step-no">${i + 1}</span>${s.label}</a></li>`).join('')}
              ${user?.account_type === 'staff' ? `<li><a href="/pages/patients.html"><span class="step-no">${icons.users}</span>จัดการรายชื่อผู้เข้ารับการตรวจ</a></li>` : ''}
            </ul>
          </li>
          <li><a class="nav-link" href="/pages/history.html" ${isCurrent('/pages/history.html') ? 'aria-current="page"' : ''}>${icons.history}ประวัติการตรวจ</a></li>
          <li><a class="nav-link" href="/pages/guide.html" ${isCurrent('/pages/guide.html') ? 'aria-current="page"' : ''}>${icons.book}คู่มือการใช้งาน</a></li>
          <li><a class="nav-link" href="/pages/dashboard.html" ${isCurrent('/pages/dashboard.html') ? 'aria-current="page"' : ''}>${icons.chart}แดชบอร์ด</a></li>
          ${isAdmin(user) ? `<li><a class="nav-link" href="/pages/admin.html" ${isCurrent('/pages/admin.html') ? 'aria-current="page"' : ''}>${icons.shield}ผู้ดูแลระบบ</a></li>` : ''}
        </ul>
        <div class="nav-actions">
          <div class="font-controls" role="group" aria-label="ปรับขนาดตัวอักษร">
            <button type="button" data-font="-1" aria-label="ลดขนาดตัวอักษร">ก-</button>
            <button type="button" data-font="0" aria-label="ขนาดตัวอักษรปกติ">ก</button>
            <button type="button" data-font="1" aria-label="เพิ่มขนาดตัวอักษร">ก+</button>
          </div>
          ${user ? `
            <div class="profile-menu">
              <button class="user-chip" type="button" aria-expanded="false" aria-haspopup="true" aria-controls="dd-user" aria-label="เมนูบัญชีของ ${esc(user.full_name)}">
                <span class="avatar" aria-hidden="true">${initials}</span>
                <span class="meta"><strong>${esc(user.full_name)}</strong><span>${esc(roleLabel)}</span></span>
                ${icons.chevron}
              </button>
              <div class="dropdown right profile-dd" id="dd-user">
                <div class="profile-dd-head">
                  <span class="avatar avatar-lg" aria-hidden="true">${initials}</span>
                  <div class="profile-dd-id">
                    <strong title="${esc(user.full_name)}">${esc(user.full_name)}</strong>
                    <span class="profile-dd-role">${esc(roleLabel)}</span>
                    ${user.username ? `<span class="profile-dd-acct">@${esc(user.username)}</span>` : ''}
                  </div>
                </div>
                <ul class="profile-dd-list">
                  <li><a href="/pages/profile.html" ${isCurrent('/pages/profile.html') ? 'aria-current="page"' : ''}>${icons.user}<span>ข้อมูลส่วนตัว</span></a></li>
                  ${user.account_type === 'personal' ? `<li><a href="/pages/medical-history.html?edit=1" ${isCurrent('/pages/medical-history.html') && new URLSearchParams(location.search).get('edit') === '1' ? 'aria-current="page"' : ''}>${icons.clipboard}<span>ประวัติสุขภาพของฉัน</span></a></li>` : ''}
                  ${user.account_type === 'staff' ? `<li><a href="/pages/patients.html" ${isCurrent('/pages/patients.html') ? 'aria-current="page"' : ''}>${icons.users}<span>รายชื่อผู้เข้ารับการตรวจ</span></a></li>` : ''}
                </ul>
                <div class="profile-dd-sep" role="separator"></div>
                <a href="#" class="profile-dd-logout" data-logout>${icons.logout}<span>ออกจากระบบ</span></a>
              </div>
            </div>` : `
            <a class="btn btn-ghost" href="/pages/login.html">เข้าสู่ระบบ</a>
            <a class="btn btn-primary" href="/pages/register.html">สมัครสมาชิก</a>`}
        </div>
      </div>
    </nav>`;
  header.removeAttribute('data-cached');
  // cache for js/boot.js: the next page paints this header before its first frame (no flash)
  try { sessionStorage.setItem(HEADER_CACHE, JSON.stringify({ cls: header.className, html: header.innerHTML })); } catch { /* storage unavailable */ }

  // hamburger
  const ham = qs('.hamburger', header);
  const collapse = qs('#nav-collapse', header);
  ham.addEventListener('click', () => {
    const open = collapse.classList.toggle('open');
    ham.setAttribute('aria-expanded', String(open));
  });

  // dropdowns (click + keyboard)
  const toggles = qsa('[aria-haspopup="true"]', header);
  const closeAll = (except) => toggles.forEach((t) => {
    if (t === except) return;
    t.setAttribute('aria-expanded', 'false');
    qs(`#${t.getAttribute('aria-controls')}`)?.classList.remove('open');
  });
  for (const t of toggles) {
    const menu = qs(`#${t.getAttribute('aria-controls')}`);
    t.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = t.getAttribute('aria-expanded') !== 'true';
      closeAll(t);
      t.setAttribute('aria-expanded', String(open));
      menu.classList.toggle('open', open);
      if (open && e.detail === 0) qs('a', menu)?.focus(); // keyboard activation
    });
    menu.addEventListener('keydown', (e) => {
      const items = qsa('a', menu);
      const i = items.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
      if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
      if (e.key === 'Escape') { closeAll(); t.focus(); }
    });
  }
  document.addEventListener('click', (e) => { if (!header.contains(e.target)) closeAll(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAll(); });

  // font size
  qs('.font-controls', header).addEventListener('click', (e) => {
    const b = e.target.closest('[data-font]');
    if (!b) return;
    const cur = Number(document.documentElement.dataset.fontScale || 0);
    const d = Number(b.dataset.font);
    applyFontScale(d === 0 ? 0 : cur + d);
  });

  // logout (asks for confirmation first; guarded against double submission)
  let loggingOut = false;
  qs('[data-logout]', header)?.addEventListener('click', async (e) => {
    e.preventDefault();
    if (loggingOut) return;
    closeAll();
    const ok = await confirmDialog({
      title: 'ออกจากระบบ',
      message: 'ต้องการออกจากระบบ EYE Check ใช่หรือไม่?',
      confirmText: 'ออกจากระบบ',
      danger: true,
    });
    if (!ok) return;
    loggingOut = true;
    try { sessionStorage.removeItem(HEADER_CACHE); } catch { /* ignore */ }
    try {
      await logout();
      location.href = '/';
    } catch (err) {
      loggingOut = false;
      toast(err.message, 'error');
    }
  });

  return user;
}
