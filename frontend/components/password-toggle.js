/**
 * Password visibility toggle (eye / eye-off) for every <input type="password">.
 *
 * The existing input is NOT recreated: it is only wrapped in a span, so its id, name,
 * value, listeners and validation stay exactly the same. Only `type` is switched
 * between "password" and "text". A MutationObserver also covers inputs that appear later
 * (pages rendered by JS, modals such as promptDialog).
 */
import { icons } from '../js/icons.js';

const LABEL_SHOW = 'แสดงรหัสผ่าน';
const LABEL_HIDE = 'ซ่อนรหัสผ่าน';
let uid = 0;

export function enhancePasswordInput(input) {
  if (!(input instanceof HTMLInputElement) || input.dataset.pwToggle || input.closest('.pw-wrap')) return;
  input.dataset.pwToggle = '1';
  if (!input.id) input.id = `pw-${++uid}`;
  // mobile keyboards must not auto-correct / capitalise a password shown as text
  input.setAttribute('autocapitalize', 'none');
  input.setAttribute('autocorrect', 'off');
  input.spellcheck = false;

  const hadFocus = document.activeElement === input;
  const wrap = document.createElement('span');
  wrap.className = 'pw-wrap';
  input.before(wrap);
  wrap.append(input); // moves the same element (value + listeners kept)
  if (hadFocus) input.focus({ preventScroll: true });

  const btn = document.createElement('button');
  btn.type = 'button'; // never submits the form
  btn.className = 'pw-toggle';
  btn.setAttribute('aria-controls', input.id);
  btn.innerHTML = `<span class="pw-ic pw-ic-show">${icons.eyeLucide}</span><span class="pw-ic pw-ic-hide">${icons.eyeOff}</span>`;
  wrap.append(btn);

  const render = () => {
    const shown = input.type === 'text';
    wrap.classList.toggle('is-shown', shown);
    btn.setAttribute('aria-pressed', String(shown));
    btn.setAttribute('aria-label', shown ? LABEL_HIDE : LABEL_SHOW);
    btn.title = shown ? LABEL_HIDE : LABEL_SHOW;
    btn.disabled = input.disabled;
  };

  // Keep the caret in the input when it already has focus (mouse / touch).
  btn.addEventListener('pointerdown', (e) => { if (document.activeElement === input) e.preventDefault(); });
  btn.addEventListener('click', () => {
    const focused = document.activeElement === input;
    const { selectionStart, selectionEnd, selectionDirection } = input;
    input.type = input.type === 'password' ? 'text' : 'password'; // value is untouched
    render();
    if (focused) {
      input.focus({ preventScroll: true });
      try { input.setSelectionRange(selectionStart, selectionEnd, selectionDirection ?? 'none'); } catch { /* ignore */ }
    }
  });
  render();
}

export function enhancePasswordInputs(root = document) {
  if (root instanceof HTMLInputElement) { if (root.type === 'password') enhancePasswordInput(root); return; }
  root.querySelectorAll?.('input[type="password"]').forEach(enhancePasswordInput);
}

/** Enhance current inputs and any added later. Call once at app start. */
export function initPasswordToggles() {
  enhancePasswordInputs(document);
  new MutationObserver((records) => {
    for (const r of records) {
      for (const node of r.addedNodes) if (node.nodeType === 1) enhancePasswordInputs(node);
    }
  }).observe(document.body, { childList: true, subtree: true });
}
