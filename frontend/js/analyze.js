/**
 * AI processing interface. Each stage reflects a real backend step:
 *  1. Uploading Image          — XHR upload progress
 *  2. Checking Image Quality   — server-side quality gate (POST /screenings)
 *  3. AI Analyzing             — Roboflow inference (POST /ai/analyze)
 *  4. Processing Complete      — only after the backend returned the model result
 */
import { api } from './api.js';
import { icons } from './icons.js';
import { qs, esc, renderErrorState } from './ui.js';
import { requireUser } from './auth.js';
import { getWorkflow, setWorkflow, renderStepper, getCapture, clearCapture, subjectLabel } from './workflow.js';
import { EYE_SIDES, AI_STATUS } from './constants.js';

const root = () => qs('#page-root');
const STAGES = [
  { key: 'upload', label: 'Uploading Image', th: 'กำลังอัปโหลดภาพ' },
  { key: 'quality', label: 'Checking Image Quality', th: 'กำลังตรวจสอบคุณภาพภาพ' },
  { key: 'ai', label: 'AI Analyzing', th: 'AI กำลังวิเคราะห์ภาพ' },
  { key: 'done', label: 'Processing Complete', th: 'ประมวลผลเสร็จสิ้น' },
];

// Animated AI eye scanner, built on the EYE Check logo eye (assets/logo.svg path, scaled ×5).
// Single 400×300 viewBox → every layer stays aligned and the eye is never stretched.
const LOGO_EYE = 'M8 32c6-9.5 14.5-15 24-15s18 5.5 24 15c-6 9.5-14.5 15-24 15S14 41.5 8 32z';
// particle layer: [x, y, radius, duration s, delay s] — fixed positions around the eye
const PARTICLES = [
  [70, 110, 2.2, 4.2, 0], [96, 210, 1.6, 3.6, 1.1], [128, 64, 1.8, 4.8, 2.3], [176, 52, 1.4, 3.9, .6],
  [236, 244, 2, 4.4, 1.8], [272, 58, 1.6, 4, 2.9], [312, 92, 2.2, 3.7, .3], [334, 200, 1.8, 4.6, 1.4],
  [150, 250, 1.4, 4.1, 3.2], [58, 178, 1.5, 3.8, 2.6], [350, 140, 1.4, 4.3, 3.6], [214, 40, 1.8, 3.5, 1.9],
];
const SCANNER_SVG = `
  <svg class="ec-svg" viewBox="0 0 400 300" xmlns="http://www.w3.org/2000/svg" focusable="false">
    <defs>
      <radialGradient id="ec-glow-g"><stop offset="0" stop-color="#0095E8" stop-opacity=".30"/><stop offset=".55" stop-color="#19C3C9" stop-opacity=".14"/><stop offset="1" stop-color="#19C3C9" stop-opacity="0"/></radialGradient>
      <radialGradient id="ec-glow-ok"><stop offset="0" stop-color="#34C38F" stop-opacity=".32"/><stop offset="1" stop-color="#34C38F" stop-opacity="0"/></radialGradient>
      <linearGradient id="ec-stroke" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0095E8"/><stop offset="1" stop-color="#19B9C4"/></linearGradient>
      <radialGradient id="ec-white" cx=".5" cy=".45" r=".6"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#e4f4fd"/></radialGradient>
      <radialGradient id="ec-iris-g" cx=".42" cy=".38" r=".7"><stop offset="0" stop-color="#4fc3ff"/><stop offset=".5" stop-color="#0095E8"/><stop offset="1" stop-color="#075e91"/></radialGradient>
      <linearGradient id="ec-lid-g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e3f4fd"/><stop offset="1" stop-color="#b9e2f7"/></linearGradient>
      <linearGradient id="ec-tint" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#22D3EE" stop-opacity="0"/><stop offset=".5" stop-color="#22D3EE" stop-opacity=".38"/><stop offset="1" stop-color="#22D3EE" stop-opacity="0"/></linearGradient>
      <linearGradient id="ec-band" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#19C3D6" stop-opacity="0"/><stop offset=".5" stop-color="#19C3D6" stop-opacity=".16"/><stop offset="1" stop-color="#19C3D6" stop-opacity="0"/></linearGradient>
      <linearGradient id="ec-line-h" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#0095E8" stop-opacity="0"/><stop offset=".2" stop-color="#0095E8"/><stop offset=".5" stop-color="#7ff3ff"/><stop offset=".8" stop-color="#19C3D6"/><stop offset="1" stop-color="#19C3D6" stop-opacity="0"/></linearGradient>
      <filter id="ec-blur" x="-10%" y="-300%" width="120%" height="700%"><feGaussianBlur stdDeviation="3.5"/></filter>
      <clipPath id="ec-almond"><path d="${LOGO_EYE}"/></clipPath>
    </defs>
    <!-- glow layer -->
    <circle class="ec-glow" cx="200" cy="150" r="150" fill="url(#ec-glow-g)"/>
    <circle class="ec-glow-ok" cx="200" cy="150" r="150" fill="url(#ec-glow-ok)"/>
    <!-- scanner ring layer -->
    <g class="ec-rings-wrap">
      <circle class="ec-ring soft" cx="200" cy="150" r="116"/>
      <circle class="ec-ring soft r2" cx="200" cy="150" r="134"/>
      <circle class="ec-ring arc" cx="200" cy="150" r="125"/>
      <circle class="ec-ring dash" cx="200" cy="150" r="143"/>
      <circle class="ec-ripple" cx="200" cy="150" r="55"/>
      <circle class="ec-ripple r2" cx="200" cy="150" r="55"/>
    </g>
    <!-- AI processing lines + particle layer -->
    <g class="ec-fx-wrap">
      <path class="ec-line" d="M76 150 H52 L40 132 H16"/><path class="ec-line" d="M324 150 H348 L360 168 H384"/>
      <path class="ec-line" d="M112 92 L92 72 H62"/><path class="ec-line" d="M288 208 L308 228 H338"/>
      <g><circle class="ec-node" cx="16" cy="132" r="3"/><circle class="ec-node" cx="384" cy="168" r="3"/><circle class="ec-node" cx="62" cy="72" r="3"/><circle class="ec-node" cx="338" cy="228" r="3"/></g>
      ${PARTICLES.map(([x, y, r, t, d]) => `<circle class="ec-dot" cx="${x}" cy="${y}" r="${r}" fill="${x % 2 ? '#19C3D6' : '#0095E8'}" style="--t:${t}s;--d:${d}s"/>`).join('')}
    </g>
    <!-- eye layer (logo eye) + eyelid layer -->
    <g class="ec-eye-wrap"><g class="ec-eye"><g class="ec-eye-geo" transform="translate(200 150) scale(5) translate(-32 -32)">
      <path d="${LOGO_EYE}" fill="url(#ec-white)"/>
      <g clip-path="url(#ec-almond)">
        <g class="ec-iris">
          <circle cx="32" cy="32" r="10" fill="url(#ec-iris-g)"/>
          <circle cx="32" cy="32" r="10" fill="none" stroke="#075e91" stroke-width=".5"/>
          <circle cx="32" cy="32" r="7" fill="none" stroke="#fff" stroke-opacity=".3" stroke-width=".25" stroke-dasharray=".8 1.2"/>
          <circle class="ec-pupil" cx="32" cy="32" r="4.5" fill="#06223a"/>
        </g>
        <circle class="ec-glint" cx="35.5" cy="28.5" r="2.2" fill="#fff"/>
        <circle cx="29.3" cy="34.6" r=".9" fill="#fff" opacity=".7"/>
        <rect class="ec-beam-tint" x="0" y="-3.5" width="64" height="7" fill="url(#ec-tint)"/>
        <g class="ec-lid">
          <path d="M2 -2H62V32C50 46 14 46 2 32Z" fill="url(#ec-lid-g)"/>
          <path d="M2 32C14 46 50 46 62 32" fill="none" stroke="#087FC4" stroke-width="1.1" stroke-linecap="round"/>
        </g>
      </g>
      <path d="${LOGO_EYE}" fill="none" stroke="url(#ec-stroke)" stroke-width="1.3" stroke-linejoin="round"/>
    </g></g></g>
    <!-- scanning line layer -->
    <g class="ec-beam">
      <rect x="56" y="-26" width="288" height="52" fill="url(#ec-band)"/>
      <rect x="60" y="-4" width="280" height="8" fill="url(#ec-line-h)" filter="url(#ec-blur)" opacity=".8"/>
      <rect x="64" y="-1.25" width="272" height="2.5" rx="1.25" fill="url(#ec-line-h)"/>
    </g>
    <!-- frame + success badge -->
    <path class="ec-corner" d="M22 50V30q0-8 8-8h20"/><path class="ec-corner" d="M350 22h20q8 0 8 8v20"/>
    <path class="ec-corner" d="M22 250v20q0 8 8 8h20"/><path class="ec-corner" d="M350 278h20q8 0 8-8v-20"/>
    <g class="ec-badge"><circle cx="300" cy="214" r="17" fill="#15803d" stroke="#fff" stroke-width="3"/>
      <path d="M292 214l5.5 5.5 10-11" fill="none" stroke="#fff" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/></g>
  </svg>`;

