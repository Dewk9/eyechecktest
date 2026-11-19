/**
 * User manual page (pages/guide.html).
 * Content lives in guide-data.js, videos in guide-videos.js; this module renders them and adds
 * the table of contents (scroll spy + reading progress), live search, the video player
 * (YouTube / MP4, created only after the user presses Play), the FAQ accordion and back-to-top.
 * UI only: no API calls except the shared /auth/me (to tailor the closing call-to-action).
 */
import { icons } from './icons.js';
import { esc, qs, qsa } from './ui.js';
import { getCurrentUser } from './auth.js';
import { GROUPS, SECTIONS, CAUTIONS, FAQ, AUDIENCE } from './guide-data.js';
import { VIDEOS } from './guide-videos.js';

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const ic = (name) => icons[name] ?? '';
const MOBILE = '(max-width: 960px)';

/** {{ui label}} → highlighted key, **bold** → <strong>. Input is static trusted text, escaped first. */
const rich = (s) => esc(s)
  .replace(/\{\{(.+?)\}\}/g, '<span class="ui-key">$1</span>')
  .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
const plain = (s) => String(s ?? '').replace(/\{\{|\}\}|\*\*/g, '');

// numbered topics 1–16 (as listed in the table of contents)
const TOPICS = [
  ...SECTIONS.map((s) => ({ id: s.id, group: s.group, icon: s.icon, title: s.title })),
  { id: 'g15', group: 'help', icon: 'alert', title: 'ข้อควรระวังในการใช้งาน' },
  { id: 'faq', group: 'help', icon: 'info', title: 'คำถามที่พบบ่อย (FAQ)' },
].map((t, i) => ({ ...t, num: i + 1 }));
const EXTRA_TOC = [
  { id: 'overview', icon: 'activity', title: 'ภาพรวมขั้นตอนการตรวจ' },
  { id: 'video', icon: 'play', title: 'วิดีโอสอนการใช้งาน' },
];
const ALL_TOC = [...EXTRA_TOC, ...TOPICS];
const titleOf = (id) => ALL_TOC.find((t) => t.id === id)?.title ?? '';

// ====================================================================== render
function renderStats() {
  const el = qs('#g-stats');
  if (!el) return;
  const ready = VIDEOS.filter((v) => parseVideo(v.url)).length;
  const items = [
    [TOPICS.length, 'หัวข้อคู่มือ'],
    [GROUPS.length, 'หมวดหมู่'],
    [FAQ.length, 'คำถามที่พบบ่อย'],
    ...(ready ? [[ready, 'วิดีโอสอน']] : []),
  ];
  el.innerHTML = items.map(([n, l]) => `<div class="g-stat"><dt>${esc(l)}</dt><dd data-count>${n}</dd></div>`).join('');
}

function renderToc() {
  const nav = qs('#g-toc-list');
  const link = (t) => `<li><a class="g-toc-link" href="#${t.id}" data-goto="${t.id}">
      <span class="g-toc-ico">${t.num ? `<span class="g-toc-num">${t.num}</span>` : ic(t.icon)}</span><span class="g-toc-text">${esc(t.title)}</span></a></li>`;
  nav.innerHTML = `
    <ul class="g-toc-group g-toc-intro">${EXTRA_TOC.map(link).join('')}</ul>
    ${GROUPS.map((g) => `
      <div class="g-toc-block">
        <p class="g-toc-head">${ic(g.icon)}<span>${esc(g.title)}</span></p>
        <ul class="g-toc-group">${TOPICS.filter((t) => t.group === g.id).map(link).join('')}</ul>
      </div>`).join('')}`;
}

function stepHTML(step, i) {
  const tipCls = step.tipType === 'danger' ? 'g-tip-danger' : step.tipType === 'warning' ? 'g-tip-warning' : '';
  return `<li class="g-step">
      <span class="g-step-no" aria-hidden="true">${i + 1}</span>
      <div class="g-step-body">
        <h3 class="g-step-title"><span class="sr-only">ขั้นตอนที่ ${i + 1}: </span>${esc(step.title)}</h3>
        <p>${rich(step.text)}</p>
        ${step.tip ? `<p class="g-tip ${tipCls}">${ic(step.tipType ? 'alert' : 'info')}<span>${rich(step.tip)}</span></p>` : ''}
        ${step.shot?.src ? `<figure class="g-shot"><img src="${esc(step.shot.src)}" alt="${esc(step.shot.alt ?? step.title)}" loading="lazy" decoding="async"></figure>` : ''}
      </div>
    </li>`;
}

