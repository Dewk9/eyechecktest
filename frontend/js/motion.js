/**
 * Motion system (UI only, no business logic). Started once by app.js:
 *  - entrance: content a page renders gets a short staggered fade-up; content that starts
 *    below the fold is revealed when scrolled into view (IntersectionObserver)
 *  - number counters for stat tiles (always end on the exact text the page rendered;
 *    a re-rendered value counts from the previous value: smooth data updates)
 *  - pauses decorative animations that are scrolled out of view
 *  - tooltips for icon-only buttons and [data-tip] elements
 * Everything is skipped when the user prefers reduced motion.
 */
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

const REVEAL = '.card, .table-wrap, .gallery > *, .class-cards > *, .health-grid > *, .alert';
const SKIP = '[data-no-reveal], .modal, .fc, .sc, .bs-overlay, .loader, .sk, .toast-region';
const PAUSE = '.scan-anim, .fc-stage, .hero-art, .loader';
const MAX_STAGGER = 8;

let revealIO;
let pauseIO;
const counted = new Map(); // stat key → last value (for smooth updates)
const seen = new Set(); // elements that already made their entrance (auto-refresh re-renders stay calm)
const signature = (el) => `${el.tagName}.${[...el.classList].filter((c) => !c.startsWith('rv')).join('.')}|${(el.querySelector('h1, h2, h3, .stat-label')?.textContent ?? el.textContent).trim().slice(0, 48)}`;

// ------------------------------------------------------------ entrance + scroll reveal
function candidates(node) {
  const list = node.matches?.(REVEAL) ? [node] : [];
  node.querySelectorAll?.(REVEAL).forEach((el) => list.push(el));
  // only the outermost animated element (no nested double animation)
  return list.filter((el) => !el.closest(SKIP) && !list.some((o) => o !== el && o.contains(el)) && !el.parentElement?.closest('.rv, .rv-now'));
}

function enter(nodes) {
  const vh = window.innerHeight;
  let i = 0;
  for (const el of nodes) {
    const r = el.getBoundingClientRect();
    if (!r.width && !r.height) continue; // hidden (e.g. inactive tab)
    const sig = signature(el);
    if (seen.has(sig)) continue; // same element re-rendered with new data: no second entrance
    seen.add(sig);
    if (r.top < vh) {
      // in view now: staggered entrance
      el.style.setProperty('--rv-i', String(Math.min(i++, MAX_STAGGER)));
      el.classList.add('rv-now');
      el.addEventListener('animationend', () => { el.classList.remove('rv-now'); el.style.removeProperty('--rv-i'); }, { once: true });
    } else {
      // below the fold: reveal on scroll
      el.classList.add('rv');
      revealIO.observe(el);
    }
  }
}

function onReveal(entries) {
  let i = 0;
  entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top).forEach((e) => {
    const el = e.target;
    revealIO.unobserve(el);
    el.style.setProperty('--rv-i', String(Math.min(i++, MAX_STAGGER)));
    el.classList.add('rv-in');
    const done = () => { el.classList.remove('rv', 'rv-in'); el.style.removeProperty('--rv-i'); };
    el.addEventListener('transitionend', done, { once: true });
    setTimeout(done, 1200); // fallback
  });
}

// ------------------------------------------------------------ number counters
const NUM = /^(\D*?)(-?\d[\d,]*(?:\.\d+)?)(\D*)$/;
const easeOut = (t) => 1 - (1 - t) ** 3;

function statKey(el) {
  const label = el.parentElement?.querySelector('.stat-label')?.textContent ?? '';
  return `${location.pathname}|${label}`;
}

