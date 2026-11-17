/**
 * Staff: manage people being screened — add, edit, search, per-person
 * history, compare screenings, print, delete (with confirmation).
 */
import { api } from './api.js';
import { icons } from './icons.js';
import { qs, esc, toast, setBusy, renderErrorState, renderState, formatDate, formatDateTime, calcAge, riskBadge, findingBadge, renderPagination, debounce, showFieldErrors, clearFieldErrors, formToObject, pct } from './ui.js';
import { requireUser } from './auth.js';
import { GENDERS, EYE_SIDES, RISK_LEVELS } from './constants.js';
import { resetWorkflow } from './workflow.js';
import { openModal, confirmDialog } from '../components/modal.js';

const root = () => qs('#page-root');
const q = { page: 1, pageSize: 15 };

export async function init() {
  try { await requireUser({ accountTypes: ['staff'] }); } catch (err) { renderErrorState(root(), err); return; }
  root().innerHTML = `
    <div class="page-head row-between">
      <div><h1>รายชื่อผู้เข้ารับการตรวจ</h1><p class="mb-0">ข้อมูลผู้เข้ารับการตรวจถูกจัดเก็บแยกจากบัญชีของคุณ และเข้าถึงได้เฉพาะบัญชีของคุณเท่านั้น</p></div>
      <button class="btn btn-primary" id="btn-add">${icons.plus}เพิ่มบุคคลใหม่</button>
    </div>
    <div class="toolbar card"><div class="field grow"><label for="p-search">ค้นหาชื่อ-นามสกุล</label><input class="input" id="p-search" type="search" placeholder="พิมพ์ชื่อเพื่อค้นหา"></div></div>
    <div id="list"></div><div class="pagination" id="pager"></div>
    <div id="detail" class="mt-5"></div>`;
  qs('#btn-add').addEventListener('click', () => editPatient(null));
  qs('#p-search').addEventListener('input', debounce((e) => { q.search = e.target.value.trim() || undefined; q.page = 1; load(); }));
  load();
  const pid = new URLSearchParams(location.search).get('id');
  if (pid) showDetail(pid);
}

async function load() {
  const list = qs('#list');
  renderState(list, { type: 'loading', skeleton: 'table', rows: 6 });
  let data;
  try { data = await api.get('/patients', q); } catch (err) { renderErrorState(list, err, load); return; }
  if (!data.items.length) {
    renderState(list, { type: 'empty', title: 'ยังไม่มีรายชื่อ', message: q.search ? 'ไม่พบชื่อที่ค้นหา' : 'เพิ่มผู้เข้ารับการตรวจคนแรกเพื่อเริ่มตรวจคัดกรอง' });
    qs('#pager').innerHTML = '';
    return;
  }
  list.innerHTML = `<div class="table-wrap"><table class="table stack-sm"><thead><tr><th>ชื่อ-นามสกุล</th><th>อายุ</th><th>เพศ</th><th>ตรวจล่าสุด</th><th>ความเสี่ยงล่าสุด</th><th><span class="sr-only">การดำเนินการ</span></th></tr></thead><tbody>
    ${data.items.map((p) => `<tr>
      <td data-label="ชื่อ"><strong>${esc(p.full_name)}</strong><br><span class="small muted">เกิด ${formatDate(p.birth_date)}</span></td>
      <td data-label="อายุ">${esc(p.current_age)} ปี</td>
      <td data-label="เพศ">${esc(GENDERS[p.gender])}</td>
      <td data-label="ตรวจล่าสุด">${p.latest_screening ? `${formatDate(p.latest_screening.screening_date)} <span class="small muted">(${p.latest_screening.count} ครั้ง)</span>` : '<span class="muted">ยังไม่เคยตรวจ</span>'}</td>
      <td data-label="ความเสี่ยง">${p.latest_screening ? riskBadge(p.latest_screening.risk_level) : '-'}</td>
      <td class="actions">
        <button class="btn btn-sm btn-primary" data-screen="${esc(p.id)}">${icons.eye}ตรวจ</button>
        <button class="btn btn-sm" data-view="${esc(p.id)}">ประวัติ</button>
        <button class="btn btn-sm" data-edit="${esc(p.id)}" aria-label="แก้ไข ${esc(p.full_name)}">${icons.edit}</button>
        <button class="btn btn-sm btn-outline-danger" data-del="${esc(p.id)}" data-name="${esc(p.full_name)}" aria-label="ลบ ${esc(p.full_name)}">${icons.trash}</button>
      </td></tr>`).join('')}</tbody></table></div>`;
  renderPagination(qs('#pager'), data, (p) => { q.page = p; load(); });
  list.onclick = async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const row = data.items.find((p) => p.id === (b.dataset.screen || b.dataset.view || b.dataset.edit || b.dataset.del));
    if (b.dataset.screen) startScreening(row);
    if (b.dataset.view) showDetail(row.id);
    if (b.dataset.edit) editPatient(row);
    if (b.dataset.del) removePatient(row);
  };
}