function figureHTML(s) {
  if (s.figure?.src) {
    return `<figure class="g-figure"><img src="${esc(s.figure.src)}" alt="${esc(s.figure.alt ?? s.title)}" loading="lazy" decoding="async">${s.figure.caption ? `<figcaption>${esc(s.figure.caption)}</figcaption>` : ''}</figure>`;
  }
  // no real screenshot yet: an honest, labelled placeholder (no fake UI)
  return `<figure class="g-figure g-figure-empty" aria-label="ภาพหน้าจอประกอบ (กำลังจัดเตรียม)">
      <span class="g-figure-ico">${ic('image')}</span>
      <figcaption><strong>ภาพหน้าจอประกอบ: ${esc(s.title)}</strong><span>กำลังจัดเตรียมภาพหน้าจอ ระหว่างนี้โปรดทำตามขั้นตอนด้านบน</span></figcaption>
    </figure>`;
}

function sectionHTML(s, num, user) {
  const mine = user && s.audience !== 'all' && s.audience === user.account_type;
  const video = VIDEOS.find((v) => v.section === s.id && parseVideo(v.url));
  return `<section class="card g-section g-anchor" id="${s.id}" aria-labelledby="${s.id}-h" data-group="${s.group}">
    <header class="g-sec-head">
      <span class="g-sec-icon" aria-hidden="true">${ic(s.icon)}</span>
      <div>
        <p class="g-sec-meta"><span class="g-sec-num">หัวข้อที่ ${num}</span>
          <span class="badge ${s.audience === 'all' ? 'badge-primary' : 'g-badge-aud'}">${ic(s.audience === 'staff' ? 'users' : 'user')}${esc(AUDIENCE[s.audience])}</span>
          ${mine ? '<span class="badge badge-success">ตรงกับบัญชีของคุณ</span>' : ''}</p>
        <h2 id="${s.id}-h" tabindex="-1">${esc(s.title)}</h2>
      </div>
    </header>
    <div class="g-purpose">${ic('checkCircle')}<p><strong>จุดประสงค์:</strong> ${rich(s.purpose)}</p></div>
    ${s.chips?.length ? `<div class="g-chips-wrap"><p class="g-chips-label">${esc(s.chipsLabel ?? 'รายการทดสอบในระบบ')}</p><ul class="g-chips">${s.chips.map((c) => `<li>${esc(c)}</li>`).join('')}</ul></div>` : ''}
    <ol class="g-steps" aria-label="ขั้นตอน ${esc(s.title)}">${s.steps.map(stepHTML).join('')}</ol>
    ${figureHTML(s)}
    ${s.link || video ? `<div class="g-sec-foot">
      ${s.link ? `<a class="btn btn-primary" href="${esc(s.link.href)}">${esc(s.link.label)}${ic('chevron').replace('class="chev"', 'class="g-arrow"')}</a>` : ''}
      ${video ? `<button type="button" class="btn" data-play-video="${esc(video.id)}">${ic('play')}ดูวิดีโอหัวข้อนี้</button>` : ''}
    </div>` : ''}
  </section>`;
}

function overviewHTML() {
  const steps = [
    ['g5', 'clipboard', 'ซักประวัติ'],
    ['g6', 'eye', 'ทดสอบการมองเห็น'],
    ['g7', 'camera', 'สแกนดวงตา'],
    ['g9', 'cpu', 'วิเคราะห์ผลด้วย AI'],
    ['g10', 'file', 'ผลการตรวจ'],
  ];
  return `<section class="card g-overview g-anchor" id="overview" aria-labelledby="overview-h">
    <div class="g-ov-head">
      <div><h2 id="overview-h" tabindex="-1">ภาพรวมขั้นตอนการตรวจคัดกรอง</h2>
      <p class="text-2 mb-0">ทุกการตรวจทำตามลำดับ 5 ขั้นตอนเดียวกันจากเมนู <span class="ui-key">สแกนดวงตา</span> กดแต่ละขั้นเพื่ออ่านวิธีใช้งาน</p></div>
    </div>
    <ol class="g-flow">${steps.map(([id, icon, label], i) => `<li><a href="#${id}" data-goto="${id}" class="g-flow-item">
        <span class="g-flow-ico">${ic(icon)}<span class="g-flow-no">${i + 1}</span></span><span class="g-flow-label">${esc(label)}</span></a></li>`).join('')}</ol>
  </section>`;
}

function videoSectionHTML() {
  return `<section class="card g-section g-video g-anchor" id="video" aria-labelledby="video-h">
    <header class="g-sec-head">
      <span class="g-sec-icon g-sec-icon-video" aria-hidden="true">${ic('play')}</span>
      <div><p class="g-sec-meta"><span class="g-sec-num">Video Tutorial</span></p>
      <h2 id="video-h" tabindex="-1">วิดีโอสอนการใช้งาน</h2></div>
    </header>
    <div class="gv-player">
      <div class="gv-stage" id="gv-stage" aria-live="polite"></div>
      <div class="gv-info" id="gv-info"></div>
    </div>
    <div class="gv-list-head"><h3 class="mb-0">รายการวิดีโอ</h3><span class="small muted">${VIDEOS.length} บทเรียน</span></div>
    <ul class="gv-list" id="gv-list"></ul>
  </section>`;
}