// Scanner visual state follows the real stage updates only (no timers, no simulated progress).
function syncScanner(key, status) {
  const scanner = qs('#scanner');
  const caption = qs('#scan-caption');
  if (!scanner || !caption) return;
  let state = null;
  let text = '';
  if (status === 'active') { state = 'is-scanning'; text = STAGES.find((s) => s.key === key)?.th ?? ''; }
  else if (status === 'error') { state = 'is-error'; text = 'การประมวลผลหยุดลง'; }
  else if (status === 'done' && key === 'done') { state = 'is-done'; text = 'ประมวลผลเสร็จสิ้น'; }
  if (!state) return;
  scanner.classList.remove('is-scanning', 'is-done', 'is-error');
  scanner.classList.add(state);
  if (caption.textContent !== text) {
    caption.textContent = text;
    caption.className = `scan-caption ${state === 'is-done' ? 'done' : state === 'is-error' ? 'error' : ''}`;
    void caption.offsetWidth; // restart the fade-in
    caption.classList.add('swap');
  }
}

function setStage(key, status, note = '') {
  const li = qs(`[data-stage="${key}"]`);
  if (!li) return;
  const changed = li.className !== status;
  li.className = status;
  // only re-render the icon on a real status change so the check "pop" doesn't replay on progress ticks
  if (changed) li.querySelector('.p-icon').innerHTML = status === 'done' ? icons.check : status === 'error' ? icons.x : '';
  li.querySelector('.p-note').textContent = note;
  syncScanner(key, status);
}

