import { api } from './api.js';
import { icons } from './icons.js';
import { qs, esc, toast, setBusy, renderErrorState, renderState, formatDateTime } from './ui.js';
import { requireUser } from './auth.js';
import { getWorkflow, setWorkflow, renderStepper, subjectLabel } from './workflow.js';
import {
  getFarDistance, saveFarDistance, pxPerMm, STANDARD_PX_PER_MM, EYE_TH, snellen20, isPinchZoomed,
  screenCalibrationState, saveScreenCalibration, screenFingerprint, screenSnapshot, getDistanceAnchor, saveDistanceAnchor,
} from './vision-tests/common.js';
import { runFaceCheck, startDistanceMonitor } from './vision-tests/face-calibration.js';
import { runBlindSpotCalibration, blindSpotCapacity } from './vision-tests/blind-spot.js';
import { runScreenCalibration } from './vision-tests/screen-calibration.js';
import * as acuity from './vision-tests/acuity.js';
import * as color from './vision-tests/color.js';
import * as amsler from './vision-tests/amsler.js';
import * as field from './vision-tests/field.js';
import * as near from './vision-tests/near.js';
import * as contrast from './vision-tests/contrast.js';

const TESTS = [acuity, color, amsler, field, near, contrast];
const root = () => qs('#page-root');
const results = {}; // key → { right, left }
let standardAccepted = false; // user chose standard mode (no screen calibration) for this visit
let lastDistance = null; // last viewing distance measured before a test
let subjectKey = ''; // the distance anchor belongs to one person (eye spacing differs)
let wf;

const statusText = (r) => {
  if (!r) return '<span class="badge badge-muted">ยังไม่ทดสอบ</span>';
  const part = (e) => (r[e]?.status === 'completed' ? '✓' : r[e]?.status === 'skipped' ? 'ข้าม' : '-');
  return `<span class="badge badge-primary">ขวา ${part('right')} · ซ้าย ${part('left')}</span>`;
};

export async function init() {
  let user;
  try { user = await requireUser(); } catch (err) { renderErrorState(root(), err); return; }
  wf = getWorkflow();
  subjectKey = wf.subject?.type === 'patient' ? `patient:${wf.subject.id}` : `user:${user.id}`;

  root().innerHTML = `
    <div class="page-head"><h1>ทดสอบการมองเห็น</h1>
      <p>ทดสอบตาขวาและตาซ้ายแยกกัน ผลจะถูกนำไปประกอบการประเมินความเสี่ยงร่วมกับผลวิเคราะห์ภาพ</p></div>
    <div id="stepper"></div>
    <div class="alert alert-warning mb-4" role="note">${icons.alert}<div><strong>ข้อควรทราบ</strong>
      การทดสอบผ่านหน้าจอ<u>ไม่ใช่</u>การตรวจสายตามาตรฐานโดยผู้เชี่ยวชาญ ผลขึ้นกับขนาดหน้าจอ ความสว่าง ระยะห่าง และการปรับเทียบ ใช้เพื่อการคัดกรองเบื้องต้นเท่านั้น</div></div>
    <div id="vt-pre"></div>
    <div id="vt-main"></div>`;
  renderStepper(qs('#stepper'), 'vision');

  if (!wf.historyId || (user.account_type === 'staff' && wf.subject?.type !== 'patient')) {
    qs('#vt-pre').innerHTML = `<div class="alert alert-info mb-4">${icons.info}<div><strong>ยังไม่ได้ซักประวัติ</strong> กรุณาซักประวัติผู้เข้ารับการตรวจก่อน เพื่อให้ระบบบันทึกผลทดสอบให้ถูกบุคคล
      <div class="mt-2"><a class="btn btn-primary btn-sm" href="/pages/medical-history.html">ไปที่ซักประวัติ</a></div></div></div>`;
    return;
  }
  qs('#vt-pre').innerHTML = `<p class="mb-4"><span class="source-tag">ผู้เข้ารับการตรวจ</span><br><strong>${esc(subjectLabel(wf))}</strong></p>`;
  renderOverview();
}