function cautionsHTML() {
  const [first, ...rest] = CAUTIONS;
  const card = (c, wide = false) => `<li class="g-caution g-tone-${c.tone}${wide ? ' g-caution-wide' : ''}">
      <span class="g-caution-ico" aria-hidden="true">${ic(c.icon)}</span>
      <div><h3>${esc(c.title)}</h3><p>${esc(c.text)}</p></div></li>`;
  return `<section class="card g-section g-anchor" id="g15" aria-labelledby="g15-h" data-group="help">
    <header class="g-sec-head">
      <span class="g-sec-icon g-sec-icon-warn" aria-hidden="true">${ic('alert')}</span>
      <div><p class="g-sec-meta"><span class="g-sec-num">หัวข้อที่ 15</span><span class="badge badge-primary">${ic('user')}ทุกบัญชี</span></p>
      <h2 id="g15-h" tabindex="-1">ข้อควรระวังในการใช้งาน</h2></div>
    </header>
    <ul class="g-cautions">${card(first, true)}${rest.map((c) => card(c)).join('')}</ul>
  </section>`;
}

function faqHTML() {
  return `<section class="card g-section g-anchor" id="faq" aria-labelledby="faq-h" data-group="help">
    <header class="g-sec-head">
      <span class="g-sec-icon" aria-hidden="true">${ic('info')}</span>
      <div class="grow"><p class="g-sec-meta"><span class="g-sec-num">หัวข้อที่ 16</span></p>
      <h2 id="faq-h" tabindex="-1">คำถามที่พบบ่อย (FAQ)</h2></div>
      <button type="button" class="btn btn-sm btn-ghost g-faq-all" id="faq-all" aria-pressed="false">เปิดทั้งหมด</button>
    </header>
    <div class="g-faq">${FAQ.map((f, i) => `
      <div class="faq-item" id="faq-${i + 1}">
        <h3 class="faq-h"><button type="button" class="faq-q" id="faq-${i + 1}-q" aria-expanded="false" aria-controls="faq-${i + 1}-a">
          <span>${esc(f.q)}</span><span class="faq-sign" aria-hidden="true"></span></button></h3>
        <div class="faq-a" id="faq-${i + 1}-a" role="region" aria-labelledby="faq-${i + 1}-q" inert><div class="faq-a-inner"><p>${esc(f.a)}</p></div></div>
      </div>`).join('')}
    </div>
  </section>`;
}

function ctaHTML(user) {
  const actions = user
    ? `<a class="btn btn-accent btn-lg" href="/pages/medical-history.html">${ic('eye')}เริ่มตรวจคัดกรอง</a><a class="btn btn-lg g-btn-light" href="/pages/dashboard.html">${ic('chart')}ไปที่แดชบอร์ด</a>`
    : `<a class="btn btn-accent btn-lg" href="/pages/register.html">${ic('user')}สมัครสมาชิก</a><a class="btn btn-lg g-btn-light" href="/pages/login.html">${ic('lock')}เข้าสู่ระบบ</a>`;
  return `<section class="g-cta" aria-labelledby="cta-h">
    <div><h2 id="cta-h">${user ? 'พร้อมเริ่มตรวจคัดกรองแล้ว' : 'พร้อมเริ่มใช้งาน EYE Check'}</h2>
    <p>${user ? 'ทำตาม 5 ขั้นตอนตั้งแต่ซักประวัติจนถึงผลการตรวจ กลับมาที่คู่มือนี้ได้ทุกเมื่อจากเมนู “คู่มือการใช้งาน”' : 'สมัครสมาชิกฟรี เลือกบัญชีส่วนบุคคลหรือบัญชี อสม./เจ้าหน้าที่ แล้วเริ่มตรวจคัดกรองได้ทันที'}</p></div>
    <div class="g-cta-actions">${actions}</div>
  </section>`;
}

