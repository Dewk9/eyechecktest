import { api } from '../api.js';
import { icons } from '../icons.js';
import { qs, esc, toast, setBusy, renderErrorState, renderState, formatDateTime, formatDate, debounce } from '../ui.js';
import { openModal, confirmDialog } from '../../components/modal.js';
import { createExpiryPicker, thaiDateTimeParts } from '../../components/expiry-picker.js';
import { ACCOUNT_TYPES } from '../constants.js';
import { openUserDetail } from './users.js';

// ---------------------------------------------------------------------
// Staff registration codes
// ---------------------------------------------------------------------
// Codes created after migration 006 are stored encrypted (AES-256-GCM) → an admin can show / copy
// them (each reveal is a logged backend call). Older codes only have an HMAC hash → they still work
// for registration but can only be identified by a short reference id.
const codeRef = (id) => `REF-${String(id).slice(0, 8).toUpperCase()}`;
const MASK = 'STAFF-••••-••••-••••';

// state comes from the backend (server clock); this fallback is only for older API responses
const stateOf = (c) => c.state ?? (c.status === 'disabled' ? 'disabled'
  : c.expires_at && new Date(c.expires_at) <= new Date() ? 'expired'
    : c.status === 'exhausted' ? 'fully_used' : 'active');
const STATES = {
  active: { label: 'ใช้งานได้', cls: 'badge-success', en: 'Active' },
  expired: { label: 'หมดอายุ', cls: 'badge-warning', en: 'Expired' },
  disabled: { label: 'ปิดใช้งาน', cls: 'badge-danger', en: 'Disabled' },
  fully_used: { label: 'ใช้สิทธิ์ครบแล้ว', cls: 'badge-muted', en: 'Fully Used' },
};
const codeStatusBadge = (c) => {
  const s = STATES[stateOf(c)];
  return `<span class="badge ${s.cls} code-state" title="${s.en}"><span class="dot" aria-hidden="true"></span>${s.label}</span>`;
};
const limitText = (c) => (c.usage_limit
  ? `<span class="usage"><strong>${c.usage_count}</strong> / ${c.usage_limit}</span><span class="usage-bar" aria-hidden="true"><i style="width:${Math.min(100, Math.round((c.usage_count / c.usage_limit) * 100))}%"></i></span>`
  : `<span class="usage"><strong>${c.usage_count}</strong> / ไม่จำกัด</span>`);
const usedByText = (c) => (c.used_by === null || c.used_by === undefined
  ? '<span class="muted" title="ยังไม่ได้รัน migration 005">—</span>' : `${c.used_by} บัญชี`);
/** "30 พ.ย. 2569 · 23:59 น." (Asia/Bangkok) */
function expiryText(iso, { long = false } = {}) {
  if (!iso) return '<span class="muted">ไม่กำหนด</span>';
  const t = thaiDateTimeParts(iso);
  return long ? `${t.date} เวลา ${t.time}` : `<span class="nowrap">${formatDate(iso)}</span> <span class="small muted nowrap">${t.time}</span>`;
}

// decrypted codes for this page view only (never persisted in the browser)
const revealed = new Map();
// ids whose code is currently shown (kept across table re-renders / searches)
const visible = new Set();
async function fetchCode(id) {
  if (revealed.has(id)) return revealed.get(id);
  const r = await api.get(`/admin/registration-codes/${id}/reveal`);
  revealed.set(id, r.code);
  return r.code;
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast('คัดลอกรหัสแล้ว', 'success'); return true; } catch {
    toast('คัดลอกไม่สำเร็จ กรุณาเลือกข้อความแล้วคัดลอกเอง', 'warning'); return false;
  }
}

/** masked code + eye (show/hide) + copy. Legacy (hash-only) codes show their reference id. */
function codeCell(c, { large = false } = {}) {
  if (!c.has_code) {
    // the original value was never stored (hash only) → never invent or guess a code
    return `<span class="code-box legacy${large ? ' lg' : ''}"><span class="code-legacy-text">${icons.lock}ไม่สามารถเรียกดูรหัสเดิมได้</span></span>
      <span class="small muted d-block">โค้ดรุ่นเก่า เก็บเฉพาะค่าแฮช · ยังใช้สมัครได้ตามปกติ · อ้างอิงภายใน ${codeRef(c.id)}</span>
      <button type="button" class="btn btn-sm mt-2" data-replace="${esc(c.id)}">${icons.key}<span>ออกโค้ดทดแทน</span></button>`;
  }
  const shown = visible.has(c.id) && revealed.has(c.id);
  return `<span class="code-box${large ? ' lg' : ''}" data-code-box="${esc(c.id)}">
    <code class="code-text" data-code-text>${shown ? esc(revealed.get(c.id)) : MASK}</code>
    <button type="button" class="icon-btn" data-reveal="${esc(c.id)}" aria-pressed="${shown}" title="แสดง/ซ่อนรหัส" aria-label="แสดงหรือซ่อนรหัส">${shown ? icons.eyeOff : icons.eyeLucide}</button>
    <button type="button" class="icon-btn" data-copy="${esc(c.id)}" title="คัดลอกรหัส" aria-label="คัดลอกรหัส">${icons.copy}</button></span>`;
}
/** handles eye / copy clicks inside any container; returns true if the click was handled */
async function handleCodeButtons(e) {
  const eye = e.target.closest('[data-reveal]');
  const cp = e.target.closest('[data-copy]');
  if (!eye && !cp) return false;
  const btn = eye ?? cp;
  const id = btn.dataset.reveal ?? btn.dataset.copy;
  const box = btn.closest('[data-code-box]');
  if (eye && eye.getAttribute('aria-pressed') === 'true') {
    visible.delete(id);
    qs('[data-code-text]', box).textContent = MASK;
    eye.setAttribute('aria-pressed', 'false'); eye.innerHTML = icons.eyeLucide;
    return true;
  }
  btn.disabled = true;
  try {
    const code = await fetchCode(id);
    if (eye) {
      const text = qs('[data-code-text]', box);
      visible.add(id);
      text.textContent = code;
      text.classList.remove('pop'); void text.offsetWidth; text.classList.add('pop');
      eye.setAttribute('aria-pressed', 'true'); eye.innerHTML = icons.eyeOff;
    } else if (await copyText(code)) {
      btn.classList.add('is-done'); btn.innerHTML = icons.check;
      setTimeout(() => { btn.classList.remove('is-done'); btn.innerHTML = icons.copy; }, 1400);
    }
  } catch (err) { toast(err.message, 'error'); } finally { btn.disabled = false; }
  return true;
}

