import { api } from './api.js';
import { icons } from './icons.js';
import { qs, esc, toast, renderErrorState, renderState, formatDateTime, riskBadge, findingBadge, aiStatusBadge, renderPagination, debounce, param } from './ui.js';
import { requireUser } from './auth.js';
import { FINDINGS, RISK_LEVELS, EYE_SIDES } from './constants.js';
import { confirmDialog } from '../components/modal.js';

const root = () => qs('#page-root');
const q = { page: 1, pageSize: 15, sort: 'screening_date', order: 'desc', saved: 'all' };
let user;

export async function init() {
  try { user = await requireUser(); } catch (err) { renderErrorState(root(), err); return; }
  const staff = user.account_type === 'staff';
  if (param('patient_id')) q.patient_id = param('patient_id');

  root().innerHTML = `
    <div class="page-head row-between">
      <div><h1>ประวัติการตรวจ</h1><p class="mb-0">${staff ? 'ประวัติการตรวจของผู้เข้ารับการตรวจทุกคนที่คุณบันทึก แยกตามบุคคล' : 'ประวัติการตรวจคัดกรองของคุณ'}</p></div>
      <div class="row">${staff ? `<a class="btn" href="/pages/patients.html">${icons.users}รายชื่อผู้เข้ารับการตรวจ</a>` : ''}<a class="btn btn-primary" href="/pages/medical-history.html">${icons.plus}ตรวจคัดกรองใหม่</a></div>
    </div>
    <form class="toolbar card" id="filters" role="search" aria-label="ค้นหาและกรองประวัติ">
      <div class="field grow"><label for="f-search">ค้นหา</label><input class="input" id="f-search" type="search" placeholder="${staff ? 'ชื่อ-นามสกุล หรือ รหัสการตรวจ' : 'รหัสการตรวจ'}"></div>
      ${staff ? '<div class="field"><label for="f-patient">ผู้เข้ารับการตรวจ</label><select class="select" id="f-patient"><option value="">ทุกคน</option></select></div>' : ''}
      <div class="field"><label for="f-from">ตั้งแต่วันที่</label><input class="input" id="f-from" type="date"></div>
      <div class="field"><label for="f-to">ถึงวันที่</label><input class="input" id="f-to" type="date"></div>
      <div class="field"><label for="f-disease">ผลการคัดกรอง</label><select class="select" id="f-disease"><option value="">ทั้งหมด</option>
        ${['cataract', 'pterygium', 'pinguecula', 'glaucoma', 'normal', 'no_finding', 'inconclusive'].map((k) => `<option value="${k}">${esc(FINDINGS[k].th)}</option>`).join('')}</select></div>
      <div class="field"><label for="f-risk">ระดับความเสี่ยง</label><select class="select" id="f-risk"><option value="">ทั้งหมด</option>
        ${Object.entries(RISK_LEVELS).map(([k, v]) => `<option value="${k}">${esc(v.th)}</option>`).join('')}</select></div>
      <div class="field"><label for="f-saved">สถานะ</label><select class="select" id="f-saved"><option value="all">ทั้งหมด</option><option value="saved">บันทึกแล้ว</option><option value="draft">ยังไม่บันทึก</option></select></div>
      <button type="reset" class="btn btn-ghost">ล้างตัวกรอง</button>
    </form>
    <div id="list"></div>
    <div class="pagination" id="pager"></div>`;

  if (staff) {
    // fills the patient filter without holding up the history list (both requests run in parallel)
    api.get('/patients', { pageSize: 100 })
      .then((pts) => qs('#f-patient')?.insertAdjacentHTML('beforeend', pts.items.map((p) => `<option value="${esc(p.id)}" ${p.id === q.patient_id ? 'selected' : ''}>${esc(p.full_name)}</option>`).join('')))
      .catch(() => { /* filter stays "all" */ });
  }

  const f = qs('#filters');
  const apply = () => {
    Object.assign(q, {
      page: 1,
      search: qs('#f-search').value.trim() || undefined,
      from: qs('#f-from').value || undefined,
      to: qs('#f-to').value || undefined,
      disease: qs('#f-disease').value || undefined,
      risk: qs('#f-risk').value || undefined,
      saved: qs('#f-saved').value,
      patient_id: staff ? qs('#f-patient').value || undefined : undefined,
    });
    load();
  };
  qs('#f-search').addEventListener('input', debounce(apply));
  f.addEventListener('change', (e) => { if (e.target.id !== 'f-search') apply(); });
  f.addEventListener('submit', (e) => { e.preventDefault(); apply(); });
  f.addEventListener('reset', () => setTimeout(apply, 0));
  load();
}