// ====================================================================== navigation
let offsetPx = 100;
function measureOffset() {
  const header = qs('#site-header');
  const bar = matchMedia(MOBILE).matches ? qs('.g-side') : null;
  // the header may still be empty while it loads: never use less than its CSS height
  const headerH = Math.max(header?.getBoundingClientRect().height ?? 0, parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--header-h')) || 68);
  offsetPx = Math.round(headerH + (bar?.getBoundingClientRect().height ?? 0) + 16);
  document.documentElement.style.setProperty('--g-offset', `${offsetPx}px`);
}

function goTo(id, { focus = true } = {}) {
  const el = document.getElementById(id);
  if (!el) return;
  closeSearch();
  closeMobileToc();
  measureOffset();
  if (el.classList.contains('faq-item')) { setFaq(el, true); syncFaqAll(); }
  el.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' });
  try { history.replaceState(null, '', `#${id}`); } catch { /* ignore */ }
  if (focus) (qs('h2[tabindex], .faq-q', el) ?? el).focus({ preventScroll: true });
  el.classList.remove('g-flash');
  void el.offsetWidth; // restart the highlight animation
  el.classList.add('g-flash');
  el.addEventListener('animationend', () => el.classList.remove('g-flash'), { once: true });
}

function initLinks() {
  document.addEventListener('click', (e) => {
    const a = e.target.closest('[data-goto]');
    if (!a) return;
    e.preventDefault();
    goTo(a.dataset.goto);
  });
}

// ---------------- table of contents: scroll spy + reading progress + mobile panel
let tocLinks = [];
let anchors = [];
function initScrollSpy() {
  tocLinks = qsa('.g-toc-link');
  anchors = ALL_TOC.map((t) => document.getElementById(t.id)).filter(Boolean);
  const content = qs('#guide-content');
  const bar = qs('#g-progress');
  const pctEl = qs('#g-progress-pct');
  const label = qs('#g-toc-current');
  const toTop = qs('#g-top');
  let current = null;
  let ticking = false;

  const update = () => {
    ticking = false;
    const line = offsetPx + 40;
    let active = anchors[0]?.id;
    for (const el of anchors) if (el.getBoundingClientRect().top <= line) active = el.id;
    if (innerHeight + scrollY >= document.documentElement.scrollHeight - 4) active = anchors.at(-1)?.id ?? active;
    if (anchors[0] && anchors[0].getBoundingClientRect().top > innerHeight * 0.6) active = null; // still in the hero
    if (active !== current) {
      current = active;
      tocLinks.forEach((a) => (a.dataset.goto === active ? a.setAttribute('aria-current', 'location') : a.removeAttribute('aria-current')));
      if (label) label.textContent = active ? titleOf(active) : 'เลือกหัวข้อที่ต้องการอ่าน';
      const link = tocLinks.find((a) => a.dataset.goto === active);
      const list = qs('.g-toc-scroll');
      if (link && list && !matchMedia(MOBILE).matches) {
        const lr = link.getBoundingClientRect();
        const cr = list.getBoundingClientRect();
        if (lr.top < cr.top + 8 || lr.bottom > cr.bottom - 8) list.scrollTop += lr.top - cr.top - cr.height / 2;
      }
    }
    // reading progress through the manual content
    const r = content.getBoundingClientRect();
    const total = r.height - innerHeight * 0.5;
    const p = Math.max(0, Math.min(1, (offsetPx - r.top) / Math.max(1, total)));
    if (bar) bar.style.transform = `scaleX(${p})`;
    if (pctEl) pctEl.textContent = `${Math.round(p * 100)}%`;
    toTop?.classList.toggle('show', scrollY > 700);
  };
  const onScroll = () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } };
  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', () => { measureOffset(); onScroll(); }, { passive: true });
  update();

  toTop?.addEventListener('click', () => {
    scrollTo({ top: 0, behavior: reduced() ? 'auto' : 'smooth' });
    qs('#g-search')?.focus({ preventScroll: true });
  });
}

function closeMobileToc() {
  const btn = qs('#g-toc-toggle');
  if (!btn || btn.getAttribute('aria-expanded') !== 'true') return;
  btn.setAttribute('aria-expanded', 'false');
  qs('#g-toc').classList.remove('open');
}
function initMobileToc() {
  const btn = qs('#g-toc-toggle');
  const panel = qs('#g-toc');
  btn.addEventListener('click', () => {
    const open = btn.getAttribute('aria-expanded') !== 'true';
    btn.setAttribute('aria-expanded', String(open));
    panel.classList.toggle('open', open);
    if (open) qs('[aria-current], .g-toc-link', panel)?.focus({ preventScroll: true });
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && btn.getAttribute('aria-expanded') === 'true') { closeMobileToc(); btn.focus(); } });
  document.addEventListener('click', (e) => { if (!e.target.closest('.g-side')) closeMobileToc(); });
}

// ====================================================================== search
let INDEX = [];
function buildIndex() {
  const groupTitle = (id) => GROUPS.find((g) => g.id === id)?.title ?? '';
  INDEX = [
    ...SECTIONS.map((s, i) => ({
      target: s.id, kind: 'หัวข้อ', icon: s.icon, title: `${i + 1}. ${s.title}`, group: groupTitle(s.group),
      parts: [s.purpose, ...(s.chips ?? []), ...s.steps.flatMap((st) => [`${st.title}: ${plain(st.text)}`, st.tip ?? ''])].map(plain).filter(Boolean),
      keywords: s.keywords ?? '',
    })),
    { target: 'g15', kind: 'หัวข้อ', icon: 'alert', title: '15. ข้อควรระวังในการใช้งาน', group: 'ความช่วยเหลือ', parts: CAUTIONS.map((c) => `${c.title}: ${c.text}`), keywords: 'ข้อควรระวัง caution คำเตือน' },
    ...FAQ.map((f, i) => ({ target: `faq-${i + 1}`, kind: 'FAQ', icon: 'info', title: f.q, group: 'คำถามที่พบบ่อย', parts: [f.a], keywords: 'faq คำถาม' })),
    ...VIDEOS.map((v) => ({ target: 'video', video: v.id, kind: 'วิดีโอ', icon: 'play', title: v.title, group: `วิดีโอ · ${v.category}`, parts: [v.description], keywords: 'video วิดีโอ' })),
    ...EXTRA_TOC.filter((t) => t.id === 'overview').map((t) => ({ target: t.id, kind: 'หัวข้อ', icon: t.icon, title: t.title, group: 'เริ่มต้นใช้งาน', parts: ['ซักประวัติ ทดสอบการมองเห็น สแกนดวงตา วิเคราะห์ผลด้วย AI ผลการตรวจ'], keywords: 'ภาพรวม ขั้นตอน workflow' })),
  ];
}