export async function renderCodes(box) {
  revealed.clear();
  visible.clear();
  box.innerHTML = `<header class="row-between"><div><h1>โค้ดสมัครบัญชีเจ้าหน้าที่</h1><p class="muted mb-0">รหัสถูกเข้ารหัสก่อนบันทึก ผู้ดูแลระบบดู/คัดลอกได้ด้วยปุ่มรูปตาและปุ่มคัดลอก · เวลาทั้งหมดเป็นเวลาประเทศไทย (UTC+7)</p></div>
    <button class="btn btn-primary" id="c-new">${icons.plus}สร้างโค้ดใหม่</button></header>
    <div id="c-cap"></div>
    <div id="c-summary" class="code-summary"></div>
    <div class="code-toolbar">
      <div class="input-group code-search">${icons.search}<input class="input" id="c-q" type="search" maxlength="80" placeholder="ค้นหาด้วยรหัส (เช่น N29Q) หรือชื่อหน่วยงาน" aria-label="ค้นหาด้วยรหัสสมัครสมาชิกหรือชื่อหน่วยงาน"></div>
      <button type="button" class="btn btn-sm" id="c-showall" aria-pressed="false">${icons.eyeLucide}<span>แสดงรหัสทั้งหมด</span></button>
    </div>
    <div id="c-list"></div>`;
  const list = qs('#c-list');
  const summary = qs('#c-summary');
  const showAllBtn = qs('#c-showall');
  let rows = [];
  let flashId = null;
  let q = '';
  api.get('/admin/registration-codes/capabilities').then((cap) => {
    if (cap.encryption_ready) return;
    qs('#c-cap').innerHTML = `<div class="alert alert-warning mb-4">${icons.alert}<div><strong>ยังแสดงรหัสจริงไม่ได้: ฐานข้อมูลยังไม่ได้ติดตั้งระบบเข้ารหัสโค้ด</strong>
      ให้รันไฟล์ <code>${esc(cap.migration)}</code> ใน Supabase SQL Editor (หรือ <code>npm run db:migrate</code>) — ระหว่างนี้โค้ดที่สร้างใหม่จะแสดงรหัสได้เพียงครั้งเดียวตอนสร้าง</div></div>`;
  }).catch(() => {});
  const load = async ({ quiet = false } = {}) => {
    if (!quiet) renderState(list, { type: 'loading', skeleton: 'table', rows: 4 });
    try { rows = await api.get('/admin/registration-codes', q ? { q } : null); } catch (err) { if (!quiet) renderErrorState(list, err, load); else toast(err.message, 'error'); return; }
    const count = (s) => rows.filter((c) => stateOf(c) === s).length;
    summary.innerHTML = rows.length && !q ? `
      <div class="code-sum-item"><span>ทั้งหมด</span><strong>${rows.length}</strong></div>
      ${Object.entries(STATES).map(([k, s]) => `<div class="code-sum-item is-${k}"><span>${s.label}</span><strong>${count(k)}</strong></div>`).join('')}` : '';
    if (!rows.length) { renderState(list, { type: 'empty', message: q ? 'ไม่พบโค้ดที่ตรงกับคำค้นหา' : 'ยังไม่มีโค้ด สร้างโค้ดเพื่อให้เจ้าหน้าที่สมัครบัญชี' }); return; }
    list.innerHTML = `<div class="table-wrap"><table class="table stack-sm code-table"><thead><tr><th>หน่วยงาน</th><th>รหัสสมัครบัญชีเจ้าหน้าที่</th><th>สถานะ</th><th>ใช้สิทธิ์แล้ว / ทั้งหมด</th><th>ผู้ใช้งานจริง</th><th>หมดอายุ</th><th>สร้างเมื่อ</th><th><span class="sr-only">จัดการ</span></th></tr></thead><tbody>
      ${rows.map((c) => {
        const name = esc(c.label ?? codeRef(c.id));
        return `<tr data-row="${esc(c.id)}" class="${c.id === flashId ? 'row-flash' : ''}"><td data-label="หน่วยงาน"><strong>${esc(c.label ?? '-')}</strong></td>
        <td data-label="รหัส">${codeCell(c)}</td>
        <td data-label="สถานะ">${codeStatusBadge(c)}</td>
        <td data-label="ใช้สิทธิ์">${limitText(c)}</td>
        <td data-label="ผู้ใช้งานจริง">${usedByText(c)}</td>
        <td data-label="หมดอายุ">${expiryText(c.expires_at)}</td>
        <td data-label="สร้างเมื่อ"><span class="nowrap">${formatDate(c.created_at)}</span> <span class="small muted nowrap">${thaiDateTimeParts(c.created_at).time}</span></td>
        <td><div class="actions">
          <button class="btn btn-sm" data-view="${esc(c.id)}" title="ดูรายละเอียด" aria-label="ดูรายละเอียดโค้ด ${name}">${icons.info}<span>รายละเอียด</span></button>
          <button class="btn btn-sm" data-edit="${esc(c.id)}" title="แก้ไข" aria-label="แก้ไขโค้ด ${name}">${icons.edit}<span>แก้ไข</span></button>
          ${c.status === 'disabled'
            ? `<button class="btn btn-sm" data-enable="${esc(c.id)}" title="เปิดใช้งาน" aria-label="เปิดใช้งานโค้ด ${name}">${icons.power}<span>เปิดใช้งาน</span></button>`
            : `<button class="btn btn-sm btn-outline-danger" data-disable="${esc(c.id)}" title="ปิดใช้งาน" aria-label="ปิดใช้งานโค้ด ${name}">${icons.power}<span>ปิดใช้งาน</span></button>`}
          <button class="btn btn-sm btn-outline-danger" data-delete="${esc(c.id)}" title="ลบโค้ด" aria-label="ลบโค้ด ${name}">${icons.trash}<span>ลบ</span></button></div></td></tr>`;
      }).join('')}
    </tbody></table></div>`;
    flashId = null;
  };
  const refresh = (id) => { flashId = id ?? null; return load({ quiet: true }); };
  const find = (id) => rows.find((r) => r.id === id);

  // A code expires at its exact minute: when a shown expiry passes, reload so the server re-derives the state.
  const timer = setInterval(() => {
    if (!list.isConnected) { clearInterval(timer); return; }
    const now = Date.now();
    if (rows.some((c) => ['active', 'fully_used'].includes(stateOf(c)) && c.expires_at && new Date(c.expires_at).getTime() <= now)) refresh();
  }, 15e3);

  list.onclick = async (e) => {
    if (await handleCodeButtons(e)) return;
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.view) { openCodeDetail(b.dataset.view, { onChanged: refresh }); return; }
    if (b.dataset.replace) { const c = find(b.dataset.replace); if (c) openCodeCreate({ replaceOf: c, onCreated: (row) => refresh(row.id) }); return; }
    if (b.dataset.edit) { const c = find(b.dataset.edit); if (c) openCodeEdit(c, { onSaved: (row) => refresh(row?.id) }); return; }
    if (b.dataset.delete) { const c = find(b.dataset.delete); if (c) deleteCode(c, { onDeleted: refresh }); return; }
    const id = b.dataset.disable || b.dataset.enable;
    if (!id) return;
    const c = find(id);
    if (b.dataset.disable && !(await confirmDialog({ title: 'ปิดใช้งานโค้ด', message: 'โค้ดนี้จะใช้สมัครบัญชีไม่ได้อีก (บัญชีที่สมัครแล้วไม่ได้รับผลกระทบ)', danger: true, confirmText: 'ปิดใช้งาน' }))) return;
    setBusy(b, true);
    try {
      const row = await api.patch(`/admin/registration-codes/${id}`, { status: b.dataset.disable ? 'disabled' : 'active' });
      if (b.dataset.enable && row.state === 'expired') toast('เปิดใช้งานแล้ว แต่โค้ดยังหมดอายุอยู่ — กด "แก้ไข" เพื่อกำหนดวันหมดอายุใหม่', 'warning', 7000);
      else toast(b.dataset.disable ? 'ปิดใช้งานโค้ดแล้ว' : 'เปิดใช้งานโค้ดแล้ว', 'success');
      await refresh(id);
      if (b.dataset.enable && row.state === 'expired' && c) openCodeEdit({ ...c, ...row }, { onSaved: (r) => refresh(r?.id) });
    } catch (err) { toast(err.message, 'error'); setBusy(b, false); }
  };
  qs('#c-new').addEventListener('click', () => openCodeCreate({ onCreated: (row) => refresh(row.id) }));
  qs('#c-q').addEventListener('input', debounce((e) => { q = e.target.value.trim(); load({ quiet: true }); }, 300));
  showAllBtn.addEventListener('click', async () => {
    const on = showAllBtn.getAttribute('aria-pressed') !== 'true';
    const ids = rows.filter((c) => c.has_code).map((c) => c.id);
    if (on) {
      if (!ids.length) { toast('ไม่มีโค้ดที่แสดงรหัสได้ในรายการนี้', 'info'); return; }
      setBusy(showAllBtn, true);
      const results = await Promise.allSettled(ids.map((id) => fetchCode(id)));
      setBusy(showAllBtn, false);
      const failed = results.find((r) => r.status === 'rejected');
      if (failed) toast(failed.reason?.message ?? 'แสดงรหัสบางรายการไม่สำเร็จ', 'error');
      ids.forEach((id) => { if (revealed.has(id)) visible.add(id); });
    } else ids.forEach((id) => visible.delete(id));
    showAllBtn.setAttribute('aria-pressed', String(on));
    showAllBtn.innerHTML = `${on ? icons.eyeOff : icons.eyeLucide}<span>${on ? 'ซ่อนรหัสทั้งหมด' : 'แสดงรหัสทั้งหมด'}</span>`;
    load({ quiet: true });
  });
  load();
}