function renderOverview() {
  const main = qs('#vt-main');
  const anyDone = Object.keys(results).length > 0;
  main.innerHTML = `
    ${calibrationCard()}
    <section aria-labelledby="h-tests">
      <div class="row-between mb-3"><h2 id="h-tests" class="mb-0">รายการทดสอบ</h2>
        <button class="btn btn-primary" type="button" id="btn-all">${icons.play}ทดสอบทั้งหมดตามลำดับ</button></div>
      <div class="vt-list">
        ${TESTS.map((t, i) => `<article class="card">
          <div class="vt-item"><div class="icon-bubble">${i + 1}</div><div><h3 class="mb-0">${t.meta.title}</h3><p class="small text-2 mb-0">${t.meta.description}</p></div></div>
          <div class="row-between mt-3">${statusText(results[t.meta.key])}<button class="btn btn-sm" data-run="${t.meta.key}">${results[t.meta.key] ? 'ทดสอบใหม่' : 'เริ่ม'}</button></div>
        </article>`).join('')}
        <article class="card card-muted"><div class="vt-item"><div class="icon-bubble accent">${icons.eye}</div><div><h3 class="mb-0">ทดสอบตาซ้ายและตาขวาแยกกัน</h3>
          <p class="small text-2 mb-0">ทุกการทดสอบจะทำกับตาขวาก่อนแล้วจึงตาซ้าย และบันทึกผลแยกกัน</p></div></div></article>
      </div>
    </section>
    <section class="card mt-5" id="vt-summary-box" aria-labelledby="h-vsum">
      <h2 id="h-vsum">บันทึกผลและไปขั้นตอนถัดไป</h2>
      <p class="text-2">${anyDone ? 'บันทึกผลการทดสอบที่ทำแล้ว (การทดสอบที่ไม่ได้ทำจะถูกบันทึกว่า "ไม่ได้ทดสอบ")' : 'ยังไม่ได้ทดสอบ คุณสามารถข้ามขั้นตอนนี้ได้ แต่ระบบจะประเมินความเสี่ยงได้ไม่ครบถ้วน'}</p>
      <div class="row">
        <button class="btn btn-primary btn-lg" type="button" id="btn-save" ${anyDone ? '' : 'disabled'}>${icons.save}บันทึกผลการทดสอบ</button>
        <button class="btn" type="button" id="btn-skip">ข้ามการทดสอบการมองเห็น</button>
      </div>
    </section>
    <section class="mt-5" aria-labelledby="h-past"><h2 id="h-past">ผลการทดสอบย้อนหลัง</h2><div id="vt-past"></div></section>`;

  qs('#btn-cal-screen').addEventListener('click', async () => { await calibrateScreen(); renderOverview(); });
  qs('#btn-cal-face').addEventListener('click', async () => { await calibrateFace(); renderOverview(); });
  qs('#btn-cal-all').addEventListener('click', async () => { if (await calibrateScreen()) await calibrateFace(); renderOverview(); });
  watchZoom();
  qs('#far-dist').addEventListener('change', (e) => {
    const d = Math.round(Number(e.target.value));
    if (!(d >= 50 && d <= 600)) { toast('ระยะห่างต้องอยู่ระหว่าง 50–600 ซม.', 'warning'); e.target.value = getFarDistance(); return; }
    saveFarDistance(d);
    toast('บันทึกระยะทดสอบสายตาระยะไกลแล้ว', 'success', 2000);
  });
  qs('#btn-all').addEventListener('click', async () => {
    for (const t of TESTS) { const ok = await runTest(t); if (!ok) break; }
    renderOverview();
  });
  // assigned (not added) so re-rendering never stacks duplicate handlers
  main.onclick = async (e) => {
    const key = e.target.closest('[data-run]')?.dataset.run;
    if (!key) return;
    await runTest(TESTS.find((t) => t.meta.key === key));
    renderOverview();
  };
  qs('#btn-save').addEventListener('click', save);
  qs('#btn-skip').addEventListener('click', () => { setWorkflow({ visionSkipped: true, visionTestId: null }); location.href = '/pages/scan.html'; });
  loadPast();
}

/** Browser zoom or moving the window to another display changes DPR: the calibration no longer applies. */
let zoomMql = null;
let zoomListening = false;
function watchZoom() {
  // desktop zoom also resizes the CSS viewport; the media query covers moving to another display
  if (!zoomListening) { window.addEventListener('resize', debounceZoom); zoomListening = true; }
  zoomMql?.removeEventListener('change', onZoom);
  zoomMql = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
  zoomMql.addEventListener('change', onZoom);
}
let lastDpr = window.devicePixelRatio;
let zoomTimer = 0;
function debounceZoom() {
  clearTimeout(zoomTimer);
  zoomTimer = setTimeout(() => { if (window.devicePixelRatio !== lastDpr) onZoom(); }, 250);
}
function onZoom() {
  lastDpr = window.devicePixelRatio;
  watchZoom();
  if (!qs('[data-cal-overall]')) return; // a test or calibration is running: re-checked before the next test
  if (screenCalibrationState().status === 'stale') toast('ระดับการซูมหรือหน้าจอเปลี่ยนไป กรุณาปรับเทียบขนาดหน้าจอใหม่', 'warning', 6000);
  renderOverview();
}

async function loadPast() {
  const box = qs('#vt-past');
  renderState(box, { type: 'loading' });
  try {
    const rows = await api.get('/vision-tests', wf.subject?.type === 'patient' ? { patient_id: wf.subject.id } : null);
    if (!rows.length) { renderState(box, { type: 'empty', message: 'ยังไม่มีผลการทดสอบที่บันทึกไว้' }); return; }
    box.innerHTML = `<div class="table-wrap"><table class="table stack-sm"><thead><tr><th>วันที่และเวลา</th><th>จำนวนการทดสอบ</th><th>ผลที่เกินเกณฑ์คัดกรอง</th></tr></thead><tbody>
      ${rows.slice(0, 10).map((r) => `<tr><td data-label="วันที่">${formatDateTime(r.created_at)}</td><td data-label="จำนวน">${esc(r.summary?.tested_count ?? 0)} รายการ</td>
        <td data-label="เกินเกณฑ์">${r.summary?.abnormal_tests?.length ? r.summary.abnormal_tests.map((k) => `<span class="badge badge-warning">${esc(TESTS.find((t) => t.meta.key === k)?.meta.title.split(' (')[0] ?? k)}</span>`).join(' ') : '<span class="badge badge-success">ไม่พบ</span>'}</td></tr>`).join('')}
      </tbody></table></div>`;
  } catch (err) { renderErrorState(box, err, loadPast); }
}