const norm = (s) => String(s).toLowerCase();
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function highlight(text, terms) {
  if (!terms.length) return esc(text);
  const re = new RegExp(`(${terms.map(reEsc).join('|')})`, 'gi');
  return text.split(re).map((part, i) => (i % 2 ? `<mark>${esc(part)}</mark>` : esc(part))).join('');
}

function search(query) {
  const terms = norm(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const out = [];
  for (const item of INDEX) {
    const title = norm(item.title);
    const body = item.parts.map(norm);
    const hay = `${title} ${body.join(' ')} ${norm(item.keywords)} ${norm(item.group)}`;
    if (!terms.every((t) => hay.includes(t))) continue;
    let score = 0;
    for (const t of terms) {
      if (title.includes(t)) score += title.startsWith(t) ? 14 : 10;
      else if (norm(item.keywords).includes(t)) score += 5;
      else score += 2;
    }
    if (item.kind === 'หัวข้อ') score += 1;
    // snippet: the part that contains the most terms
    let best = '';
    let bestHits = -1;
    for (let i = 0; i < body.length; i++) {
      const hits = terms.filter((t) => body[i].includes(t)).length;
      if (hits > bestHits) { bestHits = hits; best = item.parts[i]; }
    }
    if (bestHits > 0) {
      const at = Math.max(0, norm(best).indexOf(terms.find((t) => norm(best).includes(t))) - 36);
      best = `${at > 0 ? '…' : ''}${best.slice(at, at + 120)}${best.length > at + 120 ? '…' : ''}`;
    } else best = item.parts[0]?.slice(0, 110) ?? '';
    out.push({ item, score, snippet: best });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 8);
}

let activeIdx = -1;
let results = [];
function closeSearch() {
  const box = qs('#g-results');
  const input = qs('#g-search');
  if (!box || box.hidden) return;
  box.hidden = true;
  input.setAttribute('aria-expanded', 'false');
  input.removeAttribute('aria-activedescendant');
  activeIdx = -1;
}

function renderResults(query) {
  const box = qs('#g-results');
  const input = qs('#g-search');
  const status = qs('#g-search-status');
  const q = query.trim();
  qs('#g-search-clear').hidden = !query;
  if (!q) { closeSearch(); status.textContent = ''; return; }
  results = search(q);
  activeIdx = -1;
  input.removeAttribute('aria-activedescendant');
  const terms = norm(q).split(/\s+/).filter(Boolean);
  if (!results.length) {
    box.innerHTML = `<div class="g-empty">${ic('search')}<p><strong>ไม่พบหัวข้อที่ตรงกับ “${esc(q)}”</strong>ลองใช้คำที่สั้นลง หรือเลือกคำค้นยอดนิยม</p>
      <div class="g-suggest">${['สมัครสมาชิก', 'กล้อง', 'อัปโหลด', 'รหัสผ่าน', 'พิมพ์'].map((s) => `<button type="button" class="g-suggest-btn" data-suggest="${esc(s)}">${esc(s)}</button>`).join('')}</div></div>`;
    status.textContent = 'ไม่พบผลการค้นหา';
  } else {
    box.innerHTML = `<p class="g-results-count">พบ ${results.length} รายการ</p><ul role="listbox" id="g-listbox" aria-label="ผลการค้นหาคู่มือ">${results.map((r, i) => `
      <li role="option" id="g-opt-${i}" aria-selected="false" data-idx="${i}" class="g-result">
        <span class="g-result-ico">${ic(r.item.icon)}</span>
        <span class="g-result-body"><span class="g-result-meta"><span class="g-kind">${esc(r.item.kind)}</span>${esc(r.item.group)}</span>
        <span class="g-result-title">${highlight(r.item.title, terms)}</span>
        <span class="g-result-snip">${highlight(r.snippet, terms)}</span></span>
      </li>`).join('')}</ul>`;
    status.textContent = `พบ ${results.length} รายการ`;
  }
  box.hidden = false;
  input.setAttribute('aria-expanded', 'true');
}

function setActive(i) {
  const opts = qsa('.g-result');
  if (!opts.length) return;
  activeIdx = (i + opts.length) % opts.length;
  opts.forEach((o, k) => o.setAttribute('aria-selected', String(k === activeIdx)));
  const el = opts[activeIdx];
  qs('#g-search').setAttribute('aria-activedescendant', el.id);
  el.scrollIntoView({ block: 'nearest' });
}

function choose(i) {
  const r = results[i];
  if (!r) return;
  if (r.item.video) selectVideo(r.item.video, { scroll: false });
  goTo(r.item.target);
}

function initSearch() {
  const input = qs('#g-search');
  const box = qs('#g-results');
  const clear = qs('#g-search-clear');
  input.addEventListener('input', () => renderResults(input.value));
  input.addEventListener('focus', () => { if (input.value.trim()) renderResults(input.value); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (box.hidden) renderResults(input.value); setActive(activeIdx + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(activeIdx - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); choose(activeIdx >= 0 ? activeIdx : 0); }
    else if (e.key === 'Escape') { if (!box.hidden) { e.preventDefault(); closeSearch(); } else if (input.value) { input.value = ''; renderResults(''); } }
  });
  qs('#g-search-form').addEventListener('submit', (e) => { e.preventDefault(); choose(activeIdx >= 0 ? activeIdx : 0); });
  box.addEventListener('mousedown', (e) => { if (e.target.closest('.g-result, [data-suggest]')) e.preventDefault(); }); // keep focus in the input
  box.addEventListener('click', (e) => {
    const opt = e.target.closest('.g-result');
    if (opt) { choose(Number(opt.dataset.idx)); return; }
    const sug = e.target.closest('[data-suggest]');
    if (sug) { input.value = sug.dataset.suggest; renderResults(input.value); input.focus(); }
  });
  clear.addEventListener('click', () => { input.value = ''; renderResults(''); input.focus(); });
  document.addEventListener('click', (e) => { if (!e.target.closest('.g-search')) closeSearch(); });
  // "/" focuses the search (when not typing elsewhere)
  document.addEventListener('keydown', (e) => {
    if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target.closest('input, textarea, select, [contenteditable="true"]')) return;
    e.preventDefault();
    input.focus();
    input.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'center' });
  });
}