function startScreening(p) {
  resetWorkflow({ subject: { type: 'patient', id: p.id, name: p.full_name, age: p.current_age ?? calcAge(p.birth_date) } });
  location.href = `/pages/medical-history.html?patient=${encodeURIComponent(p.id)}`;
}

function editPatient(p) {
  const form = document.createElement('form');
  form.noValidate = true;
  form.innerHTML = `
    <div class="form-grid">
      <div class="field full"><label for="e-name" class="required">ชื่อ-นามสกุล</label><input class="input" id="e-name" name="full_name" required maxlength="150" value="${esc(p?.full_name ?? '')}"><span class="field-error" data-error-for="full_name"></span></div>
      <div class="field"><label for="e-birth" class="required">วัน/เดือน/ปีเกิด</label><input class="input" id="e-birth" name="birth_date" type="date" required value="${esc(p?.birth_date ?? '')}" max="${new Date().toISOString().slice(0, 10)}"><span class="field-error" data-error-for="birth_date"></span></div>
      <div class="field"><label for="e-age" class="required">อายุ (ปี)</label><input class="input" id="e-age" name="age" type="number" min="0" max="130" required value="${esc(p?.age ?? '')}"><span class="field-error" data-error-for="age"></span></div>
      <div class="field"><label for="e-gender" class="required">เพศ</label><select class="select" id="e-gender" name="gender" required><option value="">-- เลือก --</option>${Object.entries(GENDERS).map(([k, v]) => `<option value="${k}" ${p?.gender === k ? 'selected' : ''}>${v}</option>`).join('')}</select><span class="field-error" data-error-for="gender"></span></div>
      <div class="field full"><label for="e-notes">หมายเหตุ</label><textarea class="textarea" id="e-notes" name="notes" maxlength="1000">${esc(p?.notes ?? '')}</textarea></div>
    </div>
    <div class="modal-foot"><button type="button" class="btn" data-close>ยกเลิก</button><button type="submit" class="btn btn-primary">${icons.save}บันทึก</button></div>`;
  const m = openModal({ title: p ? 'แก้ไขข้อมูลผู้เข้ารับการตรวจ' : 'เพิ่มผู้เข้ารับการตรวจ', content: form });
  qs('#e-birth', form).addEventListener('change', (e) => { const a = calcAge(e.target.value); if (a !== null) qs('#e-age', form).value = a; });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearFieldErrors(form);
    const v = formToObject(form);
    const errs = [];
    if (!v.full_name) errs.push({ field: 'full_name', message: 'กรุณากรอกชื่อ-นามสกุล' });
    if (!v.birth_date) errs.push({ field: 'birth_date', message: 'กรุณาระบุวันเกิด' });
    if (v.age === '') errs.push({ field: 'age', message: 'กรุณากรอกอายุ' });
    if (!v.gender) errs.push({ field: 'gender', message: 'กรุณาเลือกเพศ' });
    if (errs.length) { showFieldErrors(form, errs); return; }
    const btn = qs('[type="submit"]', form);
    setBusy(btn, true);
    try {
      const body = { ...v, age: Number(v.age), notes: v.notes || null };
      if (p) await api.put(`/patients/${p.id}`, body); else await api.post('/patients', body);
      toast('บันทึกข้อมูลแล้ว', 'success');
      m.close();
      load();
    } catch (err) {
      toast(err.message, 'error');
      if (err.details) showFieldErrors(form, err.details);
      setBusy(btn, false);
    }
  });
}