// ---------------- calibration: screen size (px/mm) + face distance ----------------
// Tests whose stimulus size depends on the physical screen size
const SIZE_TESTS = new Set(['visual_acuity', 'near_vision', 'central_visual_field', 'contrast_sensitivity']);
// Viewing distance (cm) each test is designed for; the measured distance is used for sizing
const DISTANCE_TARGET = { visual_acuity: () => getFarDistance(), near_vision: () => near.distanceCm, central_visual_field: () => 30, visual_field: () => 40, contrast_sensitivity: () => 100 };
const DISTANCE_RANGE = { visual_acuity: [50, 300], near_vision: [30, 50], central_visual_field: [25, 40], visual_field: [30, 50], contrast_sensitivity: [50, 200] };
const MANUAL_RANGE = { visual_acuity: [30, 600], near_vision: [20, 100], central_visual_field: [20, 100], visual_field: [20, 100], contrast_sensitivity: [30, 600] };
const fmtDT = (t) => formatDateTime(new Date(t).toISOString());
const n1 = (v) => Number(v).toLocaleString('th-TH', { maximumFractionDigits: 1 });

function calibrationCard() {
  const sc = screenCalibrationState();
  const anchor = getDistanceAnchor(subjectKey);
  const screenOk = sc.status === 'ok';
  const overall = screenOk
    ? { tone: 'is-ok', icon: icons.checkCircle, text: 'ปรับเทียบขนาดหน้าจอสำเร็จ สามารถใช้ขนาดตัวอักษรที่คำนวณจากขนาดจริงได้' }
    : anchor
      ? { tone: 'is-warn', icon: icons.alert, text: 'ตรวจจับใบหน้าและระยะห่างสำเร็จ แต่ยังไม่ได้ปรับเทียบขนาดหน้าจอ' }
      : { tone: '', icon: icons.info, text: 'ยังไม่ได้ปรับเทียบขนาดหน้าจอ' };
  const r = sc.record;
  return `
    <section class="card mb-4" aria-labelledby="h-cal">
      <div class="card-title"><div class="icon-bubble">${icons.settings}</div><h2 id="h-cal">ปรับเทียบระยะด้วยใบหน้าและขนาดหน้าจอ</h2></div>
      <div class="fc-status ${overall.tone}" data-cal-overall>${overall.icon}<div><strong>${overall.text}</strong>
        <span class="small text-2">${screenOk ? `ขนาดตัวอักษรคำนวณจาก ${n1(r.pxPerMm)} px/มม. ที่วัดได้จริง` : sc.status === 'stale' ? `${sc.reason} กรุณาปรับเทียบขนาดหน้าจอใหม่ · ขณะนี้ใช้โหมดมาตรฐาน` : 'ขณะนี้ใช้โหมดมาตรฐาน: ขนาดตัวอักษรใช้ค่าพิกเซลมาตรฐานของเบราว์เซอร์ ไม่ได้อ้างอิงขนาดจริงของหน้าจอ'}</span></div></div>
      <div class="cal-grid mt-4">
        <div class="cal-panel">
          <h3>${icons.layers}ขนาดหน้าจอ</h3>
          ${screenOk ? '<span class="badge badge-success">ปรับเทียบแล้ว</span>' : sc.status === 'stale' ? '<span class="badge badge-warning">ต้องปรับเทียบใหม่</span>' : '<span class="badge badge-muted">ยังไม่ได้ปรับเทียบ</span>'}
          <dl class="kv mt-3">
            <dt>px/มม.</dt><dd>${screenOk ? `<strong>${r.pxPerMm.toFixed(3)}</strong>` : `${STANDARD_PX_PER_MM.toFixed(3)} <span class="small muted">(ค่ามาตรฐาน ไม่ใช่ค่าที่วัด)</span>`}</dd>
            ${r ? `<dt>วิธีอ้างอิง</dt><dd>${r.method === 'card' ? 'บัตร ID-1 (ค่าที่ปรับเทียบไว้เดิม ยังใช้ได้)' : `ไม้บรรทัด ${r.reference.mm} มม.`}${r.verified ? ' · ตรวจด้วยไม้บรรทัดแล้ว' : ''}</dd>
            <dt>ขนาดจอ</dt><dd>${n1(r.screenMm.w / 10)} × ${n1(r.screenMm.h / 10)} ซม.</dd>
            <dt>ปรับเทียบเมื่อ</dt><dd>${fmtDT(r.at)}</dd>` : ''}
            <dt>ความละเอียด / DPR</dt><dd>${screen.width} × ${screen.height} px · DPR ${screenFingerprint().dpr}</dd>
          </dl>
          <button class="btn btn-sm mt-3 ${screenOk ? '' : 'btn-primary'}" type="button" id="btn-cal-screen">${screenOk ? 'ปรับเทียบใหม่' : 'ปรับเทียบขนาดหน้าจอ'}</button>
        </div>
        <div class="cal-panel">
          <h3>${icons.camera}ระยะดวงตาถึงหน้าจอ</h3>
          ${anchor ? '<span class="badge badge-success">ปรับเทียบแล้ว</span>' : '<span class="badge badge-muted">ยังไม่ได้ปรับเทียบ</span>'}
          <dl class="kv mt-3">
            ${anchor ? `<dt>ค่าอ้างอิง</dt><dd>${n1(anchor.anchorCm)} ซม. (${anchor.method === 'blind_spot' ? 'วัดด้วยจุดบอดของตา' : 'วัดด้วยตลับเมตร'})</dd><dt>กล้อง</dt><dd>${anchor.camera === 'front' ? 'กล้องหน้า/เว็บแคม' : 'กล้องหลัง'} ${anchor.video.w}×${anchor.video.h}</dd><dt>ปรับเทียบเมื่อ</dt><dd>${fmtDT(anchor.at)}</dd>` : '<dt>สถานะ</dt><dd>ระบบยังวัดระยะเป็นเซนติเมตรไม่ได้ จนกว่าจะปรับเทียบด้วยระยะที่วัดจริง 1 ครั้ง</dd>'}
            <dt>ระยะที่วัดล่าสุด</dt><dd>${lastDistance ? `${n1(lastDistance.distanceCm)} ซม. (${lastDistance.source === 'camera' ? 'วัดจากกล้อง' : 'ระบุจากตลับเมตร'}) · ${esc(lastDistance.test)}` : '-'}</dd>
          </dl>
          <button class="btn btn-sm mt-3 ${anchor ? '' : 'btn-primary'}" type="button" id="btn-cal-face">${anchor ? 'ปรับเทียบใหม่' : 'ปรับเทียบระยะใบหน้า'}</button>
        </div>
      </div>
      <div class="form-grid mt-4">
        <div class="field"><label for="far-dist">ระยะทดสอบสายตาระยะไกล (ซม.)</label>
          <input class="input" id="far-dist" type="number" min="50" max="600" step="1" inputmode="numeric" value="${getFarDistance()}">
          <span class="hint">ระยะเป้าหมายของแบบทดสอบความคมชัด แนะนำ 100–300 ซม. ระบบจะวัดระยะจริงก่อนเริ่มและคำนวณขนาดตัว E จากระยะที่วัดได้</span></div>
      </div>
      <div class="row mt-3"><button class="btn btn-primary" type="button" id="btn-cal-all">${icons.refresh}${screenOk && anchor ? 'เริ่มปรับเทียบใหม่ทั้งหมด' : 'เริ่มปรับเทียบ'}</button></div>
    </section>`;
}

