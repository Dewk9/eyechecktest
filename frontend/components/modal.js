/**
 * Accessible modal dialog: focus trap, Esc to close, focus restore.
 * `content` may be an HTML string built ONLY from escaped values, or a Node.
 */
import { icons } from '../js/icons.js';

let openCount = 0;

export function openModal({ title, content, wide = false, onClose, labelledBy } = {}) {
  const previouslyFocused = document.activeElement;
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  const id = `modal-title-${Date.now()}`;
  backdrop.innerHTML = `
    <div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="${labelledBy ?? id}">
      <div class="modal-head">
        <h2 id="${id}"></h2>
        <button type="button" class="btn btn-ghost btn-icon" data-close aria-label="ปิด">${icons.x}</button>
      </div>
      <div class="modal-body"></div>
    </div>`;
  backdrop.querySelector('h2').textContent = title ?? '';
  const body = backdrop.querySelector('.modal-body');
  if (content instanceof Node) body.append(content);
  else if (content) body.innerHTML = content;

  const modal = backdrop.querySelector('.modal');
  let closed = false;
  const close = (result) => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey, true);
    // reverse (scale + fade) animation, then remove; callers get the result immediately
    backdrop.classList.add('is-closing');
    const remove = () => backdrop.remove();
    backdrop.addEventListener('animationend', (e) => { if (e.target === backdrop) remove(); });
    setTimeout(remove, 400); // fallback when animations are disabled
    openCount--;
    if (!openCount) document.body.style.overflow = '';
    previouslyFocused?.focus?.();
    onClose?.(result);
  };
  const focusables = () => [...modal.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])')];
  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); close(false); }
    if (e.key === 'Tab') {
      const f = focusables();
      if (!f.length) return;
      const first = f[0];
      const last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }
  document.addEventListener('keydown', onKey, true);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop || e.target.closest('[data-close]')) close(false); });
  document.body.append(backdrop);
  openCount++;
  document.body.style.overflow = 'hidden';
  (focusables()[1] ?? focusables()[0])?.focus();
  return { el: modal, body, close };
}

/** Single-input prompt (e.g. masked password) → Promise<string|null> */
export function promptDialog({ title, label, type = 'text', confirmText = 'ตกลง', danger = false, autocomplete = 'off' } = {}) {
  return new Promise((resolve) => {
    const form = document.createElement('form');
    form.noValidate = true;
    form.innerHTML = `<label class="field"><span class="label"></span><input class="input" required></label>
      <div class="modal-foot"><button type="button" class="btn" data-close>ยกเลิก</button><button type="submit" class="btn ${danger ? 'btn-danger' : 'btn-primary'}"></button></div>`;
    form.querySelector('.label').textContent = label ?? '';
    const input = form.querySelector('input');
    input.type = type;
    input.autocomplete = autocomplete;
    form.querySelector('[type="submit"]').textContent = confirmText;
    let done = false;
    const m = openModal({ title, content: form, onClose: () => { if (!done) resolve(null); } });
    input.focus();
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!input.value) { input.setAttribute('aria-invalid', 'true'); return; }
      done = true;
      const v = input.value;
      m.close();
      resolve(v);
    });
  });
}

/** Confirmation dialog → Promise<boolean> */
export function confirmDialog({ title = 'ยืนยันการดำเนินการ', message, confirmText = 'ยืนยัน', cancelText = 'ยกเลิก', danger = false, requireText } = {}) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    const p = document.createElement('p');
    p.textContent = message ?? '';
    wrap.append(p);
    let input = null;
    if (requireText) {
      const label = document.createElement('label');
      label.className = 'field';
      label.innerHTML = '<span class="label"></span><input class="input" autocomplete="off">';
      label.querySelector('.label').textContent = `พิมพ์ "${requireText}" เพื่อยืนยัน`;
      input = label.querySelector('input');
      wrap.append(label);
    }
    const foot = document.createElement('div');
    foot.className = 'modal-foot';
    foot.innerHTML = `<button type="button" class="btn" data-act="cancel"></button><button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-act="ok"></button>`;
    foot.querySelector('[data-act="cancel"]').textContent = cancelText;
    const okBtn = foot.querySelector('[data-act="ok"]');
    okBtn.textContent = confirmText;
    if (input) {
      okBtn.disabled = true;
      input.addEventListener('input', () => { okBtn.disabled = input.value.trim() !== requireText; });
    }
    wrap.append(foot);
    let done = false;
    const m = openModal({ title, content: wrap, onClose: () => { if (!done) resolve(false); } });
    foot.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (!act) return;
      done = true;
      m.close();
      resolve(act === 'ok');
    });
  });
}