async function removePatient(p) {
  const ok = await confirmDialog({
    title: 'ลบข้อมูลผู้เข้ารับการตรวจ',
    message: `การลบ "${p.full_name}" จะลบประวัติสุขภาพ ผลการทดสอบ ผลการตรวจ และภาพดวงตาทั้งหมดของบุคคลนี้อย่างถาวร`,
    confirmText: 'ลบถาวร', danger: true, requireText: 'ลบ',
  });
  if (!ok) return;
  try {
    await api.del(`/patients/${p.id}`);
    toast('ลบข้อมูลแล้ว', 'success');
    qs('#detail').innerHTML = '';
    load();
  } catch (err) { toast(err.message, 'error'); }
}

async function showDetail(id) {
  const box = qs('#detail');
  renderState(box, { type: 'loading', skeleton: 'form', rows: 4 });
  box.scrollIntoView({ behavior: 'smooth', block: 'start' });
  let p; let scr; let hist;
  try {
    [p, scr, hist] = await Promise.all([
      api.get(`/patients/${id}`),
      api.get('/screenings', { patient_id: id, pageSize: 100, sort: 'screening_date', order: 'desc' }),
      api.get(`/medical-history/${id}`),
    ]);
  } catch (err) { renderErrorState(box, err, () => showDetail(id)); return; }

  box.innerHTML = `
    <section class="card" aria-labelledby="h-detail">
      <div class="row-between mb-3">
        <div><span class="source-tag">ข้อมูลรายบุคคล</span><h2 id="h-detail" class="mb-0">${esc(p.full_name)}</h2>
          <p class="muted mb-0">อายุ ${esc(p.current_age)} ปี · ${esc(GENDERS[p.gender])} · เกิด ${formatDate(p.birth_date)}</p></div>
        <div class="row no-print"><button class="btn btn-primary" id="d-screen">${icons.eye}ตรวจคัดกรองบุคคลนี้</button>
          <button class="btn" id="d-compare">${icons.compare}เปรียบเทียบผลที่เลือก</button>
          <button class="btn" id="d-print">${icons.printer}พิมพ์รายงาน</button></div>
      </div>
      ${p.notes ? `<p class="text-2">${esc(p.notes)}</p>` : ''}
      <h3>ผลการตรวจย้อนหลัง (${scr.total} ครั้ง)</h3>
      ${scr.items.length ? `<div class="table-wrap"><table class="table stack-sm"><thead><tr><th class="no-print"><span class="sr-only">เลือก</span></th><th>รหัสการตรวจ</th><th>วันที่</th><th>ตา</th><th>ผลการคัดกรอง</th><th>ความเสี่ยง</th><th class="no-print"></th></tr></thead><tbody>
        ${scr.items.map((s) => `<tr><td class="no-print"><input type="checkbox" data-cmp="${esc(s.id)}" aria-label="เลือก ${esc(s.screening_code)} เพื่อเปรียบเทียบ"></td>
          <td data-label="รหัส" class="mono">${esc(s.screening_code)}</td><td data-label="วันที่">${formatDateTime(s.screening_date)}</td><td data-label="ตา">${esc(EYE_SIDES[s.eye_side])}</td>
          <td data-label="ผล">${findingBadge(s.primary_finding)}</td><td data-label="ความเสี่ยง">${riskBadge(s.risk_level)}</td>
          <td class="actions no-print"><a class="btn btn-sm" href="/pages/result.html?id=${esc(s.id)}">ดู</a></td></tr>`).join('')}
      </tbody></table></div>` : '<p class="muted">ยังไม่มีผลการตรวจ</p>'}
      <h3 class="mt-5">ประวัติการซักประวัติ (${hist.length} ครั้ง)</h3>
      ${hist.length ? `<ul class="recent-list">${hist.map((h) => `<li><span>${formatDateTime(h.created_at)}</span><span class="small">${esc(h.summary.age_group?.label ?? '')} · ปัจจัยเสี่ยง ${h.summary.risk_factors.length} · อาการ ${h.summary.symptoms.length}${h.emergency_symptoms ? ' · <span class="badge risk-urgent">ฉุกเฉิน</span>' : ''}</span></li>`).join('')}</ul>` : '<p class="muted">ยังไม่มีการซักประวัติ</p>'}
    </section>`;
  qs('#d-screen').addEventListener('click', () => startScreening(p));
  qs('#d-print').addEventListener('click', () => window.print());
  qs('#d-compare').addEventListener('click', () => {
    const ids = [...box.querySelectorAll('[data-cmp]:checked')].map((c) => c.dataset.cmp);
    if (ids.length !== 2) { toast('กรุณาเลือกผลการตรวจ 2 รายการเพื่อเปรียบเทียบ', 'warning'); return; }
    compare(ids);
  });
}