/** Generic in-page choice screen. Resolves the id of the clicked button. */
function choice(title, body, buttons) {
  const main = qs('#vt-main');
  main.onclick = null;
  main.innerHTML = `<section class="card" aria-labelledby="h-choice"><h2 id="h-choice">${title}</h2>${body}
    <div class="row mt-4">${buttons.map((b) => `<button class="btn ${b.primary ? 'btn-primary' : b.ghost ? 'btn-ghost' : ''}" type="button" data-choice="${b.id}" ${b.disabled ? 'disabled' : ''}>${b.label}</button>`).join('')}</div></section>`;
  main.querySelector('section').scrollIntoView({ block: 'start' });
  return new Promise((resolve) => {
    main.onclick = (e) => { const id = e.target.closest('[data-choice]')?.dataset.choice; if (id) { main.onclick = null; resolve(id); } };
  });
}

async function calibrateScreen() {
  qs('#vt-main').onclick = null;
  const r = await runScreenCalibration(qs('#vt-main'));
  if (r.status !== 'done') return false;
  saveScreenCalibration(r.record);
  standardAccepted = false;
  toast('บันทึกการปรับเทียบขนาดหน้าจอแล้ว', 'success');
  return true;
}

/**
 * Anchor of the face-distance estimate (per subject): the face size in the camera image at one
 * distance known from a physical method — a tape measure, or the blind-spot method (needs the
 * ruler-calibrated screen). Never from an assumed camera focal length.
 */
