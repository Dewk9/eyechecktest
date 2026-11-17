/**
 * 12.5 A (Roboflow connection) and G (AI training management).
 * Everything shown here comes from the Roboflow API through the backend.
 * Nothing is marked "trained" or given metrics unless Roboflow returns them.
 */
import { api } from '../api.js';
import { icons } from '../icons.js';
import { qs, esc, toast, setBusy, renderErrorState, renderState, formatDateTime } from '../ui.js';
import { DISEASES } from '../constants.js';
import { confirmDialog } from '../../components/modal.js';

const fmtTime = (v) => {
  if (!v) return '-';
  const n = Number(v);
  return formatDateTime(Number.isFinite(n) ? new Date(n < 1e12 ? n * 1000 : n).toISOString() : v);
};
// Roboflow reports metrics either as fractions (0–1) or percentages; shown as returned, scaled for display only
const metric = (v) => {
  const n = Number(v);
  if (v === null || v === undefined || v === '' || !Number.isFinite(n)) return '<span class="muted">ไม่มีข้อมูล</span>';
  return `${(n <= 1 ? n * 100 : n).toFixed(1)}%`;
};

function supportList(supported) {
  return Object.entries(DISEASES).map(([k, v]) => `<span class="badge ${supported?.[k] ? 'badge-success' : 'badge-muted'}">${supported?.[k] ? icons.check : icons.x}${v.th}</span>`).join(' ');
}

