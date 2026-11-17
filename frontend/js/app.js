/**
 * Application bootstrap — loaded by every page:
 *   <body data-page="dashboard"> … <script type="module" src="/js/app.js"></script>
 * Renders the shared header/footer, sets up offline detection and anonymous
 * page-view tracking, then loads the page module named in data-page.
 */
import { initNavigation } from './navigation.js';
import { renderFooter } from '../components/footer.js';
import { initPasswordToggles } from '../components/password-toggle.js';
import { initMotion } from './motion.js';
import { api } from './api.js';
import { icons } from './icons.js';
import { renderErrorState, toast } from './ui.js';

const PAGES = {
  home: () => import('./home.js'),
  login: () => import('./account.js').then((m) => ({ init: m.initLogin })),
  register: () => import('./account.js').then((m) => ({ init: m.initRegister })),
  profile: () => import('./account.js').then((m) => ({ init: m.initProfile })),
  'medical-history': () => import('./medical-history.js'),
  'vision-test': () => import('./vision-test.js'),
  scan: () => import('./camera.js'),
  analyze: () => import('./analyze.js'),
  result: () => import('./ai-result.js'),
  history: () => import('./history.js'),
  patients: () => import('./patients.js'),
  dashboard: () => import('./dashboard.js'),
  guide: () => import('./guide.js'),
  admin: () => import('./admin.js'),
  static: () => Promise.resolve({ init: () => {} }),
};

function offlineBanner() {
  let el = null;
  const update = () => {
    if (!navigator.onLine && !el) {
      el = document.createElement('div');
      el.className = 'offline-banner';
      el.setAttribute('role', 'alert');
      el.innerHTML = `${icons.wifiOff.replace('<svg', '<svg width="18" height="18" style="display:inline;vertical-align:-3px;margin-right:6px"')}ไม่มีการเชื่อมต่ออินเทอร์เน็ต ข้อมูลจะไม่ถูกบันทึกจนกว่าจะเชื่อมต่อได้`;
      document.body.prepend(el);
    } else if (navigator.onLine && el) {
      el.remove();
      el = null;
      toast('เชื่อมต่ออินเทอร์เน็ตแล้ว', 'success', 2500);
    }
  };
  window.addEventListener('online', update);
  window.addEventListener('offline', update);
  update();
}

function track(event) {
  // Anonymous, non-identifying page analytics (see privacy policy)
  api.post('/activity/track', { event, path: location.pathname }, { keepalive: true, timeout: 5000 }).catch(() => {});
}

async function boot() {
  const page = document.body.dataset.page;
  const loader = PAGES[page];
  // start downloading the page module immediately instead of after the header is ready
  const modP = loader ? loader() : null;
  modP?.catch(() => {}); // handled in runPage

  offlineBanner();
  initPasswordToggles(); // eye / eye-off on every password field (pages + modals)
  initMotion(); // entrance / reveal / counters / tooltips (UI only)
  window.addEventListener('pagehide', () => track('page_leave'), { once: true });
  window.addEventListener('auth:expired', () => {
    if (document.body.dataset.public !== 'true') toast('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่', 'warning');
  });

  const main = document.getElementById('page-root') ?? document.getElementById('main');
  const runPage = async () => {
    if (!modP) return;
    try {
      const mod = await modP;
      await mod.init?.();
    } catch (err) {
      console.error(err);
      if (main) renderErrorState(main, err, () => location.reload());
    }
  };
  // header and page content load in parallel; both share the single /auth/me request (auth.js)
  await Promise.all([
    initNavigation().catch((err) => console.error(err)).then(() => whenVisible(() => track('page_view'))),
    // the footer is added once the page content exists: rendered earlier it showed inside the
    // viewport above an empty page and then jumped down when the content arrived (layout shift)
    runPage().finally(renderFooter),
  ]);
  enableInstantNavigation();
}

/** A page prepared in advance (prerender) only counts as a visit once the user actually opens it. */
function whenVisible(fn) {
  if (document.prerendering) document.addEventListener('prerenderingchange', fn, { once: true });
  else fn();
}

/**
 * Instant page changes (Chromium Speculation Rules): read-only pages are prepared in the
 * background when the user hovers / touches a link, so the click swaps to a page that already
 * has its content: the current page stays on screen until then, no empty frame in between.
 * Pages that start work on load (camera, upload, AI analysis, screening workflow) are excluded.
 * Browsers without support simply navigate normally.
 */
const PRERENDER_SAFE = ['/', '/index.html', '/pages/dashboard.html', '/pages/history.html', '/pages/guide.html', '/pages/privacy.html', '/pages/terms.html', '/pages/profile.html', '/pages/patients.html', '/pages/admin.html'];
function enableInstantNavigation() {
  if (!HTMLScriptElement.supports?.('speculationrules') || document.querySelector('script[type="speculationrules"]')) return;
  const s = document.createElement('script');
  s.type = 'speculationrules';
  s.textContent = JSON.stringify({
    prerender: [{
      where: { and: [{ or: PRERENDER_SAFE.map((p) => ({ href_matches: p })) }, { not: { selector_matches: '[data-no-prerender], [target]' } }] },
      eagerness: 'moderate', // hover ≈ 200 ms or pointer-down
    }],
  });
  document.head.append(s);
}

boot();
