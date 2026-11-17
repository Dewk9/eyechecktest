/**
 * Expiry selector for staff registration codes.
 *
 *  - Modes: exact date + time (custom) / 1 / 7 / 30 / 90 days / no expiry (/ keep current when editing)
 *  - Custom: day / month / year (พ.ศ.) / hour / minute selects + a Thai calendar.
 *  - Everything is in Asia/Bangkok (UTC+7) regardless of the browser's timezone; the year is shown
 *    in พ.ศ. and sent as ค.ศ. in an ISO string with an explicit +07:00 offset.
 *  - The browser check here is for convenience only — the backend re-checks with its own clock.
 */
import { icons } from '../js/icons.js';

export const TH_MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
const TH_DAYS_SHORT = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];
const TH_DAYS = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
const BKK_OFFSET = 7 * 3600e3;
const pad = (n) => String(n).padStart(2, '0');
const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m = 1..12

/** Wall-clock parts in Asia/Bangkok for a timestamp (ms). */
export function bangkokParts(ms = Date.now()) {
  const d = new Date(ms + BKK_OFFSET);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), hh: d.getUTCHours(), mm: d.getUTCMinutes(), wd: d.getUTCDay() };
}
/** Bangkok wall clock → UTC ms */
const toMs = ({ y, m, d, hh, mm }) => Date.UTC(y, m - 1, d, hh, mm) - BKK_OFFSET;
const toIso = (p) => `${p.y}-${pad(p.m)}-${pad(p.d)}T${pad(p.hh)}:${pad(p.mm)}:00+07:00`;

/** "30 พฤศจิกายน 2569" */
export const thaiDate = (p) => `${p.d} ${TH_MONTHS[p.m - 1]} ${p.y + 543}`;
/** "23:59 น." */
export const thaiTime = (p) => `${pad(p.hh)}:${pad(p.mm)} น.`;
/** { date, time, weekday } in Thai for an ISO timestamp (Asia/Bangkok) */
export function thaiDateTimeParts(iso) {
  const p = bangkokParts(new Date(iso).getTime());
  return { date: thaiDate(p), time: thaiTime(p), weekday: TH_DAYS[p.wd] };
}

function relative(ms, now = Date.now()) {
  const diff = ms - now;
  if (diff <= 0) return 'เลยเวลาแล้ว';
  const min = Math.round(diff / 60e3);
  if (min < 60) return `อีก ${min} นาที`;
  const h = Math.round(diff / 3600e3);
  if (h < 48) return `อีกประมาณ ${h} ชั่วโมง`;
  return `อีกประมาณ ${Math.round(diff / 86400e3)} วัน`;
}

const PRESETS = [
  { value: 'custom', label: 'กำหนดวันและเวลาเอง' },
  { value: '1', label: '1 วัน' },
  { value: '7', label: '7 วัน' },
  { value: '30', label: '30 วัน' },
  { value: '90', label: '90 วัน' },
  { value: 'none', label: 'ไม่กำหนดวันหมดอายุ' },
];

let seq = 0;

/**
 * @param {{ current?: string|null, keep?: boolean, mode?: string, defaultDays?: number }} o
 *   current  – existing expiry (edit), keep – offer "keep current" (edit dialog)
 * @returns {{ el: HTMLElement, read(): { ok: boolean, error?: string, changed: boolean, body: object } }}
 */