/** Create dialog → success view with the full code. */
function openCodeCreate({ onCreated, replaceOf = null }) {
  const old = replaceOf;
  const oldRemaining = old?.usage_limit ? Math.max(old.usage_limit - old.usage_count, 0) : null;
  const oldExpFuture = old?.expires_at && new Date(old.expires_at).getTime() > Date.now() + 60e3 ? old.expires_at : null;
  const form = document.createElement('form');
  form.className = 'code-form';
  form.noValidate = true;
  form.innerHTML = `<div class="stack">
    <div class="field"><label for="c-label">ชื่อหน่วยงาน</label><input class="input" id="c-label" maxlength="120" placeholder="เช่น รพ.สต. บ้านหนองบัว" autocomplete="off"></div>
    <div class="field"><label>รหัสโค้ด <span class="small muted">(ระบบสร้างให้อัตโนมัติ)</span></label>
      <div class="code-gen"><code class="code-text" id="c-code" aria-live="polite">กำลังสร้าง…</code>
      <button type="button" class="btn btn-sm" id="c-regen" title="สุ่มรหัสใหม่">${icons.refresh}<span>สุ่มใหม่</span></button></div></div>
    <div class="field"><label for="c-limit">จำนวนสิทธิ์การสมัครสมาชิก</label><input class="input" id="c-limit" type="number" min="1" max="10000" inputmode="numeric" placeholder="ว่าง = ไม่จำกัด"></div>
    <fieldset class="field fieldset-plain"><legend>วันและเวลาหมดอายุ</legend><div id="c-exp"></div></fieldset>
    <div class="field"><span class="label">สถานะการใช้งาน</span>
      <label class="switch"><input type="checkbox" id="c-active" checked><span class="switch-track" aria-hidden="true"></span><span id="c-active-text">เปิดใช้งานทันที</span></label></div>
    </div>
    <div class="modal-foot"><button type="button" class="btn" data-close>ยกเลิก</button><button class="btn btn-primary" type="submit">${icons.key}สร้างโค้ด</button></div>`;
  if (old) {
    qs('#c-label', form).value = old.label ?? '';
    if (oldRemaining) qs('#c-limit', form).value = oldRemaining;
    qs('.stack', form).insertAdjacentHTML('afterbegin', `<div class="alert alert-info">${icons.info}<div><strong>ออกโค้ดทดแทน ${codeRef(old.id)}</strong>
      ระบบไม่สามารถเรียกดูรหัสเดิมได้ จึงสร้างรหัสใหม่ให้แทน (ไม่มีการเดาหรือสร้างรหัสเดิมขึ้นมาใหม่) — ค่าเดิมถูกกรอกไว้ให้แล้ว แก้ไขได้</div></div>`);
    qs('.stack', form).insertAdjacentHTML('beforeend', `<label class="check-inline"><input type="checkbox" id="c-disable-old"> ปิดใช้งานโค้ดเดิม (${codeRef(old.id)}) หลังสร้างโค้ดใหม่สำเร็จ</label>
      <p class="small muted mb-0">ถ้าไม่เลือก โค้ดเดิมจะยังใช้สมัครได้ตามปกติ · บัญชีที่สมัครด้วยโค้ดเดิมไม่ได้รับผลกระทบ</p>`);
  }
  const picker = createExpiryPicker(oldExpFuture ? { current: oldExpFuture, mode: 'custom' } : { defaultDays: 30 });
  qs('#c-exp', form).append(picker.el);
  const m = openModal({ title: old ? 'ออกโค้ดทดแทน' : 'สร้างโค้ดสมัครบัญชีเจ้าหน้าที่', content: form });
  m.el.classList.add('code-modal');
  const codeEl = qs('#c-code', form);
  let code = null;
  const gen = async () => {
    codeEl.textContent = 'กำลังสร้าง…';
    try { code = (await api.get('/admin/registration-codes/new-code')).code; codeEl.textContent = code; codeEl.classList.remove('pop'); void codeEl.offsetWidth; codeEl.classList.add('pop'); } catch (err) { code = null; codeEl.textContent = 'ระบบจะสร้างให้ตอนบันทึก'; toast(err.message, 'warning'); }
  };
  gen();
  qs('#c-regen', form).addEventListener('click', gen);
  const active = qs('#c-active', form);
  active.addEventListener('change', () => { qs('#c-active-text', form).textContent = active.checked ? 'เปิดใช้งานทันที' : 'ปิดใช้งานไว้ก่อน'; });

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const limitRaw = qs('#c-limit', form).value.trim();
    const limit = limitRaw ? Number(limitRaw) : null;
    if (limit !== null && (!Number.isInteger(limit) || limit < 1 || limit > 10000)) { toast('จำนวนสิทธิ์ต้องเป็นจำนวนเต็ม 1–10000', 'warning'); return; }
    const exp = picker.read();
    if (!exp.ok) { toast(exp.error, 'warning'); return; }
    const btn = qs('[type="submit"]', form);
    setBusy(btn, true);
    try {
      const r = await api.post('/admin/registration-codes', {
        label: qs('#c-label', form).value.trim() || undefined,
        ...(code ? { code } : {}),
        usage_limit: limit,
        status: active.checked ? 'active' : 'disabled',
        ...exp.body,
      });
      if (r.encrypted) revealed.set(r.id, r.code);
      toast('สร้างโค้ดสำเร็จ', 'success');
      if (old && qs('#c-disable-old', form)?.checked) {
        try { await api.patch(`/admin/registration-codes/${old.id}`, { status: 'disabled' }); toast(`ปิดใช้งานโค้ดเดิม ${codeRef(old.id)} แล้ว`, 'success'); } catch (err) { toast(`สร้างโค้ดใหม่แล้ว แต่ปิดโค้ดเดิมไม่สำเร็จ: ${err.message}`, 'warning', 8000); }
      }
      showCreated(m, r);
      onCreated?.(r);
    } catch (err) {
      toast(err.message, 'error'); setBusy(btn, false);
      if (err.code === 'CODE_TAKEN') gen();
    }
  });
}