// ====================================================================== video
/** YouTube link → {type:'youtube', id}; any other http(s) URL → {type:'file', src}; empty/invalid → null */
function parseVideo(url) {
  if (!url) return null;
  try {
    const u = new URL(url, location.href);
    if (!/^https?:$/.test(u.protocol)) return null;
    const host = u.hostname.replace(/^(www|m)\./, '');
    if (host === 'youtu.be' || host === 'youtube.com' || host === 'youtube-nocookie.com') {
      const id = host === 'youtu.be' ? u.pathname.slice(1).split('/')[0] : u.searchParams.get('v') ?? u.pathname.match(/^\/(?:embed|shorts|live)\/([^/?#]+)/)?.[1];
      return /^[\w-]{11}$/.test(id ?? '') ? { type: 'youtube', id } : null;
    }
    return { type: 'file', src: u.href };
  } catch { return null; }
}
const posterOf = (v, src) => v.poster || (src?.type === 'youtube' ? `https://i.ytimg.com/vi/${src.id}/hqdefault.jpg` : '');

let currentVideo = null;
const fileVideos = new Map(); // id → <video> (kept so going back to a video does not download it again)

function renderVideoList() {
  qs('#gv-list').innerHTML = VIDEOS.map((v, i) => {
    const src = parseVideo(v.url);
    const poster = posterOf(v, src);
    return `<li><button type="button" class="gv-item" data-video="${esc(v.id)}" aria-pressed="false">
      <span class="gv-thumb${poster ? ' has-img' : ''}">${poster ? `<img src="${esc(poster)}" alt="" loading="lazy" decoding="async">` : ic(src ? 'play' : 'clock')}
        ${src ? `<span class="gv-thumb-play">${ic('play')}</span>` : ''}</span>
      <span class="gv-item-body"><span class="gv-item-cat">บทที่ ${i + 1} · ${esc(v.category)}</span>
        <span class="gv-item-title">${esc(v.title)}</span>
        <span class="gv-item-meta">${src ? `${ic('clock')}${esc(v.duration || 'พร้อมรับชม')}` : '<span class="gv-soon">กำลังจัดเตรียม</span>'}</span></span>
    </button></li>`;
  }).join('');
  qs('#gv-list').addEventListener('click', (e) => {
    const b = e.target.closest('[data-video]');
    if (b) selectVideo(b.dataset.video, { scroll: true });
  });
  // thumbnails fade in once loaded; a broken thumbnail falls back to the icon
  qsa('.gv-thumb img, .gv-poster img').forEach(watchImg);
}

function watchImg(img) {
  const done = () => img.closest('.gv-thumb, .gv-poster')?.classList.add('loaded');
  if (img.complete && img.naturalWidth) done();
  else {
    img.addEventListener('load', done, { once: true });
    img.addEventListener('error', () => { img.closest('.gv-thumb, .gv-poster')?.classList.add('loaded', 'no-img'); img.remove(); }, { once: true });
  }
}

function stopCurrent() {
  const stage = qs('#gv-stage');
  const kept = new Set(fileVideos.values());
  stage.querySelectorAll('video').forEach((v) => {
    v.pause();
    if (!kept.has(v)) { v.removeAttribute('src'); v.load(); v.remove(); } // still loading: cancel the download
  });
  stage.querySelectorAll('iframe').forEach((f) => f.remove()); // stops YouTube playback
}

function selectVideo(id, { scroll = false } = {}) {
  const v = VIDEOS.find((x) => x.id === id) ?? VIDEOS[0];
  if (!v) return;
  if (currentVideo !== v.id) { stopCurrent(); currentVideo = v.id; renderStage(v); }
  qsa('.gv-item').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.video === v.id)));
  const src = parseVideo(v.url);
  qs('#gv-info').innerHTML = `
    <div class="gv-info-meta"><span class="badge badge-primary">${esc(v.category)}</span>
      ${src ? `<span class="gv-dur">${ic('clock')}${esc(v.duration || 'ไม่ระบุความยาว')}</span>` : '<span class="badge g-badge-soon">กำลังจัดเตรียม</span>'}</div>
    <h3>${esc(v.title)}</h3>
    <p class="text-2 mb-0">${esc(v.description)}</p>
    ${v.section ? `<a class="gv-read" href="#${esc(v.section)}" data-goto="${esc(v.section)}">${ic('book')}อ่านคู่มือหัวข้อ “${esc(titleOf(v.section))}”</a>` : ''}`;
  if (scroll) qs('#video').scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' });
}

