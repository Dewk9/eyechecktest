/*
 * Tiny classic (render-blocking) script placed right after <header id="site-header">.
 * Runs before the first paint of every page:
 *  1. paints the last header from this tab's cache so navigating between pages never shows an
 *     empty / jumping header. navigation.js re-renders it with fresh data right after.
 *  2. marks Back/Forward navigations so the page transition slides the other way.
 * No business logic, no network.
 */
(function () {
  try {
    var cached = sessionStorage.getItem('ec_header_v1');
    var header = document.getElementById('site-header');
    if (cached && header && !header.firstChild) {
      var data = JSON.parse(cached);
      header.className = data.cls || 'site-header';
      header.innerHTML = data.html;
      header.setAttribute('data-cached', '');
      // highlight the link of THIS page (the cache came from another page)
      var path = location.pathname.replace(/\/index\.html$/, '/');
      var links = header.querySelectorAll('.nav-link');
      for (var i = 0; i < links.length; i++) {
        var href = links[i].getAttribute('href');
        if (href) {
          if (href === path) links[i].setAttribute('aria-current', 'page');
          else links[i].removeAttribute('aria-current');
        }
      }
    }
  } catch (e) { /* storage unavailable: navigation.js renders the header as usual */ }

  // Back / Forward: the page entrance animation (main.css) slides in from the other side
  try {
    var navEntry = performance.getEntriesByType('navigation')[0];
    var act = window.navigation && window.navigation.activation;
    var isBack = act && act.from && act.entry ? act.entry.index < act.from.index : navEntry && navEntry.type === 'back_forward';
    if (isBack) document.documentElement.classList.add('nav-back');
  } catch (e) { /* ignore */ }
  // pages restored from the back/forward cache: no entrance replay needed
  window.addEventListener('pageshow', function (e) { if (e.persisted) document.documentElement.classList.remove('nav-back'); });

  // a skipped/aborted View Transition (fast clicks, slow first paint) is not an error: keep the console clean
  window.addEventListener('unhandledrejection', function (e) {
    var r = e.reason;
    if (r && r.name === 'InvalidStateError' && /Transition/.test(r.message || '')) e.preventDefault();
  });

  // the outgoing page's side of a transition may also be skipped: not an error
  window.addEventListener('pageswap', function (e) {
    try {
      var vt = e.viewTransition;
      if (!vt) return;
      [vt.ready, vt.finished, vt.updateCallbackDone].forEach(function (p) { if (p) p.catch(function () {}); });
    } catch (err) { /* ignore */ }
  });

  // Back / Forward → reverse slide (cross-document View Transitions, where supported)
  window.addEventListener('pagereveal', function (e) {
    try {
      var nav = window.navigation;
      if (!e.viewTransition) return;
      // a transition can be skipped (fast clicks, reduced motion): that is not an error
      e.viewTransition.ready.catch(function () {});
      e.viewTransition.finished.catch(function () {});
      if (e.viewTransition.updateCallbackDone) e.viewTransition.updateCallbackDone.catch(function () {});
      if (!nav || !nav.activation) return;
      var a = nav.activation;
      if (a.navigationType === 'traverse' && a.from && a.entry && a.entry.index < a.from.index) e.viewTransition.types.add('back');
    } catch (err) { /* older browsers: default transition */ }
  });
})();