function showCreated(m, r) {
  const t = r.expires_at ? thaiDateTimeParts(r.expires_at) : null;
  m.el.querySelector('.modal-head h2').textContent = 'สร้างโค้ดสำเร็จ';
  m.body.innerHTML = `<div class="code-success">
      <div class="success-mark" aria-hidden="true">${icons.check}</div>
      <p class="mb-3"><strong>สร้างโค้ดสมัครบัญชีเจ้าหน้าที่เรียบร้อยแล้ว</strong></p>
      <div class="code-reveal" id="code-val">${esc(r.code)}</div>
      <button class="btn btn-primary mt-3" id="copy-code">${icons.copy}คัดลอกรหัส</button>
    </div>
    ${r.encrypted
      ? '<p class="small muted text-center mt-2 mb-0">ดูหรือคัดลอกรหัสนี้ได้อีกครั้งจากตารางหรือหน้ารายละเอียดโค้ด</p>'
      : `<div class="alert alert-warning mt-3">${icons.alert}<div><strong>คัดลอกโค้ดตอนนี้</strong> ฐานข้อมูลยังไม่ได้ติดตั้งระบบเข้ารหัส (migration 006) โค้ดนี้จะแสดงเพียงครั้งเดียว</div></div>`}
    <dl class="kv mt-3">
      <dt>ชื่อหน่วยงาน</dt><dd>${esc(r.label ?? '-')}</dd>
      <dt>จำนวนสิทธิ์</dt><dd>${r.usage_limit ? `${r.usage_limit} สิทธิ์` : 'ไม่จำกัด'}</dd>
      <dt>วันหมดอายุ</dt><dd>${t ? `วัน${t.weekday}ที่ ${t.date}` : 'ไม่กำหนดวันหมดอายุ'}</dd>
      <dt>เวลาหมดอายุ</dt><dd>${t ? `${t.time} (เวลาประเทศไทย)` : '-'}</dd>
      <dt>สถานะโค้ด</dt><dd>${codeStatusBadge(r)}</dd>
    </dl>
    <div class="modal-foot"><button class="btn btn-primary" data-close>เสร็จสิ้น</button></div>`;
  qs('#copy-code', m.body).addEventListener('click', () => copyText(r.code));
}