// ---------------------------------------------------------------------
export async function renderConnection(box) {
  box.innerHTML = `<header class="row-between"><div><h1>Roboflow Connection</h1><p class="muted mb-0">สถานะการเชื่อมต่อ Workspace / Project / Model จาก Roboflow API จริง</p></div>
    <button class="btn" id="rf-refresh">${icons.refresh}Refresh Data</button></header><div id="rf-body"></div>`;
  const body = qs('#rf-body');
  const load = async () => {
    renderState(body, { type: 'loading', message: 'กำลังเชื่อมต่อ Roboflow...' });
    let s;
    try { s = await api.get('/admin/roboflow/status', null, { timeout: 45000 }); } catch (err) { renderErrorState(body, err, load); return; }
    if (!s.connected) {
      body.innerHTML = `<div class="alert alert-danger">${icons.xCircle}<div><strong>Not Connected${s.status ? ` · ${esc(s.status)}` : ''}</strong>${esc(s.reason)}
        <p class="small mb-0 mt-2">ตั้งค่า ROBOFLOW_API_KEY และ ROBOFLOW_WORKFLOW_URL (คัดลอกจาก Roboflow → Deploy → Cloud API) รวมถึง ROBOFLOW_WORKSPACE, ROBOFLOW_PROJECT, ROBOFLOW_MODEL_VERSION ในไฟล์ backend/.env แล้วรีสตาร์ท Backend (API Key จะไม่ถูกส่งมายังเบราว์เซอร์)</p></div></div>`;
      return;
    }
    const p = s.project;
    const ai = s.ai;
    const workflowCard = s.mode === 'workflow' ? `
      <section class="card mb-4"><h2>Roboflow Workflow (Cloud API)</h2>
        <dl class="kv"><dt>สถานะ</dt><dd><span class="badge ${ai.status === 'CONNECTED' ? 'badge-success' : 'badge-warning'}">${esc(ai.status)}</span> ทดสอบเรียก Workflow จริงสำเร็จ</dd>
          <dt>Workflow</dt><dd class="mono small">${esc(ai.workflow ?? '-')}</dd>
          <dt>Model ที่ใช้จริง</dt><dd class="mono small">${esc(ai.modelId ?? '-')} <span class="muted">(${esc(ai.kind ?? '')})</span></dd>
          <dt>คลาสที่โมเดลส่งกลับ</dt><dd>${(ai.classes ?? []).map((c) => `<span class="badge">${esc(c.name)} → ${esc(c.disease)}</span>`).join(' ')}</dd>
          <dt>ระยะเวลาตอบกลับ</dt><dd>${esc(ai.latencyMs ?? '-')} ms · ตรวจเมื่อ ${formatDateTime(ai.checkedAt)}</dd></dl>
        <p class="small muted mb-0">สถานะนี้ได้จากการส่งภาพทดสอบไปยัง Workflow จริง (แคช 10 นาที กด Refresh Data เพื่อตรวจใหม่) — ไม่ได้ใช้รายการ Dataset Version ตัดสินว่าโมเดลพร้อมหรือไม่</p></section>` : '';
    body.innerHTML = `${workflowCard}
      <div class="grid grid-4 mb-4">
        <div class="card stat"><span class="stat-label">Connection Status</span><span class="stat-value" style="font-size:1.3rem"><span class="status-dot ${ai.ready ? 'ok' : 'warn'}"></span> ${ai.ready ? 'Connected' : 'Connected (ยังไม่พร้อม)'}</span><span class="stat-sub">${esc(ai.reason ?? (s.mode === 'workflow' ? 'Workflow ตอบกลับผลจริง' : 'API Key ถูกต้อง'))}</span></div>
        <div class="card stat"><span class="stat-label">Workspace</span><span class="stat-value" style="font-size:1.2rem">${esc(s.active?.workspace ?? s.env_defaults.workspace ?? '-')}</span></div>
        <div class="card stat"><span class="stat-label">Project</span><span class="stat-value" style="font-size:1.2rem">${esc(p?.name ?? s.active?.project ?? '-')}</span><span class="stat-sub">${esc(p?.type ?? '')}</span></div>
        <div class="card stat"><span class="stat-label">Model Version (ใช้งาน)</span><span class="stat-value" style="font-size:1.2rem">${esc(s.active?.version ?? '-')}</span><span class="stat-sub">ที่มา: ${esc(s.active?.source === 'admin' ? 'ผู้ดูแลเลือก' : '.env')}</span></div>
      </div>
      ${p && !p.error ? `<section class="card mb-4"><h2>ข้อมูล Dataset จาก Roboflow</h2>
        <dl class="kv"><dt>จำนวนภาพใน Dataset</dt><dd>${esc(p.images ?? '-')}</dd>
          <dt>Annotated Images</dt><dd>${p.annotated ?? '<span class="muted">API ไม่ได้ส่งข้อมูล</span>'}${p.unannotated !== null ? ` <span class="small muted">(ยังไม่ annotate ${esc(p.unannotated)})</span>` : ''}</dd>
          <dt>จำนวน Classes</dt><dd>${esc(p.class_count)} — ${Object.entries(p.classes).map(([k, v]) => `<span class="badge">${esc(k)}: ${esc(v)}</span>`).join(' ')}</dd>
          <dt>จำนวน Dataset Versions</dt><dd>${esc(p.versions)}</dd>
          <dt>Last Updated</dt><dd>${fmtTime(p.updated)}</dd>
          <dt>โรคที่โมเดลรองรับจริง</dt><dd>${supportList(ai.supportedDiseases)}</dd></dl>
        <div class="row mt-4">${s.project_url ? `<a class="btn" href="${esc(s.project_url)}" target="_blank" rel="noopener">${icons.link}Open Roboflow Project</a>` : ''}</div></section>`
      : `<div class="alert alert-warning mb-4">${icons.alert}<div>${esc(p?.error ?? 'ยังไม่ได้เลือกโปรเจกต์')}</div></div>`}
      <section class="card mb-4"><h2>เลือก Project และ Model Version</h2><div id="rf-projects"></div></section>
      <section class="card"><div class="row-between"><h2 class="mb-0">ภาพใน Roboflow Project</h2>
        <form class="row" id="rf-img-f"><label class="sr-only" for="rf-class">Class</label><input class="input" id="rf-class" placeholder="กรองตาม class" style="width:180px">
          <button class="btn" type="submit">${icons.search}ค้นหา</button>
          <label class="btn" for="rf-upload">${icons.upload}เพิ่มภาพ</label><input type="file" id="rf-upload" class="sr-only" accept="image/jpeg,image/png,image/webp"></form></div>
        <p class="small muted">ภาพที่อัปโหลดจากหน้านี้จะเข้า Roboflow โดยตรง (ต้อง Annotate ใน Roboflow) — ภาพจากผู้ใช้ให้ผ่านเมนู "ตรวจสอบภาพ" ก่อนเสมอ</p>
        <div id="rf-images"></div></section>`;
    loadProjects(s);
    const imgBox = qs('#rf-images');
    const loadImages = async (offset = 0) => {
      renderState(imgBox, { type: 'loading' });
      let d;
      try { d = await api.get('/admin/roboflow/images', { offset, limit: 24, class_name: qs('#rf-class').value.trim() || undefined }, { timeout: 45000 }); } catch (err) { renderErrorState(imgBox, err, () => loadImages(offset)); return; }
      if (!d.items.length) { renderState(imgBox, { type: 'empty', message: 'ไม่พบภาพ' }); return; }
      imgBox.innerHTML = `<p class="small muted">ทั้งหมด ${esc(d.total ?? '?')} ภาพ</p><div class="table-wrap"><table class="table stack-sm"><thead><tr><th>Image</th><th>Split</th><th>Labels / Annotation</th><th>Tags</th><th></th></tr></thead><tbody>
        ${d.items.map((i) => `<tr><td data-label="Image" class="small mono">${esc(i.name ?? i.id)}</td><td data-label="Split">${esc(i.split ?? '-')}</td>
          <td data-label="Labels" class="small">${i.labels ? esc(Array.isArray(i.labels) ? i.labels.join(', ') : JSON.stringify(i.labels)) : '<span class="muted">ยังไม่มี</span>'}</td>
          <td data-label="Tags">${(i.tags ?? []).map((t) => `<span class="badge">${esc(t)}</span>`).join(' ')}</td>
          <td class="actions"><button class="btn btn-sm" data-rfimg="${esc(i.id)}">รายละเอียด</button><button class="btn btn-sm btn-outline-danger" data-rfdel="${esc(i.id)}">${icons.trash}</button></td></tr>`).join('')}
      </tbody></table></div>
      <div class="pagination">${offset > 0 ? `<button class="btn btn-sm" data-off="${Math.max(0, offset - 24)}">ก่อนหน้า</button>` : ''}${d.total > offset + 24 ? `<button class="btn btn-sm" data-off="${offset + 24}">ถัดไป</button>` : ''}</div>`;
      imgBox.onclick = async (e) => {
        const off = e.target.closest('[data-off]')?.dataset.off;
        if (off !== undefined) { loadImages(Number(off)); return; }
        const v = e.target.closest('[data-rfimg]')?.dataset.rfimg;
        if (v) {
          try {
            const img = await api.get(`/admin/roboflow/images/${encodeURIComponent(v)}`);
            const { openModal } = await import('../../components/modal.js');
            openModal({ title: `Roboflow image ${img.id}`, wide: true, content: `${img.urls?.thumb || img.urls?.original ? `<img src="${esc(img.urls.thumb ?? img.urls.original)}" alt="" style="max-height:320px;border-radius:10px;margin-bottom:12px">` : ''}<pre class="json">${esc(JSON.stringify({ split: img.split, tags: img.tags, labels: img.labels, annotation: img.annotation }, null, 2))}</pre>` });
          } catch (err) { toast(err.message, 'error'); }
        }
        const del = e.target.closest('[data-rfdel]')?.dataset.rfdel;
        if (del && await confirmDialog({ title: 'ลบภาพจาก Roboflow', message: 'ระบบจะพยายามลบผ่าน Roboflow API หาก API ไม่รองรับจะแจ้งให้ลบผ่านหน้าเว็บ Roboflow', danger: true, confirmText: 'ลบ' })) {
          try { await api.del(`/admin/roboflow/images/${encodeURIComponent(del)}`); toast('ลบแล้ว', 'success'); loadImages(offset); } catch (err) { toast(err.message, 'error', 7000); }
        }
      };
    };
    qs('#rf-img-f').addEventListener('submit', (e) => { e.preventDefault(); loadImages(0); });
    qs('#rf-upload').addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file) return;
      const fd = new FormData();
      fd.append('image', file);
      try { const r = await api.upload('/admin/roboflow/upload', fd); toast(r.duplicate ? 'ภาพนี้มีใน Roboflow แล้ว' : 'อัปโหลดไป Roboflow แล้ว', 'success'); loadImages(0); } catch (err) { toast(err.message, 'error'); }
    });
    if (s.active) loadImages(0);
  };
  qs('#rf-refresh').addEventListener('click', load);
  load();
}