function renderStage(v) {
  const stage = qs('#gv-stage');
  const src = parseVideo(v.url);
  stage.className = 'gv-stage';
  if (!src) {
    stage.innerHTML = `<div class="gv-empty">
      <span class="gv-empty-ico">${ic('play')}</span>
      <strong>วิดีโอสอนการใช้งานกำลังจัดเตรียม</strong>
      <span>บทเรียน “${esc(v.title)}” จะเผยแพร่เร็ว ๆ นี้ ระหว่างนี้โปรดใช้คู่มือแบบขั้นตอนด้านล่าง</span>
    </div>`;
    return;
  }
  if (src.type === 'file' && fileVideos.has(v.id)) { // already loaded once: reuse, no new download
    stage.replaceChildren(fileVideos.get(v.id));
    stage.classList.add('is-playing');
    return;
  }
  const poster = posterOf(v, src);
  stage.innerHTML = `<div class="gv-poster${poster ? '' : ' loaded no-img'}">
      ${poster ? `<img src="${esc(poster)}" alt="" decoding="async">` : ''}
      <button type="button" class="gv-play" aria-label="เล่นวิดีโอ: ${esc(v.title)}">${ic('play')}</button>
      <span class="gv-poster-title">${esc(v.title)}${v.duration ? ` · ${esc(v.duration)}` : ''}</span>
    </div>`;
  const img = qs('.gv-poster img', stage);
  if (img) watchImg(img);
  qs('.gv-play', stage).addEventListener('click', () => play(v, src));
}

function stageState(kind, v, src) {
  const stage = qs('#gv-stage');
  const layer = document.createElement('div');
  layer.className = `gv-layer gv-${kind}`;
  if (kind === 'loading') layer.innerHTML = `<span class="gv-spinner" aria-hidden="true"></span><span>กำลังโหลดวิดีโอ...</span>`;
  else {
    const offline = !navigator.onLine;
    layer.setAttribute('role', 'alert');
    layer.innerHTML = `${ic(offline ? 'wifiOff' : 'xCircle')}<strong>${offline ? 'ไม่มีการเชื่อมต่ออินเทอร์เน็ต' : 'ไม่สามารถเล่นวิดีโอนี้ได้'}</strong>
      <span>${offline ? 'กรุณาเชื่อมต่ออินเทอร์เน็ตแล้วลองอีกครั้ง' : 'ไฟล์วิดีโออาจไม่พร้อมใช้งานหรือเบราว์เซอร์ไม่รองรับ'}</span>
      <button type="button" class="btn btn-sm g-btn-light">${ic('refresh')}ลองอีกครั้ง</button>`;
    qs('button', layer).addEventListener('click', () => { fileVideos.delete(v.id); currentVideo = null; selectVideo(v.id); play(v, src); });
  }
  stage.querySelectorAll('.gv-layer').forEach((l) => l.remove());
  stage.append(layer);
  return layer;
}