/** Edit name / limit / expiry date + time / status. Only changed fields are sent. */
function openCodeEdit(c, { onSaved }) {
  const form = document.createElement('form');
  form.className = 'code-form';
  form.noValidate = true;
  const minLimit = Math.max(1, c.usage_count);
  const expired = stateOf(c) === 'expired';
  const initial = { label: c.label ?? '', limit: c.usage_limit ?? '', status: c.status === 'disabled' ? 'disabled' : 'active' };
  form.innerHTML = `<div class="stack">
    ${expired ? `<div class="alert alert-warning">${icons.alert}<div><strong>โค้ดนี้หมดอายุแล้ว</strong> กำหนดวันและเวลาหมดอายุใหม่ (หรือไม่กำหนดวันหมดอายุ) เพื่อให้กลับมาใช้สมัครได้</div></div>` : ''}
    <p class="small muted mb-0">${c.has_code ? '' : `รหัสอ้างอิง <span class="code-ref">${codeRef(c.id)}</span> · `}ใช้สิทธิ์ไปแล้ว ${c.usage_count} ครั้ง</p>
    <div class="field"><label for="e-label">ชื่อหน่วยงาน</label><input class="input" id="e-label" maxlength="120" value="${esc(initial.label)}"></div>
    <div class="field"><label for="e-limit">จำนวนสิทธิ์การใช้งาน</label><input class="input" id="e-limit" type="number" min="${minLimit}" max="10000" inputmode="numeric" value="${esc(initial.limit)}" placeholder="ว่าง = ไม่จำกัด">
      <span class="small muted">ต้องไม่น้อยกว่าจำนวนที่ใช้ไปแล้ว (${c.usage_count})</span></div>
    <fieldset class="field fieldset-plain"><legend>วันและเวลาหมดอายุ</legend><div id="e-exp"></div></fieldset>
    <div class="field"><label for="e-status">สถานะการใช้งาน</label><select class="input" id="e-status">
      <option value="active" ${initial.status === 'active' ? 'selected' : ''}>เปิดใช้งาน</option>
      <option value="disabled" ${initial.status === 'disabled' ? 'selected' : ''}>ปิดใช้งาน</option></select>
      ${stateOf(c) === 'fully_used' ? '<span class="small muted">ตอนนี้โค้ดใช้สิทธิ์ครบแล้ว — เพิ่มจำนวนสิทธิ์เพื่อให้กลับมาใช้งานได้</span>' : ''}</div>
    <p class="small muted mb-0">การแก้ไขไม่มีผลกับบัญชีที่สมัครด้วยโค้ดนี้ไปแล้ว</p></div>
    <div class="modal-foot"><button type="button" class="btn" data-close>ยกเลิก</button><button class="btn btn-primary" type="submit">${icons.save}บันทึก</button></div>`;
  const picker = createExpiryPicker({ current: c.expires_at, keep: true, mode: expired ? 'custom' : 'keep' });
  qs('#e-exp', form).append(picker.el);
  const m = openModal({ title: `แก้ไขโค้ด: ${c.label ?? codeRef(c.id)}`, content: form });
  m.el.classList.add('code-modal');
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const label = qs('#e-label', form).value.trim();
    const limitRaw = qs('#e-limit', form).value.trim();
    const status = qs('#e-status', form).value;
    const limit = limitRaw ? Number(limitRaw) : null;
    if (limit !== null && (!Number.isInteger(limit) || limit < minLimit || limit > 10000)) { toast(`จำนวนสิทธิ์ต้องเป็นจำนวนเต็ม ${minLimit}–10000`, 'warning'); return; }
    const exp = picker.read();
    if (!exp.ok) { toast(exp.error, 'warning'); return; }
    const body = {};
    if (label !== initial.label) body.label = label || null;
    if (String(limitRaw) !== String(initial.limit)) body.usage_limit = limit;
    if (exp.changed) Object.assign(body, exp.body);
    if (status !== initial.status) body.status = status;
    if (!Object.keys(body).length) { m.close(); return; }
    const btn = qs('[type="submit"]', form);
    setBusy(btn, true);
    try {
      const row = await api.patch(`/admin/registration-codes/${c.id}`, body);
      if (row.state === 'expired' && row.status !== 'disabled') toast('บันทึกแล้ว แต่โค้ดยังหมดอายุอยู่ — กำหนดวันหมดอายุใหม่เพื่อใช้งาน', 'warning', 7000);
      else if (row.state === 'fully_used' && body.status === 'active') toast('บันทึกแล้ว (โค้ดยังใช้สิทธิ์ครบจำนวน)', 'warning');
      else toast('บันทึกการแก้ไขแล้ว', 'success');
      m.close();
      onSaved?.(row);
    } catch (err) { toast(err.message, 'error'); setBusy(btn, false); }
  });
}

