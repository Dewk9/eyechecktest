/**
 * 12.5 B–F: local consented-image dataset in Supabase Storage + review
 * workflow. A disease class is ONLY assigned by an admin reviewer; the AI's
 * suggestion is shown separately. Unreviewed images never go to training.
 */
import { api } from '../api.js';
import { icons } from '../icons.js';
import { qs, esc, toast, setBusy, renderErrorState, renderState, formatDateTime, renderPagination } from '../ui.js';
import { DISEASES, FINDINGS } from '../constants.js';
import { openModal, confirmDialog, promptDialog } from '../../components/modal.js';

const CLASS_KEYS = ['pinguecula', 'cataract', 'glaucoma', 'pterygium', 'normal', 'other'];
const CLASS_INFO = {
  pinguecula: 'ก้อนเนื้อสีเหลืองบริเวณเยื่อตาขาว',
  cataract: 'ความขุ่นขาวบริเวณรูม่านตา (Lens Opacity)',
  glaucoma: 'ภาพภายนอกยืนยันต้อหินไม่ได้ — ใช้ร่วมกับผลตรวจเฉพาะทางเท่านั้น',
  pterygium: 'เยื่อสีเหลือง/แดงยื่นเข้าไปในตาดำ',
};
const label = (k) => (DISEASES[k] ? `${DISEASES[k].th} (${DISEASES[k].en})` : k === 'normal' ? 'ปกติ (Normal)' : 'อื่น ๆ (Other)');
const classOptions = (sel) => CLASS_KEYS.map((k) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${esc(label(k))}</option>`).join('');
const statusBadge = (d) => ({ pending: '<span class="badge badge-warning">รอตรวจสอบ</span>', approved: '<span class="badge badge-success">อนุมัติแล้ว</span>', rejected: '<span class="badge badge-danger">ปฏิเสธ</span>' }[d.review_status])
  + (d.dataset_status === 'uploaded_to_roboflow' ? ' <span class="badge badge-primary">อยู่ใน Roboflow</span>' : d.dataset_status === 'upload_failed' ? ' <span class="badge badge-danger">ส่ง Roboflow ไม่สำเร็จ</span>' : '');

function card(d, mode) {
  return `<article class="thumb">
    ${d.url ? `<img src="${esc(d.url)}" alt="ภาพ Dataset ${esc(d.image_id)}" loading="lazy">` : '<div class="skeleton" style="aspect-ratio:4/3"></div>'}
    <div class="thumb-body">
      <span class="mono small" title="Image ID">${esc(d.image_id.slice(0, 8))}…</span>
      <span>${statusBadge(d)}</span>
      <span class="small">ประเภท: <strong>${d.disease_class ? esc(label(d.disease_class)) : 'ยังไม่กำหนด'}</strong></span>
      ${d.suggested_class ? `<span class="small muted">AI แนะนำ: ${esc(FINDINGS[d.suggested_class]?.th ?? d.suggested_class)} (ต้องตรวจสอบ)</span>` : ''}
      ${d.reject_reason ? `<span class="small" style="color:var(--danger)">เหตุผล: ${esc(d.reject_reason)}</span>` : ''}
      <span class="small muted">ยินยอม ${formatDateTime(d.consent_date)} · ${d.source === 'screening' ? 'จากการตรวจ' : 'ผู้ดูแลอัปโหลด'}</span>
      <div class="thumb-actions">
        <button class="btn btn-sm" data-detail="${esc(d.id)}">ดู</button>
        ${mode === 'review' && d.review_status === 'pending' ? `<button class="btn btn-sm btn-primary" data-approve="${esc(d.id)}">อนุมัติ</button><button class="btn btn-sm btn-outline-danger" data-reject="${esc(d.id)}">ปฏิเสธ</button>` : ''}
        ${d.review_status === 'approved' ? `<button class="btn btn-sm" data-reclass="${esc(d.id)}">แก้ประเภท</button>${d.dataset_status !== 'uploaded_to_roboflow' ? `<button class="btn btn-sm btn-accent" data-send="${esc(d.id)}">ส่ง Roboflow</button>` : ''}` : ''}
        <button class="btn btn-sm btn-ghost" data-del="${esc(d.id)}" aria-label="ลบภาพ">${icons.trash}</button>
      </div>
    </div></article>`;
}

async function handleAction(e, reload) {
  const b = e.target.closest('button');
  if (!b) return;
  const id = b.dataset.detail || b.dataset.approve || b.dataset.reject || b.dataset.reclass || b.dataset.send || b.dataset.del;
  if (!id) return;
  try {
    if (b.dataset.detail) {
      const d = await api.get(`/admin/datasets/${id}`);
      openModal({ title: 'รายละเอียดภาพ', wide: true, content: `<div class="grid grid-2"><div>${d.url ? `<img src="${esc(d.url)}" alt="" style="border-radius:12px">` : ''}</div>
        <dl class="kv"><dt>Image ID</dt><dd class="mono small">${esc(d.image_id)}</dd><dt>Disease Class</dt><dd>${d.disease_class ? esc(label(d.disease_class)) : 'ยังไม่กำหนด'}</dd>
          <dt>AI แนะนำ</dt><dd>${esc(d.suggested_class ?? '-')}</dd><dt>Storage Path</dt><dd class="mono small">${esc(d.storage_path)}</dd>
          <dt>Consent</dt><dd>${esc(d.consent_status)} · ${formatDateTime(d.consent_date)}</dd><dt>Upload Date</dt><dd>${formatDateTime(d.uploaded_at)}</dd>
          <dt>Review Status</dt><dd>${statusBadge(d)}</dd><dt>Reviewed</dt><dd>${formatDateTime(d.reviewed_at)}</dd>
          <dt>Roboflow Image ID</dt><dd class="mono small">${esc(d.roboflow_image_id ?? '-')}</dd>${d.roboflow_error ? `<dt>Roboflow</dt><dd class="small">${esc(d.roboflow_error)}</dd>` : ''}</dl></div>` });
      return;
    }
    if (b.dataset.approve || b.dataset.reclass) {
      const item = await api.get(`/admin/datasets/${id}`);
      const form = document.createElement('form');
      form.innerHTML = `${item.url ? `<img src="${esc(item.url)}" alt="" style="max-height:300px;border-radius:12px;margin:0 auto 12px">` : ''}
        <p class="small">ตรวจสอบคุณภาพภาพและลักษณะทางคลินิกก่อนกำหนดประเภท${item.suggested_class ? ` · AI แนะนำ: <strong>${esc(item.suggested_class)}</strong> (ไม่ใช่คำตอบที่ยืนยันแล้ว)` : ''}</p>
        <div class="field"><label for="cls">ประเภทโรค (Disease Class)</label><select class="select" id="cls" required><option value="">-- เลือกประเภทหลังตรวจสอบ --</option>${classOptions(item.disease_class)}</select></div>
        <label class="check-inline mt-3"><input type="checkbox" id="cls-ok" required> ข้าพเจ้าตรวจสอบภาพและประเภทแล้ว</label>
        <div class="modal-foot"><button type="button" class="btn" data-close>ยกเลิก</button><button class="btn btn-primary" type="submit">${b.dataset.approve ? 'อนุมัติภาพ' : 'บันทึกประเภท'}</button></div>`;
      const m = openModal({ title: b.dataset.approve ? 'อนุมัติภาพเข้าสู่ Dataset' : 'แก้ไขการจัดประเภท', content: form });
      form.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const cls = qs('#cls', form).value;
        if (!cls || !qs('#cls-ok', form).checked) { toast('กรุณาเลือกประเภทและยืนยันการตรวจสอบ', 'warning'); return; }
        const btn = qs('[type="submit"]', form);
        setBusy(btn, true);
        try {
          if (b.dataset.approve) await api.post(`/admin/datasets/${id}/approve`, { disease_class: cls });
          else await api.put(`/admin/datasets/${id}`, { disease_class: cls });
          toast('บันทึกแล้ว', 'success');
          m.close();
          reload();
        } catch (err) { toast(err.message, 'error'); setBusy(btn, false); }
      });
      return;
    }
    if (b.dataset.reject) {
      const reason = await promptDialog({ title: 'ปฏิเสธภาพ', label: 'เหตุผลในการปฏิเสธ (เช่น ภาพเบลอ ไม่ใช่ดวงตา ประเภทไม่ชัดเจน)', confirmText: 'ปฏิเสธ', danger: true });
      if (!reason) return;
      await api.post(`/admin/datasets/${id}/reject`, { reason });
      toast('ปฏิเสธภาพแล้ว', 'success');
      reload();
      return;
    }
    if (b.dataset.send) {
      if (!(await confirmDialog({ title: 'ส่งภาพไปยัง Roboflow', message: 'ภาพจะถูกอัปโหลดไปยังโปรเจกต์ Roboflow ที่ใช้งาน พร้อม tag ประเภท ต้อง Annotate (เช่น วาดกรอบ) ใน Roboflow ก่อนนำไป Train', confirmText: 'ส่งภาพ' }))) return;
      setBusy(b, true);
      const r = await api.post(`/admin/datasets/${id}/send-to-roboflow`, undefined, { timeout: 70000 });
      toast(r.duplicate ? 'ภาพนี้มีใน Roboflow แล้ว' : 'ส่งไป Roboflow แล้ว', 'success');
      reload();
      return;
    }
    if (b.dataset.del) {
      if (!(await confirmDialog({ title: 'ลบภาพจาก Dataset', message: 'ลบภาพออกจากคลังข้อมูล (Supabase Storage) อย่างถาวร หากภาพอยู่ใน Roboflow แล้ว ต้องลบที่ Roboflow แยกต่างหาก', danger: true, confirmText: 'ลบ' }))) return;
      const r = await api.del(`/admin/datasets/${id}`);
      toast(r.roboflow_image_id ? `ลบแล้ว (ภาพใน Roboflow id ${r.roboflow_image_id} ต้องลบแยก)` : 'ลบแล้ว', 'success', 6000);
      reload();
    }
  } catch (err) {
    toast(err.message, 'error', 6000);
    setBusy(b, false);
  }
}

// ---------------------------------------------------------------------
// B, C, E: Dataset management (by class)
// ---------------------------------------------------------------------
export async function renderDataset(box) {
  const q = { page: 1, pageSize: 24, review_status: 'approved' };
  box.innerHTML = `<header class="row-between"><div><h1>Dataset Management</h1><p class="muted mb-0">ภาพที่ได้รับความยินยอม จัดเก็บใน Supabase Storage แยกตามประเภทโรค (ไฟล์ตั้งชื่อด้วย UUID)</p></div>
      <div class="row"><label class="btn btn-primary" for="ds-upload">${icons.upload}เพิ่มภาพ</label><input type="file" id="ds-upload" class="sr-only" accept="image/jpeg,image/png,image/webp"></div></header>
    <div id="ds-summary" class="mb-4"></div>
    <form class="toolbar card" id="ds-f">
      <div class="field"><label for="ds-class">ประเภทโรค</label><select class="select" id="ds-class"><option value="">ทั้งหมด</option>${classOptions('')}</select></div>
      <div class="field"><label for="ds-status">สถานะตรวจสอบ</label><select class="select" id="ds-status"><option value="approved">อนุมัติแล้ว</option><option value="pending">รอตรวจสอบ</option><option value="rejected">ปฏิเสธ</option><option value="">ทั้งหมด</option></select></div>
      <div class="field"><label for="ds-rf">สถานะ Dataset</label><select class="select" id="ds-rf"><option value="">ทั้งหมด</option><option value="local">อยู่ในระบบ</option><option value="uploaded_to_roboflow">อยู่ใน Roboflow</option><option value="upload_failed">ส่งไม่สำเร็จ</option></select></div>
      <div class="field grow"><label for="ds-search">ค้นหา Image ID</label><input class="input" id="ds-search" placeholder="UUID แบบเต็ม"></div>
      <button class="btn" type="submit">${icons.search}ค้นหา</button>
    </form>
    <div id="ds-list"></div><div class="pagination" id="ds-pager"></div>`;

  const loadSummary = async () => {
    const el = qs('#ds-summary');
    renderState(el, { type: 'loading' });
    try {
      const s = await api.get('/admin/datasets/summary');
      el.innerHTML = `<div class="chips mb-3"><span class="badge">ทั้งหมด ${s.total}</span><span class="badge badge-warning">รอตรวจสอบ ${s.byStatus.pending}</span><span class="badge badge-success">อนุมัติ ${s.byStatus.approved}</span><span class="badge badge-danger">ปฏิเสธ ${s.byStatus.rejected}</span></div>
        <div class="class-cards">${['pinguecula', 'cataract', 'glaucoma', 'pterygium'].map((k) => `<article class="card class-card">
          <h3 class="mb-0" style="color:${DISEASES[k].color}">${esc(label(k))}</h3><p class="small muted mb-2">${esc(CLASS_INFO[k])}</p>
          <div class="metric">${s.byClass[k].approved}</div><span class="small muted">ภาพที่อนุมัติ · ส่ง Roboflow แล้ว ${s.byClass[k].uploaded}</span>
          <div class="samples">${s.samples[k].length ? s.samples[k].map((u) => `<img src="${esc(u)}" alt="" loading="lazy">`).join('') : '<span class="small muted">ยังไม่มีภาพตัวอย่าง</span>'}</div></article>`).join('')}</div>`;
    } catch (err) { renderErrorState(el, err, loadSummary); }
  };
  const list = qs('#ds-list');
  const load = async () => {
    renderState(list, { type: 'loading', skeleton: 'table', rows: 6 });
    let d;
    try { d = await api.get('/admin/datasets', q); } catch (err) { renderErrorState(list, err, load); return; }
    if (!d.items.length) { renderState(list, { type: 'empty', message: 'ไม่มีภาพตามเงื่อนไข' }); qs('#ds-pager').innerHTML = ''; return; }
    list.innerHTML = `<div class="gallery">${d.items.map((x) => card(x, 'dataset')).join('')}</div>`;
    renderPagination(qs('#ds-pager'), d, (p) => { q.page = p; load(); });
  };
  const reload = () => { loadSummary(); load(); };
  list.onclick = (e) => handleAction(e, reload);
  qs('#ds-f').addEventListener('submit', (e) => {
    e.preventDefault();
    Object.assign(q, { page: 1, disease_class: qs('#ds-class').value || undefined, review_status: qs('#ds-status').value || undefined, dataset_status: qs('#ds-rf').value || undefined, search: qs('#ds-search').value.trim() || undefined });
    load();
  });
  qs('#ds-f').addEventListener('change', (e) => { if (e.target.id !== 'ds-search') qs('#ds-f').requestSubmit(); });
  qs('#ds-upload').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const fd = new FormData();
    fd.append('image', file);
    try {
      await api.upload('/admin/datasets', fd);
      toast('เพิ่มภาพเข้าคิวรอตรวจสอบแล้ว', 'success');
      reload();
    } catch (err) { toast(err.message, 'error'); }
  });
  reload();
}

// ---------------------------------------------------------------------
// D, F: Review queue
// ---------------------------------------------------------------------
export async function renderReview(box) {
  const q = { page: 1, pageSize: 24, review_status: 'pending' };
  box.innerHTML = `<header><h1>ตรวจสอบภาพ (Dataset Review)</h1>
    <p class="muted">ภาพจากผู้ใช้ที่ยินยอมให้ใช้พัฒนา AI จะรออยู่ที่นี่ ต้องตรวจสอบคุณภาพและกำหนดประเภทก่อนอนุมัติ — ไม่มีการนำภาพที่ยังไม่ตรวจสอบไป Train โดยอัตโนมัติ</p></header>
    <div id="rv-list"></div><div class="pagination" id="rv-pager"></div>`;
  const list = qs('#rv-list');
  const load = async () => {
    renderState(list, { type: 'loading', skeleton: 'table', rows: 6 });
    let d;
    try { d = await api.get('/admin/datasets', q); } catch (err) { renderErrorState(list, err, load); return; }
    if (!d.items.length) { renderState(list, { type: 'empty', title: 'ไม่มีภาพรอตรวจสอบ', message: 'ภาพใหม่จะปรากฏเมื่อผู้ใช้ยินยอมให้ใช้ภาพ' }); qs('#rv-pager').innerHTML = ''; return; }
    list.innerHTML = `<p class="small muted">รอตรวจสอบ ${d.total} ภาพ</p><div class="gallery">${d.items.map((x) => card(x, 'review')).join('')}</div>`;
    renderPagination(qs('#rv-pager'), d, (p) => { q.page = p; load(); });
  };
  list.onclick = (e) => handleAction(e, load);
  load();
}