function play(v, src) {
  const stage = qs('#gv-stage');
  if (!navigator.onLine) { stageState('error', v, src); return; }
  const loading = stageState('loading', v, src);
  // only the player that is still on screen may show an error (a cancelled one is detached)
  const fail = (media) => {
    if (!media.isConnected || currentVideo !== v.id) return;
    media.remove();
    fileVideos.delete(v.id);
    stageState('error', v, src);
  };
  if (src.type === 'youtube') {
    const f = document.createElement('iframe');
    f.src = `https://www.youtube-nocookie.com/embed/${src.id}?autoplay=1&rel=0&playsinline=1`;
    f.title = v.title;
    f.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
    f.allowFullscreen = true;
    f.referrerPolicy = 'strict-origin-when-cross-origin';
    f.className = 'gv-media';
    const timer = setTimeout(() => fail(f), 20000);
    f.addEventListener('load', () => { clearTimeout(timer); loading.remove(); stage.classList.add('is-playing'); qs('.gv-poster', stage)?.remove(); }, { once: true });
    stage.append(f);
    return;
  }
  const video = document.createElement('video');
  video.className = 'gv-media';
  video.controls = true;
  video.playsInline = true;
  video.preload = 'auto';
  if (v.poster) video.poster = v.poster;
  video.setAttribute('aria-label', v.title);
  video.src = src.src;
  video.addEventListener('error', () => fail(video), { once: true });
  video.addEventListener('canplay', () => {
    loading.remove();
    qs('.gv-poster', stage)?.remove();
    stage.classList.add('is-playing');
    fileVideos.set(v.id, video);
    video.play().catch(() => { /* the user can press play on the controls */ });
  }, { once: true });
  stage.append(video);
}

// ====================================================================== FAQ accordion
function setFaq(item, open) {
  const btn = qs('.faq-q', item);
  const panel = qs('.faq-a', item);
  btn.setAttribute('aria-expanded', String(open));
  item.classList.toggle('open', open);
  panel.inert = !open;
}
function syncFaqAll() {
  const all = qs('#faq-all');
  const items = qsa('.faq-item');
  const allOpen = items.every((i) => i.classList.contains('open'));
  all.textContent = allOpen ? 'ปิดทั้งหมด' : 'เปิดทั้งหมด';
  all.setAttribute('aria-pressed', String(allOpen));
}
function initFaq() {
  qs('.g-faq').addEventListener('click', (e) => {
    const btn = e.target.closest('.faq-q');
    if (!btn) return;
    const item = btn.closest('.faq-item');
    setFaq(item, !item.classList.contains('open'));
    syncFaqAll();
  });
  qs('#faq-all').addEventListener('click', () => {
    const open = qs('#faq-all').getAttribute('aria-pressed') !== 'true';
    qsa('.faq-item').forEach((i) => setFaq(i, open));
    syncFaqAll();
  });
}

// ====================================================================== step progress (animated as steps scroll into view)
function initStepProgress() {
  const steps = qsa('.g-step');
  if (reduced() || !('IntersectionObserver' in window)) { steps.forEach((s) => s.classList.add('is-seen')); return; }
  const io = new IntersectionObserver((entries) => entries.forEach((e) => {
    if (!e.isIntersecting) return;
    e.target.classList.add('is-seen');
    io.unobserve(e.target);
  }), { rootMargin: '0px 0px -15% 0px' });
  steps.forEach((s) => io.observe(s));
}

// ====================================================================== start
export async function init() {
  const user = await getCurrentUser().catch(() => null);
  const content = qs('#guide-content');
  content.innerHTML = [
    overviewHTML(),
    videoSectionHTML(),
    ...SECTIONS.map((s, i) => sectionHTML(s, i + 1, user)),
    cautionsHTML(),
    faqHTML(),
    ctaHTML(user),
  ].join('');
  content.setAttribute('aria-busy', 'false');

  renderStats();
  renderToc();
  buildIndex();
  renderVideoList();
  selectVideo(VIDEOS[0]?.id);
  content.addEventListener('click', (e) => {
    const b = e.target.closest('[data-play-video]');
    if (b) selectVideo(b.dataset.playVideo, { scroll: true });
  });
  initLinks();
  initSearch();
  initFaq();
  initMobileToc();
  measureOffset();
  initScrollSpy();
  initStepProgress();
  addEventListener('pagehide', stopCurrent);
  // hash changed without a reload (typed URL, Back/Forward between anchors): same behaviour as a TOC click
  addEventListener('hashchange', () => {
    const id = decodeURIComponent(location.hash.slice(1));
    if (id && document.getElementById(id)) goTo(id, { focus: false });
  });

  // deep link (#g6, #faq-2 …): the content is rendered by JS, so jump after rendering
  const hash = decodeURIComponent(location.hash.slice(1));
  if (hash && document.getElementById(hash)) {
    requestAnimationFrame(() => {
      const el = document.getElementById(hash);
      if (el.classList.contains('faq-item')) { setFaq(el, true); syncFaqAll(); }
      el.scrollIntoView({ block: 'start' });
    });
  }
}