async function deleteCode(c, { onDeleted }) {
  const accounts = c.used_by ?? 0;
  const ok = await confirmDialog({
    title: 'ลบโค้ดสมัครบัญชี',
    message: `ลบโค้ด "${c.label ?? codeRef(c.id)}" ถาวร? โค้ดนี้จะใช้สมัครบัญชีไม่ได้อีก${accounts ? ` · บัญชีที่สมัครด้วยโค้ดนี้ (${accounts} บัญชี) จะยังใช้งานและเข้าสู่ระบบได้ตามปกติ` : ''}`,
    danger: true, confirmText: 'ลบโค้ด',
  });
  if (!ok) return false;
  try {
    await api.del(`/admin/registration-codes/${c.id}`);
    revealed.delete(c.id);
    toast('ลบโค้ดแล้ว', 'success');
    onDeleted?.();
    return true;
  } catch (err) { toast(err.message, 'error'); return false; }
}

/** Two parts: code details + table of accounts that registered with the code (search + per-account view). */
function openCodeDetail(id, { onChanged }) {
  const body = document.createElement('div');
  const m = openModal({ title: 'รายละเอียดโค้ดสมัครบัญชี', content: body, wide: true });
  m.el.classList.add('code-modal');
  let data;
  const render = () => {
    const { code: c, accounts } = data;
    const remaining = c.usage_limit ? Math.max(c.usage_limit - c.usage_count, 0) : null;
    const untracked = Math.max(c.usage_count - c.used_by, 0);
    body.innerHTML = `
      <section class="code-detail-sec">
        <div class="code-detail-top">
          <div><span class="small muted d-block">รหัสสมัครสมาชิก</span>${codeCell(c, { large: true })}</div>
          <div>${codeStatusBadge(c)}</div>
        </div>
        <div class="code-stats four">
          <div class="card card-muted stat"><span class="stat-label">จำนวนสิทธิ์ทั้งหมด</span><span class="stat-value">${c.usage_limit ?? '∞'}</span><span class="stat-sub">${c.usage_limit ? 'สิทธิ์' : 'ไม่จำกัด'}</span></div>
          <div class="card card-muted stat"><span class="stat-label">ใช้สิทธิ์ไปแล้ว</span><span class="stat-value">${c.usage_count}</span><span class="stat-sub">ครั้ง</span></div>
          <div class="card card-muted stat"><span class="stat-label">สิทธิ์คงเหลือ</span><span class="stat-value">${remaining ?? '∞'}</span><span class="stat-sub">${remaining === null ? 'ไม่จำกัด' : 'สิทธิ์'}</span></div>
          <div class="card card-muted stat"><span class="stat-label">ผู้ใช้งานจริง</span><span class="stat-value">${c.used_by}</span><span class="stat-sub">บัญชีที่เชื่อมโยง</span></div>
        </div>
        <dl class="kv mt-3">
          <dt>ชื่อหน่วยงาน</dt><dd>${esc(c.label ?? '-')}</dd>
          <dt>สถานะปัจจุบัน</dt><dd>${codeStatusBadge(c)} <span class="small muted">(ตรวจจากเวลาเซิร์ฟเวอร์ ${formatDateTime(data.server_time)})</span></dd>
          <dt>วันที่สร้าง</dt><dd>${expiryText(c.created_at, { long: true })}${c.creator ? ` <span class="small muted">โดย @${esc(c.creator.username)}</span>` : ''}</dd>
          <dt>วันและเวลาหมดอายุ</dt><dd>${c.expires_at ? expiryText(c.expires_at, { long: true }) : 'ไม่กำหนดวันหมดอายุ'}</dd>
          ${c.updated_at ? `<dt>แก้ไขล่าสุด</dt><dd>${expiryText(c.updated_at, { long: true })}</dd>` : ''}
          ${c.has_code ? '' : `<dt>หมายเหตุ</dt><dd class="small muted">โค้ดนี้สร้างก่อนเปิดระบบเข้ารหัส ระบบเก็บไว้เฉพาะค่าแฮช จึงเรียกดูรหัสเดิมไม่ได้ (ยังใช้สมัครได้ตามปกติ) หากต้องการรหัสที่ดูได้ ให้กด "ออกโค้ดทดแทน"</dd>`}
        </dl>
        ${untracked ? `<p class="small muted mb-0">มีการใช้สิทธิ์ ${untracked} ครั้งที่ไม่มีบัญชีเชื่อมโยง (สมัครก่อนระบบเริ่มบันทึกการเชื่อมโยง หรือบัญชีถูกลบไปแล้ว)</p>` : ''}
        <div class="row mt-3"><button class="btn btn-sm" id="cd-edit">${icons.edit}แก้ไขโค้ด</button><button class="btn btn-sm btn-outline-danger" id="cd-del">${icons.trash}ลบโค้ด</button></div>
      </section>
      <section class="code-detail-sec">
        <div class="row-between"><h3 class="mb-0">${icons.users}บัญชีเจ้าหน้าที่ที่ใช้โค้ดนี้สมัคร <span class="badge badge-primary">${accounts.length}</span></h3>
          ${accounts.length ? `<div class="input-group code-search">${icons.search}<input class="input" id="cd-q" type="search" placeholder="ค้นหาชื่อผู้ใช้งาน / ชื่อ-นามสกุล" aria-label="ค้นหาชื่อผู้ใช้งาน"></div>` : ''}</div>
        <div id="cd-accounts" class="mt-3"></div>
        ${accounts.length ? '<p class="small muted mt-2 mb-0">อีเมล: EYE Check เข้าสู่ระบบด้วยชื่อบัญชี (Username) จึงไม่มีการเก็บอีเมลของผู้ใช้ · ไม่มีการแสดงรหัสผ่านหรือข้อมูลลับใด ๆ</p>' : ''}
      </section>`;
    const box = qs('#cd-accounts', body);
    const drawAccounts = (term = '') => {
      if (!accounts.length) { renderState(box, { type: 'empty', message: 'ยังไม่มีผู้ใช้งานโค้ดนี้' }); return; }
      const t = term.trim().toLowerCase();
      const shown = t ? accounts.filter((a) => a.username.toLowerCase().includes(t) || a.full_name.toLowerCase().includes(t)) : accounts;
      if (!shown.length) { renderState(box, { type: 'empty', message: 'ไม่พบบัญชีที่ตรงกับคำค้นหา' }); return; }
      box.innerHTML = `<div class="table-wrap"><table class="table stack-sm code-acc-table"><thead><tr><th>ผู้ใช้งาน</th><th>ประเภทบัญชี</th><th>วันเวลาที่ใช้โค้ดสมัคร</th><th>สถานะบัญชี</th><th>สถานะการใช้งาน</th><th><span class="sr-only">ดูบัญชี</span></th></tr></thead><tbody>
        ${shown.map((a) => `<tr><td data-label="ผู้ใช้งาน"><span><strong>${esc(a.full_name)}</strong>${a.role === 'admin' ? ' <span class="badge badge-primary">ผู้ดูแล</span>' : ''}<br><span class="small muted">@${esc(a.username)}</span></span></td>
          <td data-label="ประเภทบัญชี">${esc(ACCOUNT_TYPES[a.account_type] ?? a.account_type)}</td>
          <td data-label="ใช้โค้ด">${expiryText(a.used_at)}</td>
          <td data-label="สถานะบัญชี">${a.status === 'active' ? '<span class="badge badge-success">ใช้งาน</span>' : '<span class="badge badge-danger">ถูกระงับ</span>'}</td>
          <td data-label="สถานะการใช้งาน">${a.last_login_at ? `<span class="small">เข้าใช้ล่าสุด<br>${formatDateTime(a.last_login_at)}</span>` : '<span class="small muted">ยังไม่เคยเข้าสู่ระบบ</span>'}</td>
          <td><div class="actions"><button class="btn btn-sm" data-user="${esc(a.id)}" title="ดูรายละเอียดบัญชี" aria-label="ดูรายละเอียดบัญชี @${esc(a.username)}">${icons.user}<span class="hide-md">ดูบัญชี</span></button></div></td></tr>`).join('')}
      </tbody></table></div>`;
    };
    drawAccounts();
    qs('#cd-q', body)?.addEventListener('input', debounce((e) => drawAccounts(e.target.value), 200));
    box.addEventListener('click', (e) => {
      const b = e.target.closest('[data-user]');
      if (b) openUserDetail(b.dataset.user, { onChanged: () => { load(); onChanged?.(); } });
    });
    qs('#cd-edit', body).addEventListener('click', () => openCodeEdit(c, { onSaved: (row) => { load(); onChanged?.(row?.id); } }));
    qs('#cd-del', body).addEventListener('click', async () => {
      if (await deleteCode(c, { onDeleted: onChanged })) m.close();
    });
  };
  body.addEventListener('click', (e) => {
    const rb = e.target.closest('[data-replace]');
    if (rb && data) { openCodeCreate({ replaceOf: data.code, onCreated: () => { load(); onChanged?.(); } }); return; }
    handleCodeButtons(e);
  });
  const load = async () => {
    renderState(body, { type: 'loading', skeleton: 'form', rows: 5 });
    try { data = await api.get(`/admin/registration-codes/${id}`); } catch (err) { renderErrorState(body, err, load); return; }
    render();
  };
  load();
}