async function load() {
  const list = qs('#list');
  renderState(list, { type: 'loading', skeleton: 'table', rows: 6 });
  let data;
  try { data = await api.get('/screenings', q); } catch (err) { renderErrorState(list, err, load); return; }
  if (!data.items.length) {
    renderState(list, { type: 'empty', title: 'ไม่พบประวัติการตรวจ', message: 'ยังไม่มีข้อมูลตามเงื่อนไขที่เลือก', action: { href: '/pages/medical-history.html', label: 'เริ่มตรวจคัดกรอง' } });
    qs('#pager').innerHTML = '';
    return;
  }
  const th = (key, label) => `<th scope="col"><button type="button" class="th-sort" data-sort="${key}" aria-sort="${q.sort === key ? (q.order === 'asc' ? 'ascending' : 'descending') : 'none'}">${label}</button></th>`;
  list.innerHTML = `<div class="table-wrap"><table class="table stack-sm">
    <caption class="sr-only">ประวัติการตรวจ</caption>
    <thead><tr>${th('screening_code', 'รหัสการตรวจ')}<th scope="col">ชื่อผู้เข้ารับการตรวจ</th>${th('screening_date', 'วันที่ตรวจ')}<th scope="col">ประเภทการตรวจ</th>${th('primary_finding', 'ผลการคัดกรอง')}${th('risk_level', 'ระดับความเสี่ยง')}<th scope="col"><span class="sr-only">การดำเนินการ</span></th></tr></thead>
    <tbody>${data.items.map((s) => `<tr>
      <td data-label="รหัสการตรวจ" class="mono">${esc(s.screening_code)} ${s.is_saved ? '' : '<span class="badge badge-warning">ร่าง</span>'}</td>
      <td data-label="ชื่อ">${esc(s.subject_name ?? '-')}</td>
      <td data-label="วันที่ตรวจ">${formatDateTime(s.screening_date)}</td>
      <td data-label="ประเภท">ภาพถ่ายดวงตา · ${esc(EYE_SIDES[s.eye_side])}<br>${aiStatusBadge(s.ai_status)}</td>
      <td data-label="ผลการคัดกรอง">${findingBadge(s.primary_finding)}</td>
      <td data-label="ความเสี่ยง">${riskBadge(s.risk_level)}</td>
      <td class="actions"><a class="btn btn-sm" href="/pages/result.html?id=${esc(s.id)}">ดูรายละเอียด</a>
        <button class="btn btn-sm btn-outline-danger" data-del="${esc(s.id)}" data-code="${esc(s.screening_code)}" aria-label="ลบ ${esc(s.screening_code)}">${icons.trash}</button></td>
    </tr>`).join('')}</tbody></table></div>`;
  renderPagination(qs('#pager'), data, (p) => { q.page = p; load(); });

  list.querySelectorAll('[data-sort]').forEach((b) => b.addEventListener('click', () => {
    const key = b.dataset.sort;
    q.order = q.sort === key && q.order === 'desc' ? 'asc' : 'desc';
    q.sort = key;
    load();
  }));
  list.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: 'ลบผลการตรวจ',
      message: `ต้องการลบผลการตรวจ ${b.dataset.code} อย่างถาวรหรือไม่? ภาพดวงตาของการตรวจนี้จะถูกลบด้วย (ภาพที่ยินยอมให้ใช้พัฒนา AI จะคงอยู่จนกว่าจะเพิกถอนความยินยอม)`,
      confirmText: 'ลบ', danger: true,
    });
    if (!ok) return;
    try {
      await api.del(`/screenings/${b.dataset.del}`);
      toast('ลบผลการตรวจแล้ว', 'success');
      load();
    } catch (err) { toast(err.message, 'error'); }
  }));
}
