import { api } from './api.js';
import { icons } from './icons.js';
import { qs, qsa, esc, toast, setBusy, renderErrorState, renderState, formatDateTime, formatDate, calcAge, param, debounce, showFieldErrors, clearFieldErrors, formToObject } from './ui.js';
import { requireUser } from './auth.js';
import { AGE_GROUPS, RISK_OPTIONS, SYMPTOMS, EMERGENCY, GENDERS } from './constants.js';
import { getWorkflow, setWorkflow, resetWorkflow, renderStepper } from './workflow.js';

const root = () => qs('#page-root');
let user;
let subject = null; // { type, id?, name, age }

function ageGroupFor(age) {
  if (age === null || age === undefined) return null;
  return age < 40 ? 'under_40' : age < 60 ? '40_59' : '60_plus';
}

export async function init() {
  try { user = await requireUser(); } catch (err) { renderErrorState(root(), err); return; }

  root().innerHTML = `
    <div class="page-head no-print">
      <h1>ซักประวัติผู้เข้ารับการตรวจ</h1>
      <p>${user.account_type === 'staff'
        ? 'บัญชีเจ้าหน้าที่ต้องเลือกผู้เข้ารับการตรวจและซักประวัติใหม่ทุกครั้งที่ตรวจ ข้อมูลจะถูกบันทึกแยกจากข้อมูลบัญชีของคุณ'
        : 'ซักประวัติสุขภาพครั้งแรกเพียงครั้งเดียว และกลับมาแก้ไขได้ตลอด ระบบจะใช้ข้อมูลล่าสุดประกอบการประเมินทุกครั้ง'}</p>
    </div>
    <div id="stepper"></div>
    <div id="mh-content"></div>`;
  renderStepper(qs('#stepper'), 'history');

  if (user.account_type === 'staff') await initStaff();
  else await initPersonal();
}

// ---------------------------------------------------------------------
// Personal account
// ---------------------------------------------------------------------
async function initPersonal() {
  const box = qs('#mh-content');
  subject = { type: 'self', name: user.full_name, age: user.age };
  renderState(box, { type: 'loading', skeleton: 'form', rows: 5 });
  let existing;
  try { existing = await api.get('/medical-history/me'); } catch (err) { renderErrorState(box, err, initPersonal); return; }

  if (existing && param('edit') !== '1') {
    showSummary(box, existing, { editable: true });
    return;
  }
  renderForm(box, existing);
}

// ---------------------------------------------------------------------
// Staff account: pick or add a patient, then a new history every time
// ---------------------------------------------------------------------
async function initStaff() {
  const box = qs('#mh-content');
  const wf = getWorkflow();
  const preselect = param('patient') || (wf.subject?.type === 'patient' ? wf.subject.id : null);
  if (preselect) {
    try {
      const p = await api.get(`/patients/${preselect}`);
      subject = { type: 'patient', id: p.id, name: p.full_name, age: p.current_age };
    } catch { subject = null; }
  }
  renderPatientPicker(box);
}

