import { api } from '../api.js';
import { qs, esc, renderErrorState, renderState, formatDateTime, riskBadge, findingBadge, aiStatusBadge, renderPagination } from '../ui.js';
import { FINDINGS, RISK_LEVELS, EYE_SIDES, ACCOUNT_TYPES } from '../constants.js';
import { openModal } from '../../components/modal.js';
import { renderAiSection } from '../ai-result.js';
import { icons } from '../icons.js';

// 12.4 Screening management
export async function render(box) {
  const q = { page: 1, pageSize: 20, sort: 'screening_date', order: 'desc', saved: 'all' };
  box.innerHTML = `<header><h1>จัดการผลการตรวจ</h1><p class="muted">ดูรายการตรวจทั้งหมด ภาพจะแสดงเฉพาะกรณีที่ได้รับความยินยอมให้จัดเก็บ/ใช้ภาพ</p></header>
    <form class="toolbar card" id="s-f">
      <div class="field grow"><label for="s-search">รหัสการตรวจ</label><input class="input" id="s-search" type="search" placeholder="EC-..."></div>
      <div class="field"><label for="s-from">ตั้งแต่</label><input class="input" type="date" id="s-from"></div>
      <div class="field"><label for="s-to">ถึง</label><input class="input" type="date" id="s-to"></div>
      <div class="field"><label for="s-disease">ประเภทโรค/ผล</label><select class="select" id="s-disease"><option value="">ทั้งหมด</option>${['cataract', 'pterygium', 'pinguecula', 'glaucoma', 'normal', 'no_finding', 'inconclusive'].map((k) => `<option value="${k}">${esc(FINDINGS[k].th)}</option>`).join('')}</select></div>
      <div class="field"><label for="s-risk">ความเสี่ยง</label><select class="select" id="s-risk"><option value="">ทั้งหมด</option>${Object.entries(RISK_LEVELS).map(([k, v]) => `<option value="${k}">${esc(v.th)}</option>`).join('')}</select></div>
      <button type="button" class="btn" id="s-referral">${icons.alert}เฉพาะที่ต้องส่งต่อ</button>
    </form><div id="s-counts" class="chips mb-3"></div><div id="s-list"></div><div class="pagination" id="s-pager"></div>`;

  const list = qs('#s-list');
  const load = async () => {
    renderState(list, { type: 'loading', skeleton: 'table', rows: 8 });
    let d;
    try { d = await api.get('/admin/screenings', q); } catch (err) { renderErrorState(list, err, load); return; }
    qs('#s-counts').innerHTML = `<span class="badge badge-primary">พบ ${d.total.toLocaleString('th-TH')} รายการ</span>`;
    if (!d.items.length) { renderState(list, { type: 'empty', message: 'ไม่พบผลการตรวจตามเงื่อนไข' }); qs('#s-pager').innerHTML = ''; return; }
    list.innerHTML = `<div class="table-wrap"><table class="table stack-sm"><thead><tr><th>รหัสการตรวจ</th><th>วันที่</th><th>บัญชีผู้ตรวจ</th><th>ตา</th><th>สถานะ AI</th><th>ผลการคัดกรอง</th><th>ความเสี่ยง</th><th>ยินยอมใช้ภาพ</th><th></th></tr></thead><tbody>
      ${d.items.map((s) => `<tr><td data-label="รหัส" class="mono">${esc(s.screening_code)}</td><td data-label="วันที่">${formatDateTime(s.screening_date)}</td>
        <td data-label="บัญชี">@${esc(s.profiles?.username ?? '-')}<br><span class="small muted">${esc(ACCOUNT_TYPES[s.profiles?.account_type] ?? '')}</span></td>
        <td data-label="ตา">${esc(EYE_SIDES[s.eye_side])}</td><td data-label="AI">${aiStatusBadge(s.ai_status)}</td>
        <td data-label="ผล">${findingBadge(s.primary_finding)}</td><td data-label="ความเสี่ยง">${riskBadge(s.risk_level)}</td>
        <td data-label="ยินยอม">${s.dataset_consent ? '<span class="badge badge-success">ยินยอม</span>' : '<span class="badge badge-muted">ไม่ยินยอม</span>'}</td>
        <td class="actions"><button class="btn btn-sm" data-view="${esc(s.id)}">รายละเอียด</button></td></tr>`).join('')}
    </tbody></table></div>`;
    renderPagination(qs('#s-pager'), d, (p) => { q.page = p; load(); });
  };
  list.onclick = (e) => { const id = e.target.closest('[data-view]')?.dataset.view; if (id) show(id); };
  const f = qs('#s-f');
  const apply = () => {
    Object.assign(q, { page: 1, search: qs('#s-search').value.trim() || undefined, from: qs('#s-from').value || undefined, to: qs('#s-to').value || undefined, disease: qs('#s-disease').value || undefined, risk: qs('#s-risk').value || undefined });
    load();
  };
  f.addEventListener('change', apply);
  f.addEventListener('submit', (e) => { e.preventDefault(); apply(); });
  qs('#s-referral').addEventListener('click', () => { qs('#s-risk').value = q.risk === 'high' ? 'urgent' : 'high'; apply(); });
  load();
  const pending = sessionStorage.getItem('ec_admin_open');
  if (pending) { sessionStorage.removeItem('ec_admin_open'); show(pending); }
}

async function show(id) {
  const body = document.createElement('div');
  renderState(body, { type: 'loading', skeleton: 'form', rows: 4 });
  openModal({ title: 'รายละเอียดผลการตรวจ', content: body, wide: true });
  let r;
  try { r = await api.get(`/admin/screenings/${id}`); } catch (err) { renderErrorState(body, err); return; }
  const s = r.screening;
  body.innerHTML = `
    <div class="grid grid-2">
      <div class="result-image">${r.image_url ? `<img src="${esc(r.image_url)}" alt="ภาพดวงตา (ได้รับความยินยอม)">` : `<div class="state" style="color:#cbd5e1;padding:24px">${icons.lock}<p class="small">${esc(r.image_hidden_reason)}</p></div>`}</div>
      <dl class="kv"><dt>รหัส</dt><dd class="mono">${esc(s.screening_code)}</dd><dt>วันที่</dt><dd>${formatDateTime(s.screening_date)}</dd>
        <dt>บัญชี</dt><dd>@${esc(r.owner?.username ?? '-')}</dd><dt>ผู้เข้ารับการตรวจ</dt><dd>${esc(r.subject?.type === 'patient' ? 'ผู้เข้ารับการตรวจของเจ้าหน้าที่' : 'เจ้าของบัญชี')} · อายุ ${esc(r.subject?.age ?? '-')} ปี</dd>
        <dt>ตา</dt><dd>${esc(EYE_SIDES[s.eye_side])}</dd><dt>ความเสี่ยง</dt><dd>${riskBadge(s.risk_level)}</dd>
        <dt>ปัจจัยที่พบ</dt><dd class="small">${(r.risk_assessment?.risk_factors ?? []).map((f) => esc(f.label)).join('<br>') || '-'}</dd></dl>
    </div>
    <h3 class="mt-4">ผลวิเคราะห์ AI</h3>${renderAiSection(r)}`;
}