function dataUrlToBlob(dataUrl) {
  const [head, b64] = dataUrl.split(',');
  const mime = /data:(.*?);/.exec(head)?.[1] ?? 'image/jpeg';
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

export async function init() {
  try { await requireUser(); } catch (err) { renderErrorState(root(), err); return; }
  const wf = getWorkflow();
  const capture = getCapture();

  root().innerHTML = `
    <div class="page-head"><h1>วิเคราะห์ผลด้วย AI</h1><p>ระบบจะส่งภาพไปยัง Backend เพื่อตรวจสอบคุณภาพ แล้ววิเคราะห์ด้วยโมเดล Deep Learning บน Roboflow</p></div>
    <div id="stepper"></div>
    ${wf.historyEmergency ? `<div class="alert alert-urgent mb-4" role="alert">${icons.siren}<div><strong>พบอาการเตือนฉุกเฉินจากการซักประวัติ</strong>
      กรุณาไปพบจักษุแพทย์หรือห้องฉุกเฉินทันที ไม่ต้องรอผล AI — ผล AI ไม่สามารถลบล้างคำเตือนนี้ได้</div></div>` : ''}
    <div class="grid grid-2">
      <section class="card">
        <div class="scan-anim" id="scanner" aria-hidden="true">${SCANNER_SVG}</div>
        <p class="scan-caption mb-4" id="scan-caption" aria-hidden="true"></p>
        <ol class="process-list" aria-live="polite">
          ${STAGES.map((s) => `<li data-stage="${s.key}"><span class="p-icon"></span><div><strong>${s.label}</strong><br><span class="small">${s.th}</span> <span class="small muted p-note"></span></div></li>`).join('')}
        </ol>
        <div class="progress mt-4" aria-hidden="true"><span id="up-progress"></span></div>
      </section>
      <section class="card">
        <h2>ข้อมูลการตรวจ</h2>
        <dl class="kv">
          <dt>ผู้เข้ารับการตรวจ</dt><dd>${esc(subjectLabel(wf) ?? '-')}</dd>
          <dt>ตาข้างที่ตรวจ</dt><dd>${esc(EYE_SIDES[capture?.meta?.eyeSide ?? wf.eyeSide] ?? '-')}</dd>
          <dt>ทดสอบการมองเห็น</dt><dd>${wf.visionTestId ? 'บันทึกแล้ว' : 'ไม่ได้ทดสอบ'}</dd>
          <dt>ยินยอมใช้ภาพพัฒนา AI</dt><dd>${wf.datasetConsent ? 'ยินยอม' : 'ไม่ยินยอม'}</dd>
        </dl>
        ${capture ? `<img src="${capture.dataUrl}" alt="ภาพดวงตาที่จะวิเคราะห์" class="mt-4" style="border-radius:12px;max-height:240px;object-fit:contain;margin:16px auto 0">` : ''}
        <div id="analyze-msg" class="mt-4"></div>
      </section>
    </div>`;
  renderStepper(qs('#stepper'), 'analyze');

  if (!wf.historyId) {
    qs('#analyze-msg').innerHTML = `<div class="alert alert-info">${icons.info}<div>ยังไม่ได้ซักประวัติ <a href="/pages/medical-history.html">เริ่มที่ขั้นตอนแรก</a></div></div>`;
    return;
  }
  if (wf.screeningId) { await runAi(wf.screeningId); return; } // resume / retry AI step
  if (!capture) {
    qs('#analyze-msg').innerHTML = `<div class="alert alert-info">${icons.info}<div>ยังไม่มีภาพดวงตาสำหรับวิเคราะห์ <a class="btn btn-primary btn-sm mt-2" href="/pages/scan.html">ไปที่สแกนดวงตา</a></div></div>`;
    return;
  }
  await upload(wf, capture);
}

async function upload(wf, capture) {
  setStage('upload', 'active');
  const fd = new FormData();
  fd.append('image', dataUrlToBlob(capture.dataUrl), 'eye.jpg');
  fd.append('eye_side', capture.meta?.eyeSide ?? wf.eyeSide ?? 'right');
  fd.append('medical_history_id', wf.historyId);
  if (wf.subject?.type === 'patient') fd.append('patient_id', wf.subject.id);
  if (wf.visionTestId) fd.append('vision_test_id', wf.visionTestId);
  fd.append('dataset_consent', wf.datasetConsent ? 'true' : 'false');
  if (wf.consentVersion) fd.append('consent_version', wf.consentVersion);

  let res;
  try {
    res = await api.upload('/screenings', fd, {
      onProgress: (p) => { qs('#up-progress').style.width = `${Math.round(p * 100)}%`; setStage('upload', 'active', `${Math.round(p * 100)}%`); },
      onUploaded: () => { setStage('upload', 'done'); setStage('quality', 'active'); },
    });
  } catch (err) {
    const stage = qs('[data-stage="quality"]').className === 'active' ? 'quality' : 'upload';
    setStage(stage, 'error', err.message);
    if (err.code === 'IMAGE_QUALITY_FAILED' || err.code === 'INVALID_IMAGE' || err.code === 'UNSUPPORTED_FILE_TYPE') {
      const items = err.details?.checks?.filter((c) => !c.passed && c.severity === 'error') ?? [];
      qs('#analyze-msg').innerHTML = `<div class="alert alert-danger" role="alert">${icons.xCircle}<div><strong>${esc(err.message)}</strong>
        ${items.length ? `<ul class="mb-0">${items.map((c) => `<li>${esc(c.label)}: ${esc(c.message)}</li>`).join('')}</ul>` : ''}
        <a class="btn btn-primary btn-sm mt-2" href="/pages/scan.html">ถ่ายภาพใหม่</a></div></div>`;
      clearCapture();
    } else if (err.code === 'HISTORY_OUTDATED') {
      qs('#analyze-msg').innerHTML = `<div class="alert alert-warning" role="alert">${icons.alert}<div>${esc(err.message)} <a class="btn btn-primary btn-sm mt-2" href="/pages/medical-history.html">ซักประวัติใหม่</a></div></div>`;
    } else {
      showRetry(err.message, () => upload(wf, capture));
    }
    return;
  }
  setStage('upload', 'done');
  setStage('quality', 'done', res.quality?.warnings?.length ? `ข้อควรระวัง: ${res.quality.warnings.join(' ')}` : 'ผ่านเกณฑ์');
  setWorkflow({ screeningId: res.screening.id, screeningCode: res.screening.screening_code });
  clearCapture(); // the image now lives only in private server storage
  if (res.datasetWarning) qs('#analyze-msg').innerHTML = `<div class="alert alert-warning">${icons.alert}<div>${esc(res.datasetWarning)}</div></div>`;
  await runAi(res.screening.id);
}

async function runAi(screeningId) {
  setStage('upload', 'done');
  setStage('quality', 'done');
  setStage('ai', 'active');
  let result;
  try {
    result = await api.post('/ai/analyze', { screening_id: screeningId }, { timeout: 120000 });
  } catch (err) {
    setStage('ai', 'error', err.message);
    showRetry(err.message, () => runAi(screeningId));
    return;
  }
  const status = result.screening.ai_status;
  if (status === 'completed' || status === 'insufficient_confidence') {
    setStage('ai', 'done', AI_STATUS[status].th);
    setStage('done', 'done');
    setWorkflow({ analyzed: true });
    renderStepper(qs('#stepper'), 'analyze');
    qs('#analyze-msg').innerHTML = `<div class="alert alert-success">${icons.checkCircle}<div><strong>ได้รับผลจากโมเดลแล้ว</strong> กำลังไปยังหน้าผลการตรวจ...</div></div>`;
    setTimeout(() => { location.href = `/pages/result.html?id=${encodeURIComponent(screeningId)}`; }, 900);
    return;
  }
  // not_connected / failed → no fake success. The history-based assessment is still available.
  setStage('ai', 'error', AI_STATUS[status]?.th ?? status);
  setWorkflow({ analyzed: true });
  qs('#analyze-msg').innerHTML = `
    <div class="alert ${status === 'not_connected' ? 'alert-warning' : 'alert-danger'}" role="alert">${icons.alert}<div>
      <strong>${status === 'not_connected' ? 'AI Not Connected' : 'การวิเคราะห์ด้วย AI ไม่สำเร็จ'}</strong>${esc(result.screening.ai_error ?? '')}
      <p class="mb-0 mt-2">ภาพถูกบันทึกแล้ว คุณสามารถลองวิเคราะห์ใหม่ภายหลัง หรือดูผลประเมินจากข้อมูลซักประวัติและการทดสอบการมองเห็น (ไม่มีผล AI)</p>
      <div class="row mt-3"><button class="btn btn-primary btn-sm" id="btn-retry">${icons.refresh}ลองวิเคราะห์ใหม่</button>
      <a class="btn btn-sm" href="/pages/result.html?id=${encodeURIComponent(screeningId)}">ดูผลประเมินจากซักประวัติ</a></div></div></div>`;
  qs('#btn-retry').addEventListener('click', () => { qs('#analyze-msg').innerHTML = ''; runAi(screeningId); });
}

function showRetry(message, fn) {
  qs('#analyze-msg').innerHTML = `<div class="alert alert-danger" role="alert">${icons.xCircle}<div><strong>เกิดข้อผิดพลาด</strong>${esc(message)}
    <div class="mt-2"><button class="btn btn-primary btn-sm" id="btn-retry">${icons.refresh}ลองใหม่</button></div></div></div>`;
  qs('#btn-retry').addEventListener('click', () => { qs('#analyze-msg').innerHTML = ''; fn(); });
}