export function createExpiryPicker({ current = null, keep = false, mode, defaultDays = 30 } = {}) {
  const uid = `xp${++seq}`;
  const el = document.createElement('div');
  el.className = 'xp';
  const now = bangkokParts();
  // initial custom value: the current expiry if it is still in the future, otherwise N days from now at 23:59
  const cur = current ? bangkokParts(new Date(current).getTime()) : null;
  const future = current && new Date(current).getTime() > Date.now();
  const def = bangkokParts(Date.now() + defaultDays * 86400e3);
  const val = future ? { ...cur } : { y: def.y, m: def.m, d: def.d, hh: 23, mm: 59 };
  let view = { y: val.y, m: val.m };
  let calOpen = false;
  const options = keep ? [{ value: 'keep', label: current ? 'คงเดิม' : 'คงเดิม (ไม่มีวันหมดอายุ)' }, ...PRESETS] : PRESETS;
  let selected = mode ?? (keep ? 'keep' : 'custom');

  el.innerHTML = `
    <div class="xp-modes" role="radiogroup" aria-label="ระยะเวลาหมดอายุ">
      ${options.map((o) => `<label class="xp-chip"><input type="radio" name="${uid}-mode" value="${o.value}" ${o.value === selected ? 'checked' : ''}><span>${o.label}</span></label>`).join('')}
    </div>
    <div class="xp-custom" hidden>
      <div class="xp-grid">
        <div class="field"><label for="${uid}-d">วัน</label><select class="input" id="${uid}-d"></select></div>
        <div class="field"><label for="${uid}-m">เดือน</label><select class="input" id="${uid}-m">${TH_MONTHS.map((n, i) => `<option value="${i + 1}">${n}</option>`).join('')}</select></div>
        <div class="field"><label for="${uid}-y">ปี (พ.ศ.)</label><select class="input" id="${uid}-y"></select></div>
        <div class="field xp-time"><label for="${uid}-hh">เวลา (ชั่วโมง : นาที)</label>
          <div class="xp-time-row"><select class="input" id="${uid}-hh" aria-label="ชั่วโมง">${Array.from({ length: 24 }, (_, i) => `<option value="${i}">${pad(i)}</option>`).join('')}</select>
          <span aria-hidden="true">:</span>
          <select class="input" id="${uid}-mm" aria-label="นาที">${Array.from({ length: 60 }, (_, i) => `<option value="${i}">${pad(i)}</option>`).join('')}</select><span class="xp-unit">น.</span></div></div>
      </div>
      <div class="xp-tools">
        <button type="button" class="btn btn-sm" data-cal aria-expanded="false" aria-controls="${uid}-cal">${icons.calendar}เลือกจากปฏิทิน</button>
        <span class="xp-quick" aria-label="เวลาด่วน">${['08:00', '12:00', '16:30', '23:59'].map((t) => `<button type="button" class="btn btn-sm btn-ghost" data-time="${t}">${t}</button>`).join('')}</span>
      </div>
      <div class="xp-cal" id="${uid}-cal" hidden></div>
    </div>
    <p class="xp-summary" aria-live="polite"></p>`;

  const $ = (s) => el.querySelector(s);
  const dSel = $(`#${uid}-d`); const mSel = $(`#${uid}-m`); const ySel = $(`#${uid}-y`);
  const hSel = $(`#${uid}-hh`); const minSel = $(`#${uid}-mm`);
  const custom = $('.xp-custom'); const cal = $('.xp-cal'); const summary = $('.xp-summary');
  // years: this year .. +10 (plus the existing value's year if older, so it stays selectable)
  const firstYear = Math.min(now.y, val.y);
  ySel.innerHTML = Array.from({ length: now.y + 10 - firstYear + 1 }, (_, i) => firstYear + i)
    .map((y) => `<option value="${y}">${y + 543}</option>`).join('');

  const fillDays = () => {
    const n = daysIn(val.y, val.m);
    if (val.d > n) val.d = n;
    dSel.innerHTML = Array.from({ length: n }, (_, i) => `<option value="${i + 1}">${i + 1}</option>`).join('');
  };
  const syncSelects = () => {
    fillDays();
    dSel.value = val.d; mSel.value = val.m; ySel.value = val.y; hSel.value = val.hh; minSel.value = val.mm;
  };

  const renderCal = () => {
    const first = new Date(Date.UTC(view.y, view.m - 1, 1)).getUTCDay();
    const n = daysIn(view.y, view.m);
    const todayKey = now.y * 10000 + now.m * 100 + now.d;
    const prevDisabled = view.y * 100 + view.m <= now.y * 100 + now.m;
    let cells = '';
    for (let i = 0; i < first; i++) cells += '<span></span>';
    for (let d = 1; d <= n; d++) {
      const key = view.y * 10000 + view.m * 100 + d;
      const past = key < todayKey;
      const sel = view.y === val.y && view.m === val.m && d === val.d;
      cells += `<button type="button" class="xp-day${sel ? ' is-selected' : ''}${key === todayKey ? ' is-today' : ''}" data-day="${d}" ${past ? 'disabled' : ''} aria-label="${d} ${TH_MONTHS[view.m - 1]} ${view.y + 543}"${sel ? ' aria-pressed="true"' : ''}>${d}</button>`;
    }
    cal.innerHTML = `<div class="xp-cal-head">
        <button type="button" class="btn btn-sm btn-ghost btn-icon" data-nav="-1" aria-label="เดือนก่อนหน้า" ${prevDisabled ? 'disabled' : ''}>‹</button>
        <strong>${TH_MONTHS[view.m - 1]} ${view.y + 543}</strong>
        <button type="button" class="btn btn-sm btn-ghost btn-icon" data-nav="1" aria-label="เดือนถัดไป" ${view.y >= now.y + 10 && view.m === 12 ? 'disabled' : ''}>›</button></div>
      <div class="xp-cal-grid">${TH_DAYS_SHORT.map((d) => `<span class="xp-dow">${d}</span>`).join('')}${cells}</div>`;
  };

  const presetMs = (days) => Date.now() + days * 86400e3;
  const update = () => {
    custom.hidden = selected !== 'custom';
    summary.className = 'xp-summary';
    if (selected === 'custom') {
      const ms = toMs(val);
      const p = { ...val, wd: new Date(Date.UTC(val.y, val.m - 1, val.d)).getUTCDay() };
      const past = ms <= Date.now();
      summary.classList.toggle('is-error', past);
      summary.innerHTML = past
        ? `${icons.alert}<span>วันและเวลาที่เลือกเลยมาแล้ว กรุณาเลือกเวลาในอนาคต</span>`
        : `${icons.clock}<span>หมดอายุ วัน${TH_DAYS[p.wd]}ที่ <strong>${thaiDate(p)}</strong> เวลา <strong>${thaiTime(p)}</strong> <span class="muted">(${relative(ms)} · เวลาประเทศไทย)</span></span>`;
    } else if (selected === 'none') {
      summary.innerHTML = `${icons.info}<span>โค้ดจะไม่มีวันหมดอายุ จนกว่าผู้ดูแลระบบจะปิดใช้งานหรือใช้สิทธิ์ครบ</span>`;
    } else if (selected === 'keep') {
      if (!current) summary.innerHTML = `${icons.info}<span>ไม่มีวันหมดอายุ (คงเดิม)</span>`;
      else {
        const t = thaiDateTimeParts(current);
        const expired = new Date(current).getTime() <= Date.now();
        summary.classList.toggle('is-error', expired);
        summary.innerHTML = `${expired ? icons.alert : icons.clock}<span>${expired ? 'หมดอายุแล้วเมื่อ' : 'หมดอายุ'} <strong>${t.date}</strong> เวลา <strong>${t.time}</strong>${expired ? ' — เลือกวันหมดอายุใหม่เพื่อเปิดใช้งานอีกครั้ง' : ''}</span>`;
      }
    } else {
      const p = bangkokParts(presetMs(Number(selected)));
      summary.innerHTML = `${icons.clock}<span>หมดอายุประมาณ <strong>${thaiDate(p)}</strong> เวลา <strong>${thaiTime(p)}</strong> <span class="muted">(นับจากเวลาเซิร์ฟเวอร์ตอนกดบันทึก)</span></span>`;
    }
  };

  el.addEventListener('change', (e) => {
    const t = e.target;
    if (t.name === `${uid}-mode`) { selected = t.value; update(); return; }
    if (t === dSel) val.d = Number(t.value);
    else if (t === mSel) { val.m = Number(t.value); fillDays(); dSel.value = val.d; }
    else if (t === ySel) { val.y = Number(t.value); fillDays(); dSel.value = val.d; }
    else if (t === hSel) val.hh = Number(t.value);
    else if (t === minSel) val.mm = Number(t.value);
    else return;
    view = { y: val.y, m: val.m };
    if (calOpen) renderCal();
    update();
  });
  el.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.hasAttribute('data-cal')) {
      calOpen = !calOpen;
      cal.hidden = !calOpen;
      b.setAttribute('aria-expanded', String(calOpen));
      if (calOpen) { view = { y: val.y, m: val.m }; renderCal(); }
    } else if (b.dataset.nav) {
      const m = view.m + Number(b.dataset.nav);
      view = m < 1 ? { y: view.y - 1, m: 12 } : m > 12 ? { y: view.y + 1, m: 1 } : { y: view.y, m };
      renderCal();
    } else if (b.dataset.day) {
      Object.assign(val, { y: view.y, m: view.m, d: Number(b.dataset.day) });
      syncSelects(); renderCal(); update();
    } else if (b.dataset.time) {
      const [hh, mm] = b.dataset.time.split(':').map(Number);
      Object.assign(val, { hh, mm });
      syncSelects(); update();
    }
  });

  syncSelects();
  update();
  // keep the "relative" text and past-time check fresh while the dialog is open
  const timer = setInterval(() => { if (!el.isConnected) clearInterval(timer); else update(); }, 30e3);

  return {
    el,
    /** body fields for the API: { expires_at } | { expires_in_days } | {} (keep) */
    read() {
      if (selected === 'keep') return { ok: true, changed: false, body: {} };
      if (selected === 'none') return { ok: true, changed: current !== null || !keep, body: { expires_at: null } };
      if (selected === 'custom') {
        if (toMs(val) <= Date.now()) return { ok: false, error: 'วันและเวลาหมดอายุต้องอยู่หลังวันและเวลาปัจจุบัน' };
        return { ok: true, changed: true, body: { expires_at: toIso(val) } };
      }
      return { ok: true, changed: true, body: { expires_in_days: Number(selected) } };
    },
    /** human-readable summary for the confirmation view */
    describe: () => summary.textContent.trim(),
  };
}