function renderPatientPicker(box) {
  box.innerHTML = `
    <section class="card mb-4" aria-labelledby="h-subject">
      <div class="card-title"><div class="icon-bubble">${icons.users}</div><h2 id="h-subject">ผู้เข้ารับการตรวจ</h2></div>
      <div id="subject-current"></div>
      <div id="subject-picker">
        <div class="patient-pick">
          <div class="field"><label for="p-search">ค้นหาจากรายชื่อที่บันทึกไว้</label>
            <input class="input" id="p-search" type="search" placeholder="พิมพ์ชื่อ-นามสกุล" autocomplete="off"></div>
          <button class="btn" type="button" id="btn-new-patient">${icons.plus}เพิ่มบุคคลใหม่</button>
        </div>
        <div class="patient-results mt-3" id="p-results" role="listbox" aria-label="ผลการค้นหา"></div>
        <form id="new-patient" class="card card-muted mt-3 hidden" novalidate>
          <h3>เพิ่มผู้เข้ารับการตรวจใหม่</h3>
          <div class="form-grid">
            <div class="field full"><label for="np-name" class="required">ชื่อ-นามสกุล</label><input class="input" id="np-name" name="full_name" required maxlength="150"><span class="field-error" data-error-for="full_name"></span></div>
            <div class="field"><label for="np-birth" class="required">วัน/เดือน/ปีเกิด</label><input class="input" id="np-birth" name="birth_date" type="date" required><span class="field-error" data-error-for="birth_date"></span></div>
            <div class="field"><label for="np-age" class="required">อายุ (ปี)</label><input class="input" id="np-age" name="age" type="number" min="0" max="130" required><span class="hint">คำนวณจากวันเกิดอัตโนมัติ (แก้ไขได้ ±1 ปี)</span><span class="field-error" data-error-for="age"></span></div>
            <div class="field"><label for="np-gender" class="required">เพศ</label><select class="select" id="np-gender" name="gender" required><option value="">-- เลือก --</option>${Object.entries(GENDERS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select><span class="field-error" data-error-for="gender"></span></div>
          </div>
          <div class="row mt-4"><button class="btn btn-primary" type="submit">${icons.save}บันทึกบุคคลใหม่</button><button class="btn" type="button" id="np-cancel">ยกเลิก</button></div>
        </form>
      </div>
    </section>
    <div id="mh-form-area"></div>`;

  const results = qs('#p-results');
  const search = async () => {
    renderState(results, { type: 'loading', message: 'กำลังค้นหา...' });
    try {
      const r = await api.get('/patients', { search: qs('#p-search').value, pageSize: 20 });
      if (!r.items.length) { results.innerHTML = '<p class="muted" style="padding:12px 14px;margin:0">ไม่พบรายชื่อ — กด "เพิ่มบุคคลใหม่"</p>'; return; }
      results.innerHTML = r.items.map((p) => `<button type="button" role="option" data-id="${esc(p.id)}" data-name="${esc(p.full_name)}" data-age="${esc(p.current_age)}">
        <span><strong>${esc(p.full_name)}</strong><br><span class="small muted">อายุ ${esc(p.current_age)} ปี · เกิด ${formatDate(p.birth_date)}</span></span>
        <span class="small muted">${p.latest_screening ? `ตรวจล่าสุด ${formatDate(p.latest_screening.screening_date)}` : 'ยังไม่เคยตรวจ'}</span></button>`).join('');
    } catch (err) { renderErrorState(results, err, search); }
  };
  qs('#p-search').addEventListener('input', debounce(search));
  results.addEventListener('click', (e) => {
    const b = e.target.closest('[data-id]');
    if (!b) return;
    selectSubject({ type: 'patient', id: b.dataset.id, name: b.dataset.name, age: Number(b.dataset.age) });
  });

  const np = qs('#new-patient');
  qs('#btn-new-patient').addEventListener('click', () => { np.classList.remove('hidden'); qs('#np-name').focus(); });
  qs('#np-cancel').addEventListener('click', () => np.classList.add('hidden'));
  qs('#np-birth').max = new Date().toISOString().slice(0, 10);
  qs('#np-birth').addEventListener('change', (e) => { const a = calcAge(e.target.value); if (a !== null) qs('#np-age').value = a; });
  np.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearFieldErrors(np);
    const v = formToObject(np);
    const errs = [];
    if (!v.full_name) errs.push({ field: 'full_name', message: 'กรุณากรอกชื่อ-นามสกุล' });
    if (!v.birth_date) errs.push({ field: 'birth_date', message: 'กรุณาระบุวันเกิด' });
    if (v.age === '') errs.push({ field: 'age', message: 'กรุณากรอกอายุ' });
    if (!v.gender) errs.push({ field: 'gender', message: 'กรุณาเลือกเพศ' });
    if (errs.length) { showFieldErrors(np, errs); return; }
    const btn = qs('button[type="submit"]', np);
    setBusy(btn, true);
    try {
      const p = await api.post('/patients', { ...v, age: Number(v.age) });
      toast('เพิ่มผู้เข้ารับการตรวจแล้ว', 'success');
      np.reset();
      np.classList.add('hidden');
      selectSubject({ type: 'patient', id: p.id, name: p.full_name, age: calcAge(p.birth_date) });
    } catch (err) {
      toast(err.message, 'error');
      if (err.details) showFieldErrors(np, err.details);
    } finally { setBusy(btn, false); }
  });

  search();
  if (subject) selectSubject(subject);
}

function selectSubject(s) {
  subject = s;
  const prev = getWorkflow();
  if (prev.subject?.id !== s.id) resetWorkflow({ subject: s }); // new person → new session
  else setWorkflow({ subject: s });
  qs('#subject-current').innerHTML = `<div class="alert alert-success mb-3">${icons.checkCircle}<div><strong>${esc(s.name)}</strong> อายุ ${esc(s.age)} ปี
    <button type="button" class="btn btn-sm mt-2" id="btn-change-subject">เปลี่ยนผู้เข้ารับการตรวจ</button></div></div>`;
  qs('#subject-picker').classList.add('hidden');
  qs('#btn-change-subject').addEventListener('click', () => {
    qs('#subject-picker').classList.remove('hidden');
    qs('#subject-current').innerHTML = '';
    qs('#mh-form-area').innerHTML = '';
  });
  renderForm(qs('#mh-form-area'), null);
}