async function calibrateFace() {
  const main = qs('#vt-main');
  for (;;) {
    const sc = screenCalibrationState();
    const cap = sc.status === 'ok' ? blindSpotCapacity(sc.record.pxPerMm) : null;
    const blindNote = sc.status !== 'ok'
      ? 'ต้องปรับเทียบขนาดหน้าจอด้วยไม้บรรทัดก่อน'
      : cap.ok ? 'ใช้เวลาประมาณ 1 นาที ไม่ต้องใช้อุปกรณ์เพิ่ม' : 'หน้าจอแคบเกินไป (ใช้แนวนอน หน้าจอใหญ่ขึ้น หรือใช้ตลับเมตร)';
    const method = await choice('ปรับเทียบระยะด้วยใบหน้า', `
      <p class="text-2">กล้องรู้แค่ "ขนาดใบหน้าในภาพ" แต่ไม่รู้ระยะจริง ระบบจึงต้องรู้ระยะจริง 1 ครั้งขณะที่กล้องบันทึกใบหน้า
        หลังจากนั้นจะวัดระยะดวงตาถึงหน้าจอเป็นเซนติเมตรได้แบบ Real-time (ทำ 1 ครั้งต่อผู้เข้ารับการตรวจ เพราะระยะห่างระหว่างดวงตาของแต่ละคนไม่เท่ากัน)</p>
      <ul class="mb-0"><li><strong>วัดด้วยจุดบอดของตา</strong>: ${blindNote}</li>
        <li><strong>วัดด้วยตลับเมตร</strong>: แม่นยำที่สุด ใช้ได้กับทุกอุปกรณ์</li></ul>`,
    [{ id: 'blind', label: 'วัดด้วยจุดบอดของตา', primary: Boolean(cap?.ok), disabled: !cap?.ok }, { id: 'tape', label: 'วัดด้วยตลับเมตร', primary: !cap?.ok }, { id: 'cancel', label: 'ยกเลิก', ghost: true }]);
    if (method === 'cancel') return false;
    main.onclick = null;
    let rec;
    if (method === 'blind') {
      const r = await runBlindSpotCalibration(main, { pxPerMm: sc.record.pxPerMm });
      if (r.status !== 'done') return false;
      rec = r.record;
    } else {
      rec = await tapeAnchor(main);
      if (!rec) return false;
    }
    rec = { ...rec, subject: subjectKey, at: Date.now() };
    const stable = rec.ipdCv <= 0.04 && (rec.trialCv ?? 0) <= 0.1;
    const pick = await choice('ผลการปรับเทียบระยะด้วยใบหน้า', `
      <dl class="kv"><dt>วิธี</dt><dd>${rec.method === 'blind_spot' ? `จุดบอดของตา (${rec.trialsCm.length} ครั้ง: ${rec.trialsCm.join(', ')} ซม.)` : 'ตลับเมตร'}</dd>
      <dt>ระยะอ้างอิง</dt><dd>${n1(rec.anchorCm)} ซม.</dd>
      <dt>ความนิ่งของค่าที่วัด</dt><dd>${stable ? '<span class="badge badge-success">ดี</span>' : '<span class="badge badge-warning">ไม่นิ่ง</span>'} (ใบหน้าผันแปร ${n1(rec.ipdCv * 100)}%${rec.trialCv != null ? `, ระยะผันแปร ${n1(rec.trialCv * 100)}%` : ''})</dd>
      <dt>กล้อง</dt><dd>${rec.camera === 'front' ? 'กล้องหน้า/เว็บแคม' : 'กล้องหลัง'} ${rec.video.w}×${rec.video.h}</dd></dl>
      ${stable ? '' : '<p class="small text-2 mt-3">ค่าที่วัดได้ยังไม่นิ่ง แนะนำให้ทำใหม่โดยวางอุปกรณ์และนั่งให้นิ่งกว่าเดิม</p>'}`,
    [{ id: 'save', label: `${icons.save}บันทึกการปรับเทียบ`, primary: true }, { id: 'redo', label: 'ทำใหม่' }, { id: 'cancel', label: 'ยกเลิก', ghost: true }]);
    if (pick === 'redo') continue;
    if (pick !== 'save') return false;
    saveDistanceAnchor(rec);
    toast('บันทึกการปรับเทียบระยะด้วยใบหน้าแล้ว', 'success');
    return true;
  }
}

/** Tape-measure anchor: the user enters the measured distance, then holds still in the oval. */
async function tapeAnchor(main) {
  for (;;) {
    main.onclick = null;
    main.innerHTML = `<section class="card" aria-labelledby="h-anc">
      <div class="card-title"><div class="icon-bubble">${icons.camera}</div><h2 id="h-anc">ปรับเทียบระยะด้วยตลับเมตร</h2></div>
      <ol><li>วางอุปกรณ์ให้นิ่ง (ตั้งบนโต๊ะหรือขาตั้ง)</li><li>วัดระยะจาก<strong>หัวตา</strong>ถึง<strong>หน้าจอ</strong> แนะนำ 40–60 ซม. หากจะทดสอบสายตาระยะไกล ให้วัดที่ระยะใกล้เคียงระยะทดสอบ (เช่น 100–200 ซม.) จะแม่นยำกว่า เพราะความคลาดเคลื่อนเพิ่มขึ้นเมื่อระยะทดสอบห่างจากระยะอ้างอิงมาก</li><li>กรอกระยะที่วัดได้ แล้วนั่งนิ่งที่ระยะนั้นมองตรงไปที่กล้องจนระบบบันทึกเสร็จ</li></ol>
      <div class="field" style="max-width:280px"><label for="anc-cm">ระยะที่วัดได้ (ซม.)</label>
        <input class="input" id="anc-cm" type="number" min="25" max="200" step="0.5" inputmode="decimal" value="50"></div>
      <div class="row mt-4"><button class="btn btn-primary" type="button" data-a="go">${icons.camera}เริ่มตรวจจับใบหน้า</button><button class="btn" type="button" data-a="cancel">ยกเลิก</button></div>
    </section>`;
    main.querySelector('section').scrollIntoView({ block: 'start' });
    const act = await new Promise((resolve) => { main.onclick = (e) => { const x = e.target.closest('[data-a]')?.dataset.a; if (x) resolve(x); }; });
    if (act === 'cancel') return null;
    const cm = Number(qs('#anc-cm').value);
    if (!(cm >= 25 && cm <= 200)) { toast('ระยะต้องอยู่ระหว่าง 25–200 ซม.', 'warning'); continue; }
    main.onclick = null;
    const r = await runFaceCheck(main, { mode: 'anchor', anchorCm: cm, title: `บันทึกค่าอ้างอิงที่ระยะ ${cm} ซม.`, intro: `นั่งนิ่งที่ระยะ ${cm} ซม. ที่วัดไว้ มองตรงไปที่กล้อง และให้ใบหน้าอยู่ในกรอบวงรี` });
    return r.status === 'done' ? { ...r.record, method: 'tape' } : null;
  }
}