async function loadProjects(status) {
  const box = qs('#rf-projects');
  renderState(box, { type: 'loading' });
  let projects;
  try { projects = await api.get('/admin/roboflow/projects', null, { timeout: 45000 }); } catch (err) { renderErrorState(box, err, () => loadProjects(status)); return; }
  if (!projects.length) { renderState(box, { type: 'empty', message: 'ไม่พบโปรเจกต์ใน Workspace นี้' }); return; }
  const active = status.active;
  box.innerHTML = `<div class="form-grid">
      <div class="field"><label for="rf-proj">Project</label><select class="select" id="rf-proj">${projects.map((p) => `<option value="${esc(p.id)}" data-ws="${esc(p.workspace)}" ${active?.project === p.id ? 'selected' : ''}>${esc(p.name)} (${esc(p.type)}) · ${esc(p.images ?? '?')} ภาพ</option>`).join('')}</select></div>
      <div class="field"><label for="rf-ver">Model Version</label><select class="select" id="rf-ver"><option>กำลังโหลด...</option></select></div>
    </div><div id="rf-ver-info" class="mt-3"></div>
    <button class="btn btn-primary mt-4" id="rf-set">${icons.check}Set Active Model</button>`;
  const loadVersions = async () => {
    const proj = qs('#rf-proj').value;
    qs('#rf-ver').innerHTML = '<option>กำลังโหลด...</option>';
    try {
      const v = await api.get('/admin/roboflow/models', { project: proj }, { timeout: 45000 });
      qs('#rf-ver').innerHTML = v.versions.length ? v.versions.map((x) => `<option value="${esc(x.version)}" ${x.is_active ? 'selected' : ''} ${x.model ? '' : 'data-untrained="1"'}>v${esc(x.version)} ${esc(x.name ?? '')} — ${x.model ? 'มีโมเดล' : 'ยังไม่ได้ Train'}</option>`).join('') : '<option value="">ไม่มีเวอร์ชัน</option>';
      qs('#rf-ver-info').innerHTML = `<p class="small mb-0">โรคที่โปรเจกต์นี้รองรับ (จาก classes จริง): ${supportList(v.capabilities.supported)}${v.capabilities.unmappedClasses.length ? ` · classes อื่น: ${v.capabilities.unmappedClasses.map(esc).join(', ')}` : ''}</p>`;
    } catch (err) { qs('#rf-ver').innerHTML = `<option value="">${esc(err.message)}</option>`; }
  };
  qs('#rf-proj').addEventListener('change', loadVersions);
  qs('#rf-set').addEventListener('click', async (e) => {
    const opt = qs('#rf-proj').selectedOptions[0];
    const ver = qs('#rf-ver').value;
    if (!ver) { toast('กรุณาเลือกเวอร์ชัน', 'warning'); return; }
    if (qs('#rf-ver').selectedOptions[0]?.dataset.untrained) { toast('เวอร์ชันนี้ยังไม่มีโมเดลที่ฝึกแล้ว ตั้งเป็นโมเดลใช้งานไม่ได้', 'warning'); return; }
    setBusy(e.currentTarget, true);
    try {
      const r = await api.put('/admin/roboflow/active-model', { workspace: opt.dataset.ws, project: opt.value, version: Number(ver) });
      toast(`ตั้ง ${r.project} v${r.version} เป็นโมเดลที่ใช้งานแล้ว`, 'success');
      location.hash = '#roboflow';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    } catch (err) { toast(err.message, 'error'); } finally { setBusy(e.currentTarget, false); }
  });
  loadVersions();
}