function countUp(el) {
  if (el.dataset.counted || el.children.length) return; // only plain-text values
  const text = el.textContent.trim();
  const m = text.match(NUM);
  if (!m) return;
  const target = Number(m[2].replace(/,/g, ''));
  if (!Number.isFinite(target)) return;
  el.dataset.counted = '1';
  const key = statKey(el);
  const from = counted.get(key) ?? 0;
  counted.set(key, target);
  if (from === target) return;
  const decimals = (m[2].split('.')[1] ?? '').length;
  const grouped = m[2].includes(',') || Math.abs(target) >= 1000;
  const fmt = (v) => (grouped
    ? v.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
    : v.toFixed(decimals));
  const dur = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--dur-counter')) * 1000 || 900;
  let start = 0;
  const step = (t) => {
    if (!el.isConnected) return;
    if (!start) start = t;
    const p = Math.min(1, (t - start) / dur);
    if (p >= 1) { el.textContent = text; return; } // always end on the exact rendered text
    el.textContent = `${m[1]}${fmt(from + (target - from) * easeOut(p))}${m[3]}`;
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function counters(node) {
  const list = node.matches?.('.stat-value, [data-count]') ? [node] : [...(node.querySelectorAll?.('.stat-value, [data-count]') ?? [])];
  list.forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.top < window.innerHeight) countUp(el);
    else counterIO.observe(el);
  });
}
const counterIO = 'IntersectionObserver' in window
  ? new IntersectionObserver((entries) => entries.forEach((e) => { if (e.isIntersecting) { counterIO.unobserve(e.target); countUp(e.target); } }))
  : null;

// ------------------------------------------------------------ pause off-screen animations
function watchPause(node) {
  const list = node.matches?.(PAUSE) ? [node] : [...(node.querySelectorAll?.(PAUSE) ?? [])];
  list.forEach((el) => pauseIO.observe(el));
}

// ------------------------------------------------------------ tooltips
function initTooltips() {
  const tip = document.createElement('div');
  tip.className = 'tip';
  tip.setAttribute('aria-hidden', 'true'); // the element already has an accessible name
  document.body.append(tip);
  let current = null;
  let timer = 0;
  let savedTitle = null;
  const textOf = (el) => el.dataset.tip || el.getAttribute('aria-label') || '';
  const target = (e) => e.target.closest?.('[data-tip], .btn-icon[aria-label], .font-controls button[aria-label]');
  const hide = () => {
    clearTimeout(timer);
    tip.classList.remove('show');
    if (current && savedTitle !== null) current.setAttribute('title', savedTitle);
    current = null;
    savedTitle = null;
  };
  const show = (el) => {
    const text = textOf(el);
    if (!text || !el.isConnected) return;
    current = el;
    if (el.hasAttribute('title')) { savedTitle = el.getAttribute('title'); el.removeAttribute('title'); } // no double tooltip
    tip.textContent = text;
    const r = el.getBoundingClientRect();
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    const below = r.top < h + 12;
    tip.classList.toggle('below', below);
    tip.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2))}px`;
    tip.style.top = `${below ? r.bottom + 8 : r.top - h - 8}px`;
    requestAnimationFrame(() => tip.classList.add('show'));
  };
  document.addEventListener('pointerover', (e) => {
    if (e.pointerType !== 'mouse') return;
    const el = target(e);
    if (el === current) return;
    hide();
    if (el) timer = setTimeout(() => show(el), 350);
  });
  document.addEventListener('pointerout', (e) => { const el = target(e); if (el && !el.contains(e.relatedTarget)) hide(); });
  document.addEventListener('focusin', (e) => { const el = target(e); hide(); if (el?.matches(':focus-visible')) show(el); });
  document.addEventListener('focusout', hide);
  ['scroll', 'click', 'keydown'].forEach((t) => window.addEventListener(t, hide, { passive: true, capture: true }));
}

// ------------------------------------------------------------ start
export function initMotion() {
  if (!('IntersectionObserver' in window) || !('MutationObserver' in window)) return;
  initTooltips();
  if (reduced()) return; // no entrance / counters / reveal with reduced motion
  revealIO = new IntersectionObserver(onReveal, { rootMargin: '0px 0px -8% 0px' });
  pauseIO = new IntersectionObserver((entries) => entries.forEach((e) => e.target.classList.toggle('is-offscreen', !e.isIntersecting)));
  const root = document.getElementById('main') ?? document.body;
  const handle = (nodes) => {
    const els = nodes.filter((n) => n.nodeType === 1);
    if (!els.length) return;
    enter(els.flatMap(candidates));
    els.forEach((n) => { counters(n); watchPause(n); });
  };
  handle([...root.children]);
  new MutationObserver((records) => handle(records.flatMap((r) => [...r.addedNodes]))).observe(root, { childList: true, subtree: true });
}