async function manualDistance(test, target) {
  const [min, max] = MANUAL_RANGE[test.meta.key];
  for (;;) {
    const pick = await choice(`ระบุระยะที่วัดได้: ${test.meta.title.split(' (')[0]}`, `
      <p class="text-2">ใช้ตลับเมตรหรือไม้บรรทัดวัดระยะจากหัวตาถึงหน้าจอ (ระยะเป้าหมาย ${target} ซม.) แล้วกรอกค่าที่วัดได้จริง ระบบจะคำนวณขนาดตัวอักษรจากค่านี้</p>
      <div class="field" style="max-width:280px"><label for="man-cm">ระยะที่วัดได้ (ซม.)</label>
        <input class="input" id="man-cm" type="number" min="${min}" max="${max}" step="0.5" inputmode="decimal" value="${target}"></div>`,
    [{ id: 'ok', label: 'ยืนยันระยะ', primary: true }, { id: 'cancel', label: 'ยกเลิก' }]);
    if (pick !== 'ok') return null;
    const cm = Number(qs('#man-cm').value);
    if (cm >= min && cm <= max) return cm;
    toast(`ระยะต้องอยู่ระหว่าง ${min}–${max} ซม.`, 'warning');
  }
}

/**
 * Before a test: screen size calibrated (or standard mode accepted) and the viewing
 * distance measured by the camera (or a tape-measured value). Returns the context or null.
 */
async function prepare(test) {
  const key = test.meta.key;
  if (SIZE_TESTS.has(key)) {
    if (isPinchZoomed()) { await choice('หน้าจอถูกซูมอยู่', '<p>กรุณาซูมหน้าจอกลับเป็นขนาดปกติก่อนเริ่มทดสอบ ขนาดตัวอักษรจะไม่ถูกต้องขณะซูม</p>', [{ id: 'ok', label: 'ตกลง', primary: true }]); return null; }
    const sc = screenCalibrationState();
    if (sc.status !== 'ok' && !standardAccepted) {
      const pick = await choice(sc.status === 'stale' ? 'ต้องปรับเทียบขนาดหน้าจอใหม่' : 'ยังไม่ได้ปรับเทียบขนาดหน้าจอ',
        `<p class="text-2">${sc.status === 'stale' ? `${sc.reason} ค่าเดิมจึงใช้ไม่ได้` : 'ขนาดตัวอักษรที่ถูกต้องตามมุมมองต้องใช้ขนาดจริงของหน้าจอ'} ใช้ไม้บรรทัดปรับเทียบ ใช้เวลาประมาณ 1 นาที</p>
         <p class="small muted">หากเลือกโหมดมาตรฐาน ขนาดตัวอักษรจะใช้ค่าพิกเซลมาตรฐานของเบราว์เซอร์ และผลจะถูกบันทึกว่า "ไม่ได้ปรับเทียบขนาดหน้าจอ"</p>`,
        [{ id: 'cal', label: 'ปรับเทียบขนาดหน้าจอ', primary: true }, { id: 'std', label: 'ใช้โหมดมาตรฐาน' }, { id: 'cancel', label: 'ยกเลิก', ghost: true }]);
      if (pick === 'cancel') return null;
      if (pick === 'cal' && !(await calibrateScreen())) return null;
      if (pick === 'std') standardAccepted = true;
    }
  }
  const targetFn = DISTANCE_TARGET[key];
  if (!targetFn) return { distanceCm: null, source: null };
  const target = targetFn();
  for (;;) {
    const anchor = getDistanceAnchor(subjectKey);
    if (!anchor) {
      const pick = await choice('ต้องวัดระยะดวงตาถึงหน้าจอ', `<p class="text-2">แบบทดสอบนี้ออกแบบสำหรับระยะ ${target} ซม. ปรับเทียบระยะด้วยใบหน้า 1 ครั้งเพื่อให้กล้องวัดระยะได้ หรือวัดด้วยตลับเมตรแล้วกรอกเอง</p>`,
        [{ id: 'anchor', label: 'ปรับเทียบระยะด้วยใบหน้า', primary: true }, { id: 'manual', label: 'ใช้ระยะที่วัดด้วยตลับเมตร' }, { id: 'cancel', label: 'ยกเลิก', ghost: true }]);
      if (pick === 'cancel') return null;
      if (pick === 'anchor') { if (!(await calibrateFace())) return null; continue; }
      const cm = await manualDistance(test, target);
      return cm ? { distanceCm: cm, source: 'manual', target } : null;
    }
    const main = qs('#vt-main');
    main.onclick = null;
    const r = await runFaceCheck(main, {
      mode: 'distance', anchor, targetCm: target, range: DISTANCE_RANGE[key], allowManual: true,
      title: `วัดระยะก่อนเริ่ม: ${test.meta.title.split(' (')[0]}`,
      intro: `นั่งให้ดวงตาห่างจากหน้าจอประมาณ ${target} ซม. ระบบจะวัดระยะจากกล้องและบอกให้ขยับเข้าหรือถอยออก หรือกด "ยืนยันระยะทดสอบ" เพื่อใช้ระยะปัจจุบัน แล้วระบบจะคำนวณขนาดตัวอักษรจากระยะนั้น${target / anchor.anchorCm >= 2.5 ? ` <strong>หมายเหตุ:</strong> ระยะนี้ห่างจากระยะที่ปรับเทียบไว้ (${Math.round(anchor.anchorCm)} ซม.) มาก ความคลาดเคลื่อนอาจถึงประมาณ 10% แนะนำปรับเทียบระยะด้วยตลับเมตรที่ระยะใกล้เคียงระยะทดสอบ` : ''}`,
    });
    if (r.status === 'done') return { distanceCm: r.record.distanceCm, sdCm: r.record.sdCm, source: 'camera', target, anchorCm: anchor.anchorCm, anchorMethod: anchor.method ?? 'tape', confirmed: Boolean(r.record.confirmed), anchor };
    if (r.status === 'cancel') return null;
    const cm = await manualDistance(test, target); // 'manual' / 'skip': the camera cannot measure here
    return cm ? { distanceCm: cm, source: 'manual', target } : null;
  }
}