// ---------------------------------------------------------------------
export async function renderTraining(box) {
  box.innerHTML = `<header class="row-between"><div><h1>AI Training Management</h1><p class="muted mb-0">Dataset Version, สถานะการฝึก และประสิทธิภาพโมเดลจาก Roboflow (แสดงเฉพาะค่าที่ Roboflow ส่งกลับมาจริง)</p></div>
    <div class="row"><button class="btn" id="tr-refresh">${icons.refresh}Refresh Dataset</button><a class="btn" id="tr-open" target="_blank" rel="noopener" href="#">${icons.link}Open Roboflow Project</a></div></header><div id="tr-body"></div>`;
  const body = qs('#tr-body');
  const load = async () => {
    renderState(body, { type: 'loading' });
    let s; let v;
    try {
      // independent requests → in parallel; the dataset result is only used when connected
      const [st, ds] = await Promise.all([
        api.get('/admin/roboflow/status', null, { timeout: 45000 }),
        api.get('/admin/roboflow/datasets', null, { timeout: 45000 }).then((d) => ({ d }), (e) => ({ e })),
      ]);
      s = st;
      if (!s.connected) { renderState(body, { type: 'error', title: 'Not Connected', message: s.reason }); return; }
      if (ds.e) throw ds.e;
      v = ds.d;
    } catch (err) { renderErrorState(body, err, load); return; }
    if (s.project_url) qs('#tr-open').href = s.project_url;
    const trained = v.versions.filter((x) => x.model);
    const last = trained.map((x) => x.model.end ?? x.model.start ?? x.created).filter(Boolean).sort().pop();
    body.innerHTML = `
      <div class="grid grid-4 mb-4">
        <div class="card stat"><span class="stat-label">Dataset Versions</span><span class="stat-value">${v.versions.length}</span></div>
        <div class="card stat"><span class="stat-label">จำนวนภาพ (ล่าสุด)</span><span class="stat-value">${esc(v.versions[0]?.images ?? s.project?.images ?? '-')}</span></div>
        <div class="card stat"><span class="stat-label">จำนวน Classes</span><span class="stat-value">${esc(v.capabilities.classes.length)}</span></div>
        <div class="card stat"><span class="stat-label">Last Training Date</span><span class="stat-value" style="font-size:1.1rem">${trained.length ? fmtTime(last) : 'ยังไม่เคย Train'}</span></div>
      </div>
      <section class="card mb-4"><h2>Dataset Versions & Models</h2>
        ${v.versions.length ? `<div class="table-wrap"><table class="table stack-sm"><thead><tr><th>Version</th><th>ภาพ</th><th>Training Status</th><th>mAP</th><th>Precision</th><th>Recall</th><th>สร้างเมื่อ</th><th></th></tr></thead><tbody>
          ${v.versions.map((x) => `<tr><td data-label="Version">v${esc(x.version)} ${x.is_active ? '<span class="badge badge-primary">Active</span>' : ''}<br><span class="small muted">${esc(x.name ?? '')}</span></td>
            <td data-label="ภาพ">${esc(x.images ?? '-')}</td>
            <td data-label="Status">${x.model ? `<span class="badge badge-success">มีโมเดลที่ฝึกแล้ว</span>${x.model.status ? ` <span class="small">${esc(x.model.status)}</span>` : ''}` : '<span class="badge badge-muted">ยังไม่ได้ Train</span>'}</td>
            <td data-label="mAP">${x.model ? metric(x.model.map) : '-'}</td><td data-label="Precision">${x.model ? metric(x.model.precision) : '-'}</td><td data-label="Recall">${x.model ? metric(x.model.recall) : '-'}</td>
            <td data-label="สร้าง">${fmtTime(x.created)}</td>
            <td class="actions">${x.model ? `<button class="btn btn-sm" data-view="${esc(x.version)}">View Model</button>${x.is_active ? '' : `<button class="btn btn-sm btn-primary" data-active="${esc(x.version)}">Set Active</button>`}` : `<button class="btn btn-sm" data-train="${esc(x.version)}">Start Training</button>`}</td></tr>`).join('')}
        </tbody></table></div>` : '<p class="muted">ยังไม่มี Dataset Version</p>'}
        <p class="small muted mt-3 mb-0">Confusion Matrix: Roboflow API สาธารณะไม่ได้ส่งข้อมูลนี้ — ดูได้ในหน้า Model ของ Roboflow ("View Model")</p>
      </section>
      <section class="card"><h2>Create Dataset Version</h2>
        <p class="text-2">สร้างเวอร์ชันใหม่จากภาพที่ Annotate แล้วใน Roboflow (Preprocessing: auto-orient + resize) การ Train ต้องใช้เครดิตตามแพ็กเกจ Roboflow ของ Workspace</p>
        <div class="row"><label for="tr-size">Resize (px)</label><input class="input" id="tr-size" type="number" min="64" max="2048" value="640" style="width:120px">
          <button class="btn btn-primary" id="tr-gen">${icons.layers}Create Dataset Version</button></div>
        <div id="tr-result" class="mt-3"></div></section>`;

    body.onclick = async (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      const out = qs('#tr-result');
      if (b.dataset.view) {
        try {
          const d = await api.get(`/admin/roboflow/versions/${encodeURIComponent(b.dataset.view)}`);
          const { openModal } = await import('../../components/modal.js');
          openModal({ title: `Model v${b.dataset.view}`, wide: true, content: `<pre class="json">${esc(JSON.stringify(d.version?.model ?? d.version ?? d, null, 2))}</pre>${s.project_url ? `<a class="btn mt-3" target="_blank" rel="noopener" href="${esc(s.project_url)}/${esc(b.dataset.view)}">เปิดใน Roboflow</a>` : ''}` });
        } catch (err) { toast(err.message, 'error'); }
      }
      if (b.dataset.active) {
        setBusy(b, true);
        try { await api.put('/admin/roboflow/active-model', { workspace: v.workspace, project: v.project, version: Number(b.dataset.active) }); toast('ตั้งเป็นโมเดลที่ใช้งานแล้ว', 'success'); load(); } catch (err) { toast(err.message, 'error'); setBusy(b, false); }
      }
      if (b.dataset.train) {
        if (!(await confirmDialog({ title: 'Start Training', message: `เริ่มฝึกโมเดลสำหรับ v${b.dataset.train} บน Roboflow? (ใช้เครดิตการ Train ของ Workspace)`, confirmText: 'เริ่ม Train' }))) return;
        setBusy(b, true);
        try {
          const r = await api.post('/admin/roboflow/train', { version: Number(b.dataset.train) });
          out.innerHTML = `<div class="alert alert-info">${icons.info}<div><strong>Roboflow รับคำขอแล้ว</strong> สถานะจะเปลี่ยนเป็น "มีโมเดลที่ฝึกแล้ว" เมื่อ Roboflow ฝึกเสร็จจริง (กด Refresh เพื่อตรวจสอบ)<pre class="json mt-2">${esc(JSON.stringify(r, null, 2))}</pre></div></div>`;
        } catch (err) {
          out.innerHTML = `<div class="alert alert-danger">${icons.xCircle}<div><strong>ไม่สามารถเริ่ม Train ผ่าน API ได้</strong>${esc(err.message)}<p class="small mb-0">หากแพ็กเกจไม่รองรับการ Train ผ่าน API ให้เริ่ม Train ในหน้าเว็บ Roboflow</p></div></div>`;
        } finally { setBusy(b, false); }
      }
      if (b.id === 'tr-gen') {
        setBusy(b, true);
        try {
          const r = await api.post('/admin/roboflow/generate-version', { resize: Number(qs('#tr-size').value) || 640 }, { timeout: 70000 });
          out.innerHTML = `<div class="alert alert-success">${icons.checkCircle}<div><strong>ส่งคำขอสร้างเวอร์ชันแล้ว</strong><pre class="json mt-2">${esc(JSON.stringify(r, null, 2))}</pre></div></div>`;
        } catch (err) {
          out.innerHTML = `<div class="alert alert-danger">${icons.xCircle}<div>${esc(err.message)}</div></div>`;
        } finally { setBusy(b, false); }
      }
    };
  };
  qs('#tr-refresh').addEventListener('click', load);
  load();
}