// ---------------------------------------------------------------------
// Shared form
// ---------------------------------------------------------------------
function renderForm(box, existing) {
  const h = existing ?? {};
  const suggested = ageGroupFor(subject?.age);
  const ageGroup = h.age_group ?? suggested;
  const sym = new Set(h.eye_symptoms ?? []);
  const anyRisk = RISK_OPTIONS.some((o) => (o.sub ? o.sub.some((s) => h[s.key]) : h[o.key]));

  box.innerHTML = `
    <form id="mh-form" class="card fade-up" novalidate>
      <div class="row-between mb-4">
        <div><span class="source-tag">ผู้เข้ารับการตรวจ</span><div><strong>${esc(subject?.name ?? '')}</strong> ${subject?.age !== null && subject?.age !== undefined ? `· อายุ ${esc(subject.age)} ปี` : ''}</div></div>
        <div style="min-width:220px"><div class="small muted" id="mh-progress-text">ความครบถ้วน 0/3 ส่วน</div><div class="progress" aria-hidden="true"><span id="mh-progress"></span></div></div>
      </div>
      <div id="emergency-alert" aria-live="assertive"></div>

      <fieldset class="fieldset" id="sec1">
        <legend><span class="num">1</span>ช่วงอายุของผู้รับการคัดกรอง <span class="small muted">(เลือก 1 ข้อ)</span></legend>
        <div class="choices">
          ${AGE_GROUPS.map((g) => `<label class="choice"><input type="radio" name="age_group" value="${g.key}" ${ageGroup === g.key ? 'checked' : ''} required>
            <span><span class="choice-title">${g.label}</span><span class="choice-guide">แนวทางประเมิน: ${g.guide}</span></span></label>`).join('')}
        </div>
        <span class="field-error" data-error-for="age_group"></span>
        ${suggested ? `<p class="small muted mt-2">ระบบเลือกให้อัตโนมัติจากอายุ ${esc(subject.age)} ปี</p>` : ''}
      </fieldset>

      <fieldset class="fieldset" id="sec2">
        <legend><span class="num">2</span>ปัจจัยเสี่ยงและประวัติสุขภาพ <span class="small muted">(เลือกได้มากกว่า 1 ข้อ)</span></legend>
        <div class="choices">
          ${RISK_OPTIONS.map((o) => {
            const checked = o.sub ? o.sub.some((s) => h[s.key]) : Boolean(h[o.key]);
            return `<div class="choice" style="display:block">
              <label class="row" style="align-items:flex-start;flex-wrap:nowrap;cursor:pointer"><input type="checkbox" data-risk="${o.key}" ${checked ? 'checked' : ''} style="margin-top:4px;width:20px;height:20px;accent-color:var(--primary)">
                <span><span class="choice-title">${o.label}</span><span class="choice-guide">แนวทางประเมิน: ${o.guide}</span></span></label>
              ${o.sub ? `<div class="sub-choices ${checked ? '' : 'hidden'}" data-sub-for="${o.key}">
                ${o.sub.map((s) => `<label class="check-inline"><input type="checkbox" name="${s.key}" ${h[s.key] ? 'checked' : ''}> ${s.label}</label>`).join('')}
                <span class="field-error" data-error-for="${o.key}"></span></div>` : ''}
            </div>`;
          }).join('')}
          <label class="choice"><input type="checkbox" id="no-risk" ${existing && !anyRisk ? 'checked' : ''}><span><span class="choice-title">ไม่มีปัจจัยเสี่ยงข้างต้น</span></span></label>
        </div>
        <span class="field-error" data-error-for="sec2"></span>
      </fieldset>

      <fieldset class="fieldset" id="sec3">
        <legend><span class="num">3</span>อาการผิดปกติทางดวงตา <span class="small muted">(เลือกได้ทุกข้อที่มีอาการ)</span></legend>
        <div class="choices">
          ${SYMPTOMS.map((s) => `<label class="choice"><input type="checkbox" name="sym" value="${s.key}" ${sym.has(s.key) ? 'checked' : ''}>
            <span><span class="choice-title">${s.label}</span><span class="choice-guide">แนวทางประเมิน: ${s.guide}</span></span></label>`).join('')}
          <label class="choice emergency"><input type="checkbox" name="emergency_symptoms" ${h.emergency_symptoms ? 'checked' : ''}>
            <span><span class="choice-title">${icons.siren.replace('<svg', '<svg width="18" height="18" style="display:inline;vertical-align:-3px;color:var(--danger)"')} ${EMERGENCY.label}</span><span class="choice-guide">แนวทางประเมิน: ${EMERGENCY.guide}</span></span></label>
          <label class="choice"><input type="checkbox" id="no-symptom" ${existing && !sym.size && !h.emergency_symptoms ? 'checked' : ''}><span><span class="choice-title">ไม่มีอาการผิดปกติข้างต้น</span></span></label>
        </div>
        <span class="field-error" data-error-for="sec3"></span>
      </fieldset>

      <div class="row-between">
        <span class="small muted">${existing ? `บันทึกล่าสุด ${formatDateTime(existing.updated_at)}` : 'ข้อมูลจะถูกบันทึกพร้อมวันที่และเวลา'}</span>
        <button class="btn btn-primary btn-lg" type="submit">${icons.save}${existing ? 'บันทึกการแก้ไข' : 'บันทึกประวัติสุขภาพ'}</button>
      </div>
    </form>`;

  const form = qs('#mh-form');
  const emergency = qs('[name="emergency_symptoms"]', form);
  const noRisk = qs('#no-risk', form);
  const noSym = qs('#no-symptom', form);

  const update = () => {
    // sub-choices
    qsa('[data-risk]', form).forEach((cb) => {
      const sub = qs(`[data-sub-for="${cb.dataset.risk}"]`, form);
      if (sub) sub.classList.toggle('hidden', !cb.checked);
      if (cb.checked) noRisk.checked = false;
    });
    if (qsa('[name="sym"]:checked', form).length || emergency.checked) noSym.checked = false;
    // emergency warning shown immediately, independent of AI
    qs('#emergency-alert').innerHTML = emergency.checked ? `<div class="alert alert-urgent mb-4" role="alert">${icons.siren}<div><strong>พบอาการเตือนฉุกเฉิน</strong>
      สงสัยต้อหินเฉียบพลัน กรุณาไปพบจักษุแพทย์หรือห้องฉุกเฉินโดยด่วนที่สุด ไม่ต้องรอผลการตรวจด้วย AI</div></div>` : '';
    // progress
    const s1 = Boolean(qs('[name="age_group"]:checked', form));
    const s2 = noRisk.checked || qsa('[data-risk]:checked', form).length > 0;
    const s3 = noSym.checked || qsa('[name="sym"]:checked', form).length > 0 || emergency.checked;
    const n = [s1, s2, s3].filter(Boolean).length;
    qs('#mh-progress').style.width = `${(n / 3) * 100}%`;
    qs('#mh-progress-text').textContent = `ความครบถ้วน ${n}/3 ส่วน`;
  };
  noRisk.addEventListener('change', () => { if (noRisk.checked) qsa('[data-risk]', form).forEach((c) => { c.checked = false; }); qsa('[data-sub-for] input', form).forEach((c) => { c.checked = false; }); update(); });
  noSym.addEventListener('change', () => { if (noSym.checked) { qsa('[name="sym"]', form).forEach((c) => { c.checked = false; }); emergency.checked = false; } update(); });
  form.addEventListener('change', update);
  update();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearFieldErrors(form);
    const errs = [];
    const ag = qs('[name="age_group"]:checked', form)?.value;
    if (!ag) errs.push({ field: 'age_group', message: 'กรุณาเลือกช่วงอายุ' });
    else if (suggested && ag !== suggested) errs.push({ field: 'age_group', message: `ช่วงอายุไม่ตรงกับอายุ ${subject.age} ปี` });
    const riskChecked = qsa('[data-risk]:checked', form).map((c) => c.dataset.risk);
    if (!riskChecked.length && !noRisk.checked) errs.push({ field: 'sec2', message: 'กรุณาเลือกปัจจัยเสี่ยง หรือเลือก "ไม่มีปัจจัยเสี่ยงข้างต้น"' });
    for (const o of RISK_OPTIONS.filter((x) => x.sub && riskChecked.includes(x.key))) {
      if (!o.sub.some((s) => qs(`[name="${s.key}"]`, form).checked)) errs.push({ field: o.key, message: 'กรุณาระบุรายการย่อยอย่างน้อย 1 ข้อ' });
    }
    const symptoms = qsa('[name="sym"]:checked', form).map((c) => c.value);
    if (!symptoms.length && !emergency.checked && !noSym.checked) errs.push({ field: 'sec3', message: 'กรุณาเลือกอาการ หรือเลือก "ไม่มีอาการผิดปกติข้างต้น"' });
    if (errs.length) {
      for (const er of errs) { const slot = qs(`[data-error-for="${er.field}"]`, form); if (slot) slot.textContent = er.message; }
      qs(`[data-error-for="${errs[0].field}"]`, form)?.closest('fieldset')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }

    const val = (k) => Boolean(qs(`[name="${k}"]`, form)?.checked);
    const payload = {
      ...(subject?.type === 'patient' ? { patient_id: subject.id } : {}),
      age_group: ag,
      family_glaucoma_history: riskChecked.includes('family_glaucoma_history'),
      diabetes: riskChecked.includes('chronic_disease') && val('diabetes'),
      hypertension: riskChecked.includes('chronic_disease') && val('hypertension'),
      steroid_use: riskChecked.includes('steroid_use'),
      outdoor_exposure: riskChecked.includes('outdoor_exposure'),
      high_myopia: riskChecked.includes('myopia_injury') && val('high_myopia'),
      eye_injury: riskChecked.includes('myopia_injury') && val('eye_injury'),
      eye_symptoms: symptoms,
      emergency_symptoms: emergency.checked,
    };
    const btn = qs('button[type="submit"]', form);
    setBusy(btn, true);
    try {
      const saved = existing ? await api.put(`/medical-history/${existing.id}`, payload) : await api.post('/medical-history', payload);
      toast('บันทึกประวัติสุขภาพแล้ว', 'success');
      if (param('edit') === '1' && user.account_type === 'personal') history.replaceState(null, '', location.pathname);
      showSummary(user.account_type === 'staff' ? qs('#mh-form-area') : qs('#mh-content'), saved, { editable: user.account_type === 'personal' });
    } catch (err) {
      toast(err.message, 'error');
      if (err.details) showFieldErrors(form, err.details);
      if (err.code === 'HISTORY_EXISTS') location.reload();
    } finally { setBusy(btn, false); }
  });
}