// ---------------------------------------------------------------------
// Settings & system health
// ---------------------------------------------------------------------
export async function renderSettings(box) {
  box.innerHTML = `<header class="row-between"><div><h1>ตั้งค่า & สถานะระบบ</h1><p class="muted mb-0">ตรวจสอบการทำงานของฐานข้อมูล Storage และ AI</p></div>
    <button class="btn" id="h-refresh">${icons.refresh}ตรวจสอบอีกครั้ง</button></header>
    <section class="card mb-4"><h2>สถานะการทำงานของระบบ</h2><div id="health"></div></section>
    <section class="card"><h2>เกณฑ์ความมั่นใจของ AI (Confidence Threshold)</h2><div id="settings"></div></section>`;
  const health = qs('#health');
  // first view reuses the last real AI check (≤10 min); "ตรวจสอบอีกครั้ง" runs a new live check
  const loadHealth = async (fresh = false) => {
    renderState(health, fresh
      ? { type: 'loading', message: 'กำลังทดสอบการเชื่อมต่อฐานข้อมูล Storage และ AI...' }
      : { type: 'loading', skeleton: 'list', rows: 3 });
    let h;
    try { h = await api.get('/admin/health', fresh ? { fresh: 1 } : null, { timeout: 45000 }); } catch (err) { renderErrorState(health, err, () => loadHealth(fresh)); return; }
    const item = (ok, title, text) => `<div class="card card-muted"><p class="mb-0"><span class="status-dot ${ok === true ? 'ok' : ok === null ? 'warn' : 'err'}"></span> <strong>${title}</strong></p><p class="small mb-0">${text}</p></div>`;
    health.innerHTML = `<div class="health-grid">
      ${item(h.database.ok, 'Database (Supabase)', h.database.ok ? `เชื่อมต่อได้ · ${h.database.latency_ms} ms` : esc(h.database.error))}
      ${item(h.storage.ok, 'Storage', h.storage.ok ? `Buckets: ${esc(h.storage.buckets.join(', '))}` : esc(h.storage.error ?? 'ไม่พบ bucket ที่ต้องใช้ (รัน 003_storage.sql)'))}
      ${item(h.ai.connected ? (h.ai.ready ? true : null) : false, 'AI (Roboflow)', h.ai.connected ? (h.ai.ready ? `พร้อมใช้งาน · ${esc(h.ai.project)} v${esc(h.ai.modelVersion)}${h.ai.checkedAt ? ` · ทดสอบ AI ล่าสุด ${formatDateTime(h.ai.checkedAt)}` : ''}` : esc(h.ai.reason)) : `Not Connected · ${esc(h.ai.reason)}`)}
      ${item(true, 'Backend', `Uptime ${Math.round(h.server.uptime_s / 60)} นาที · Node ${esc(h.server.node)} · RAM ${h.server.memory_mb} MB`)}
    </div><p class="small muted mt-3 mb-0">ตรวจสอบเมื่อ ${formatDateTime(h.checked_at)}</p>`;
  };
  const settingsBox = qs('#settings');
  const loadSettings = async () => {
    renderState(settingsBox, { type: 'loading', skeleton: 'form', rows: 4 });
    let s;
    try { s = await api.get('/admin/settings'); } catch (err) { renderErrorState(settingsBox, err, loadSettings); return; }
    const t = s.ai_confidence_threshold ?? {};
    settingsBox.innerHTML = `<form id="th-form" class="stack" style="max-width:560px">
      <p class="text-2">ผลที่มีค่าความมั่นใจต่ำกว่าเกณฑ์นี้จะแสดงเป็น "Insufficient Confidence" ควรกำหนดจากการประเมินโมเดลกับชุดข้อมูลทดสอบ (เช่น จุดที่ให้ Sensitivity/Specificity ตามที่ต้องการ)</p>
      <div class="field"><label for="th-val">เกณฑ์ (%)</label><input class="input" id="th-val" type="number" min="5" max="99" step="1" value="${Math.round((t.value ?? 0.6) * 100)}"></div>
      <label class="check-inline"><input type="checkbox" id="th-valid" ${t.validated ? 'checked' : ''}> เกณฑ์นี้ผ่านการประเมินกับชุดข้อมูลทดสอบแล้ว</label>
      <div class="field"><label for="th-note">หมายเหตุ/ที่มาของเกณฑ์</label><textarea class="textarea" id="th-note" maxlength="500">${esc(t.note ?? '')}</textarea></div>
      <button class="btn btn-primary" type="submit">${icons.save}บันทึก</button></form>
      <p class="small muted mt-3 mb-0">เวอร์ชันความยินยอมปัจจุบัน: ${esc(s.consent_version?.value ?? '1.0')} · โมเดลที่ใช้งาน: ${s.active_model ? `${esc(s.active_model.project)} v${esc(s.active_model.version)}` : 'ใช้ค่าจาก .env'}</p>`;
    qs('#th-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const v = Number(qs('#th-val').value);
      if (!(v >= 5 && v <= 99)) { toast('เกณฑ์ต้องอยู่ระหว่าง 5–99%', 'warning'); return; }
      const btn = qs('[type="submit"]', e.currentTarget);
      setBusy(btn, true);
      try {
        await api.put('/admin/settings', { ai_confidence_threshold: { value: v / 100, validated: qs('#th-valid').checked, note: qs('#th-note').value.trim() || undefined } });
        toast('บันทึกการตั้งค่าแล้ว (มีผลกับการวิเคราะห์ครั้งถัดไป)', 'success');
      } catch (err) { toast(err.message, 'error'); } finally { setBusy(btn, false); }
    });
  };
  qs('#h-refresh').addEventListener('click', () => loadHealth(true));
  loadHealth();
  loadSettings();
}