async function compare(ids) {
  const body = document.createElement('div');
  renderState(body, { type: 'loading', skeleton: 'form', rows: 4 });
  openModal({ title: 'เปรียบเทียบผลการตรวจ', content: body, wide: true });
  let a; let b;
  try { [a, b] = await Promise.all(ids.map((id) => api.get(`/results/${id}`))); } catch (err) { renderErrorState(body, err); return; }
  const [first, second] = [a, b].sort((x, y) => new Date(x.screening.screening_date) - new Date(y.screening.screening_date));
  const col = (r) => {
    const top = (r.ai?.diseases ?? []).filter((d) => d.confidence !== null).map((d) => `${esc(d.disease)} ${pct(d.confidence)}`).join(', ') || '-';
    return `<div class="card">
      <p class="mono mb-0">${esc(r.screening.screening_code)}</p><p class="small muted">${formatDateTime(r.screening.screening_date)} · ${esc(EYE_SIDES[r.screening.eye_side])}</p>
      ${r.image_url ? `<img src="${esc(r.image_url)}" alt="ภาพดวงตา" style="border-radius:10px;margin-bottom:10px">` : ''}
      <dl class="kv"><dt>ผลคัดกรอง</dt><dd>${findingBadge(r.screening.primary_finding)}</dd>
        <dt>ความเสี่ยง</dt><dd>${riskBadge(r.risk_assessment?.risk_level)}</dd>
        <dt>Confidence (โมเดล)</dt><dd class="small">${top}</dd>
        <dt>อาการ</dt><dd class="small">${r.medical_history?.symptoms?.length ? r.medical_history.symptoms.map((s) => esc(s.label)).join('; ') : 'ไม่มี'}</dd>
        <dt>ผลทดสอบเกินเกณฑ์</dt><dd class="small">${r.vision_test?.available ? (r.vision_test.abnormal_tests.length ? r.vision_test.abnormal_tests.map((k) => esc(r.vision_test.tests[k].label)).join('; ') : 'ไม่มี') : 'ไม่ได้ทดสอบ'}</dd></dl></div>`;
  };
  const levels = Object.keys(RISK_LEVELS);
  const change = (first.risk_assessment && second.risk_assessment)
    ? (levels.indexOf(second.risk_assessment.risk_level) === levels.indexOf(first.risk_assessment.risk_level) ? 'ระดับความเสี่ยงเท่าเดิม' : `ระดับความเสี่ยงเปลี่ยนจาก "${RISK_LEVELS[first.risk_assessment.risk_level].th}" เป็น "${RISK_LEVELS[second.risk_assessment.risk_level].th}"`)
    : 'ข้อมูลไม่เพียงพอสำหรับเปรียบเทียบ';
  body.innerHTML = `<p><strong>${esc(change)}</strong></p><div class="grid grid-2">${col(first)}${col(second)}</div>`;
}