/** Calibration data stored with a result (screen and distance kept separate). */
function calibrationExtra(test, ctx) {
  const sizes = test === acuity ? acuity.levelSizes(ctx.distanceCm) : near.levelSizes(ctx.distanceCm);
  const r1 = (v, d = 1) => Math.round(v * 10 ** d) / 10 ** d;
  return {
    screen: screenSnapshot(),
    distance: {
      source: ctx.source, distance_cm: r1(ctx.distanceCm), target_cm: ctx.target, anchor_cm: ctx.anchorCm ?? null, sd_cm: ctx.sdCm ?? null,
      anchor_method: ctx.anchorMethod ?? null, user_confirmed: Boolean(ctx.confirmed), monitor: ctx.monitorStats ?? null,
    },
    optotypes: sizes.map((s) => ({ logmar: s.logmar, snellen: snellen20(s.logmar), height_mm: r1(s.mm ?? s.targetMm, 3), height_px: r1(s.devicePx / (devicePixelRatio || 1), 2) })),
  };
}

// ---------------- distance monitor during a test ----------------
/** Keeps the camera on during the test and warns when the viewing distance changes. */
async function startMonitor(ctx) {
  if (ctx.source !== 'camera' || !ctx.anchor) return null;
  const badge = document.createElement('div');
  badge.className = 'dist-monitor';
  badge.innerHTML = '<span class="dm-dot" aria-hidden="true"></span><span class="dm-val" aria-hidden="true">–</span><span class="dm-msg" role="status" aria-live="polite"></span>';
  document.body.append(badge);
  const val = badge.querySelector('.dm-val');
  const msg = badge.querySelector('.dm-msg');
  let last = '';
  const target = Math.round(ctx.distanceCm);
  const TEXT = {
    ok: '',
    far: `ไกลกว่าระยะที่ยืนยันไว้ (${target} ซม.) กรุณาขยับเข้ามาใกล้อีกนิด`,
    close: `ใกล้กว่าระยะที่ยืนยันไว้ (${target} ซม.) กรุณาถอยห่างออกไป`,
    noface: 'ตรวจไม่พบใบหน้า',
    multi: 'พบมากกว่าหนึ่งใบหน้า',
  };
  let mon;
  try {
    mon = await startDistanceMonitor({
      anchor: ctx.anchor,
      lockedCm: ctx.distanceCm,
      onUpdate: ({ status, est }) => {
        if (est != null) val.textContent = `≈ ${Math.round(est)} ซม.`;
        badge.dataset.status = status;
        if (status !== last) { msg.textContent = TEXT[status] ?? ''; last = status; }
      },
    });
  } catch (err) {
    badge.dataset.status = 'off';
    val.textContent = 'ไม่ได้ติดตามระยะ';
    setTimeout(() => badge.remove(), 4000);
    return { stop: () => ({ samples: 0, valid: 0, max_dev_pct: null, warnings: 0, out_of_range_s: 0, error: err?.name ?? 'error' }) };
  }
  return { stop: () => { const st = mon.stats(); mon.stop(); badge.remove(); return st; } };
}