/** Summary shown before starting the scan */
function showSummary(box, h, { editable }) {
  const s = h.summary ?? {};
  // a finished screening session starts over (keeps the same subject)
  if (getWorkflow().analyzed) resetWorkflow({ subject });
  setWorkflow({ subject, historyId: h.id, historyEmergency: Boolean(h.emergency_symptoms) });
  renderStepper(qs('#stepper'), 'history');
  box.innerHTML = `
    <section class="card fade-up" aria-labelledby="h-sum">
      <div class="card-title"><div class="icon-bubble accent">${icons.clipboard}</div><h2 id="h-sum">สรุปข้อมูลซักประวัติ</h2></div>
      ${s.emergency ? `<div class="alert alert-urgent mb-4" role="alert">${icons.siren}<div><strong>พบอาการเตือนฉุกเฉิน</strong>${esc(s.emergency.guidance)} — กรุณาพบจักษุแพทย์ทันที ไม่ต้องรอผล AI</div></div>` : ''}
      <dl class="kv">
        <dt>ผู้เข้ารับการตรวจ</dt><dd>${esc(subject?.name ?? '')}${subject?.age !== undefined && subject?.age !== null ? ` (อายุ ${esc(subject.age)} ปี)` : ''}</dd>
        <dt>ช่วงอายุ</dt><dd>${esc(s.age_group?.label ?? '-')}<br><span class="small muted">${esc(s.age_group?.guidance ?? '')}</span></dd>
        <dt>ปัจจัยเสี่ยงที่พบ</dt><dd>${s.risk_factors?.length ? `<ul class="mb-0">${s.risk_factors.map((f) => `<li>${esc(f.label)} <span class="small muted">— ${esc(f.guidance)}</span></li>`).join('')}</ul>` : 'ไม่พบ'}</dd>
        <dt>อาการที่พบ</dt><dd>${s.symptoms?.length ? `<ul class="mb-0">${s.symptoms.map((f) => `<li>${esc(f.label)} <span class="small muted">— ${esc(f.guidance)}</span></li>`).join('')}</ul>` : 'ไม่มี'}</dd>
        <dt>บันทึกเมื่อ</dt><dd>${formatDateTime(h.updated_at ?? h.created_at)}</dd>
      </dl>
      <div class="row mt-5">
        <a class="btn btn-primary btn-lg" href="/pages/vision-test.html">ไปขั้นตอนถัดไป: ทดสอบการมองเห็น</a>
        ${editable ? `<a class="btn" href="/pages/medical-history.html?edit=1">${icons.edit}แก้ไขประวัติสุขภาพ</a>` : ''}
      </div>
    </section>`;
}