// ---------------- run a test (right then left) ----------------
async function runTest(test) {
  const ctx = await prepare(test);
  if (!ctx) return false;
  if (ctx.distanceCm) lastDistance = { distanceCm: ctx.distanceCm, source: ctx.source, test: test.meta.title.split(' (')[0] };
  const screenOk = screenCalibrationState().status === 'ok';
  const main = qs('#vt-main');
  main.onclick = null;
  const res = {};
  const monitor = await startMonitor(ctx);
  const sizeNote = ctx.distanceCm
    ? `<p class="small text-2 mb-0">ระยะที่วัดได้ <strong>${n1(ctx.distanceCm)} ซม.</strong> (${ctx.source === 'camera' ? 'วัดจากกล้อง' : 'ระบุจากตลับเมตร'}) · ${SIZE_TESTS.has(test.meta.key) ? (screenOk ? `ขนาดภาพคำนวณจากขนาดจริงของหน้าจอ (${n1(pxPerMm())} px/มม.) · ` : 'โหมดมาตรฐาน: ไม่ได้ปรับเทียบขนาดหน้าจอ · ') : ''}กรุณาอยู่ที่ระยะนี้ตลอดการทดสอบ</p>`
    : '';
  try {
  for (const eye of ['right', 'left']) {
    main.innerHTML = `
      <section class="card" aria-live="polite">
        <div class="row-between mb-3"><h2 class="mb-0">${test.meta.title}</h2><button class="btn btn-ghost" data-abort>ออกจากการทดสอบ</button></div>
        <div class="alert alert-info mb-4">${icons.info}<div><strong>คำแนะนำก่อนเริ่ม (${EYE_TH[eye]})</strong><ul class="mb-0">${test.meta.instructions.map((s) => `<li>${s}</li>`).join('')}</ul></div></div>
        <div class="vt-stage" id="vt-stage">
          <span class="vt-eye-banner">${icons.eye.replace('<svg', '<svg width="18" height="18"')} ทดสอบ${EYE_TH[eye]}</span>
          ${sizeNote}
          <p>กรุณาปิด${eye === 'right' ? 'ตาซ้าย' : 'ตาขวา'}ด้วยฝ่ามือ แล้วกดเริ่ม</p>
          <div class="row" style="justify-content:center"><button class="btn btn-primary btn-lg" data-go>เริ่มทดสอบ${EYE_TH[eye]}</button><button class="btn" data-skip-eye>ข้าม${EYE_TH[eye]}</button></div>
        </div>
      </section>`;
    main.querySelector('section').scrollIntoView({ block: 'start' });
    const stage = qs('#vt-stage');
    const action = await new Promise((resolve) => {
      main.addEventListener('click', function h(e) {
        const t = e.target.closest('[data-go],[data-skip-eye],[data-abort]');
        if (!t) return;
        main.removeEventListener('click', h);
        resolve(t.hasAttribute('data-go') ? 'go' : t.hasAttribute('data-skip-eye') ? 'skip' : 'abort');
      });
    });
    if (action === 'abort') return false;
    if (action === 'skip') { res[eye] = { status: 'skipped' }; continue; }
    const abortP = new Promise((resolve) => main.querySelector('[data-abort]').addEventListener('click', () => resolve('abort'), { once: true }));
    const r = await Promise.race([test.run(stage, { eye, distanceCm: ctx.distanceCm ?? undefined }), abortP]);
    if (r === 'abort') return false;
    res[eye] = r;
  }
  } finally {
    ctx.monitorStats = monitor?.stop() ?? null;
  }
  const extra = {};
  if (test === acuity || test === near) {
    Object.assign(extra, {
      distance_cm: Math.round(ctx.distanceCm * 10) / 10,
      calibrated: screenOk, // true only when px/mm comes from a physical reference
      ...(test === acuity ? { px_per_mm: Math.round(pxPerMm() * 1000) / 1000 } : {}),
      position_checked: ctx.source === 'camera',
      distance_source: ctx.source,
      calibration: calibrationExtra(test, ctx),
    });
  }
  results[test.meta.key] = { ...res, ...extra };
  toast(`บันทึกผล ${test.meta.title.split(' (')[0]} ชั่วคราวแล้ว`, 'success', 2500);
  return true;
}

// ---------------- save ----------------
async function save() {
  const btn = qs('#btn-save');
  setBusy(btn, true);
  const payload = { ...(wf.subject?.type === 'patient' ? { patient_id: wf.subject.id } : {}) };
  for (const t of TESTS) {
    const r = results[t.meta.key];
    payload[t.meta.key] = r ? { right: r.right ?? { status: 'not_tested' }, left: r.left ?? { status: 'not_tested' }, ...Object.fromEntries(Object.entries(r).filter(([k]) => !['right', 'left'].includes(k))) } : null;
  }
  try {
    const saved = await api.post('/vision-tests', payload);
    setWorkflow({ visionTestId: saved.id, visionSkipped: false });
    renderStepper(qs('#stepper'), 'vision');
    const s = saved.summary;
    qs('#vt-main').innerHTML = `
      <section class="card fade-up" aria-labelledby="h-done">
        <div class="card-title"><div class="icon-bubble accent">${icons.checkCircle}</div><h2 id="h-done">บันทึกผลการทดสอบการมองเห็นแล้ว</h2></div>
        <p class="small muted">บันทึกเมื่อ ${formatDateTime(saved.created_at)} · เกณฑ์ ${esc(s.criteria_version)}</p>
        <div class="table-wrap"><table class="table stack-sm"><thead><tr><th>การทดสอบ</th><th>ตาขวา</th><th>ตาซ้าย</th></tr></thead><tbody>
          ${Object.values(s.tests).map((t) => `<tr><td data-label="การทดสอบ">${esc(t.label)}</td>
            ${['right', 'left'].map((e) => `<td data-label="${EYE_TH[e]}">${t[e].abnormal === true ? '<span class="badge badge-warning">เกินเกณฑ์</span> ' : t[e].abnormal === false ? '<span class="badge badge-success">ผ่านเกณฑ์</span> ' : ''}${esc(t[e].text)}</td>`).join('')}</tr>`).join('')}
        </tbody></table></div>
        <div class="row mt-5"><a class="btn btn-primary btn-lg" href="/pages/scan.html">ไปขั้นตอนถัดไป: สแกนดวงตา</a></div>
      </section>`;
  } catch (err) {
    toast(err.message, 'error');
    setBusy(btn, false);
  }
}
