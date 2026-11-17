/**
 * Eye camera scanner (WebRTC). Live preview with alignment frame, real-time
 * quality guidance (brightness, exposure, sharpness, eye position, distance),
 * optional Thai voice guidance, capture / upload, preview with quality report.
 * Quality metrics are the same module the backend uses.
 */
import { api } from './api.js';
import { icons } from './icons.js';
import { qs, qsa, esc, toast, renderErrorState } from './ui.js';
import { requireUser } from './auth.js';
import { getWorkflow, setWorkflow, renderStepper, saveCapture, subjectLabel } from './workflow.js';
import { EYE_SIDES, CONSENT_VERSION_FALLBACK } from './constants.js';
import { toGrayscale, assessQuality, guidanceFromFrame, QUALITY_THRESHOLDS } from '/ai-shared/image-quality/metrics.js';

const root = () => qs('#page-root');
const MAX_UPLOAD = 8 * 1024 * 1024;
const OUTPUT_MAX_SIDE = 1600;

const state = {
  stream: null,
  facing: 'environment',
  deviceIds: [],
  deviceIndex: 0,
  scanning: false,
  loopTimer: null,
  voice: false,
  lastSpoken: '',
  lastSpokenAt: 0,
  eye: 'right',
  capture: null, // { dataUrl, width, height, quality, source }
};

export async function init() {
  let user;
  try { user = await requireUser(); } catch (err) { renderErrorState(root(), err); return; }
  const wf = getWorkflow();
  state.eye = wf.eyeSide ?? 'right';

  root().innerHTML = `
    <div class="page-head"><h1>สแกนดวงตา</h1><p>ถ่ายภาพดวงตาทีละข้างผ่านกล้องโทรศัพท์หรือเว็บแคม หรืออัปโหลดภาพจากอุปกรณ์</p></div>
    <div id="stepper"></div>
    <div id="scan-content"></div>`;
  renderStepper(qs('#stepper'), 'scan');

  if (!wf.historyId || (user.account_type === 'staff' && wf.subject?.type !== 'patient')) {
    qs('#scan-content').innerHTML = `<div class="alert alert-info">${icons.info}<div><strong>ต้องซักประวัติก่อนสแกน</strong> ระบบต้องใช้ข้อมูลซักประวัติประกอบการประเมินทุกครั้ง
      <div class="mt-2"><a class="btn btn-primary btn-sm" href="/pages/medical-history.html">ไปที่ซักประวัติ</a></div></div></div>`;
    return;
  }
  if (typeof wf.datasetConsent !== 'boolean') renderConsent();
  else renderScanner();
}

// ---------------------------------------------------------------------
// Consent (PDPA) — asked before the first image of a screening session
// ---------------------------------------------------------------------
async function renderConsent() {
  let version = CONSENT_VERSION_FALLBACK;
  try { version = (await api.get('/consents/version')).version; } catch { /* use fallback */ }
  qs('#scan-content').innerHTML = `
    <section class="card fade-up" aria-labelledby="h-consent" style="max-width:820px">
      <div class="card-title"><div class="icon-bubble accent">${icons.shield}</div><h2 id="h-consent">ขอความยินยอมในการจัดเก็บภาพเพื่อพัฒนา AI</h2></div>
      <p>EYE Check ขออนุญาตจัดเก็บภาพดวงตาที่ถ่ายในการตรวจครั้งนี้ เพื่อนำไปใช้ <strong>พัฒนาและฝึกโมเดล AI</strong> ให้คัดกรองได้แม่นยำขึ้น</p>
      <ul>
        <li>ภาพจะถูกตั้งชื่อด้วยรหัสสุ่ม ไม่มีชื่อหรือข้อมูลส่วนตัว และลบข้อมูล EXIF/ตำแหน่งออกก่อนจัดเก็บ</li>
        <li>ภาพจะถูกตรวจสอบโดยผู้ดูแลระบบก่อนนำไปใช้ ไม่มีการนำไปฝึก AI โดยอัตโนมัติ</li>
        <li>คุณสามารถเพิกถอนความยินยอมได้ทุกเมื่อที่หน้า "ข้อมูลส่วนตัว" แล้วภาพจะถูกลบออกจากคลังข้อมูล</li>
        <li><strong>หากไม่ยินยอม คุณยังตรวจคัดกรองได้ตามปกติ</strong> ภาพจะถูกใช้เพื่อการตรวจของคุณเท่านั้น</li>
      </ul>
      <p class="small muted">เวอร์ชันความยินยอม ${esc(version)} · อ่านรายละเอียดใน <a href="/pages/privacy.html" target="_blank" rel="noopener">นโยบายความเป็นส่วนตัว</a></p>
      <div class="row mt-4">
        <button class="btn btn-accent btn-lg" data-consent="yes">${icons.check}ยินยอมให้ใช้ภาพพัฒนา AI</button>
        <button class="btn btn-lg" data-consent="no">ไม่ยินยอม (ตรวจตามปกติ)</button>
      </div>
    </section>`;
  const box = qs('#scan-content');
  box.onclick = (e) => {
    const b = e.target.closest('[data-consent]');
    if (!b) return;
    box.onclick = null;
    setWorkflow({ datasetConsent: b.dataset.consent === 'yes', consentVersion: version, consentAt: new Date().toISOString() });
    renderScanner();
  };
}

// ---------------------------------------------------------------------
// Scanner UI
// ---------------------------------------------------------------------
function renderScanner() {
  const wf = getWorkflow();
  qs('#scan-content').innerHTML = `
    <p class="mb-4"><span class="source-tag">ผู้เข้ารับการตรวจ</span><br><strong>${esc(subjectLabel(wf))}</strong>
      · ความยินยอมใช้ภาพพัฒนา AI: ${wf.datasetConsent ? '<span class="badge badge-success">ยินยอม</span>' : '<span class="badge badge-muted">ไม่ยินยอม</span>'}
      <button class="btn btn-sm btn-ghost" id="btn-consent-change">เปลี่ยน</button></p>
    <div class="camera-layout">
      <div>
        <div class="camera-stage" id="stage" aria-live="polite">
          <div id="stage-idle" class="center" style="padding:24px">${icons.camera.replace('<svg', '<svg width="56" height="56" style="margin:0 auto 8px"')}<p class="mb-0">กดปุ่ม "เปิดกล้อง" เพื่อเริ่ม<br><span class="small">ระบบจะขออนุญาตใช้กล้องก่อน</span></p></div>
          <video id="video" playsinline muted autoplay class="hidden" aria-label="ภาพจากกล้อง"></video>
          <img id="preview" class="preview hidden" alt="ภาพดวงตาที่ถ่าย">
          <div class="eye-frame hidden" id="eye-frame" aria-hidden="true"></div>
          <div class="cam-badges hidden" id="cam-badges"></div>
          <div class="guide-text hidden" id="guide-text">${icons.info}<span></span></div>
        </div>
        <div class="camera-controls" id="controls-live">
          <button class="btn btn-primary" id="btn-camera">${icons.camera}เปิดกล้อง</button>
          <button class="btn" id="btn-scan" disabled>${icons.eye}เริ่มสแกนแบบ Real-time</button>
          <button class="capture-btn" id="btn-capture" disabled aria-label="ถ่ายภาพ">${icons.camera}</button>
          <button class="btn" id="btn-switch" disabled>${icons.swap}สลับกล้อง</button>
          <label class="btn" for="file-input">${icons.upload}อัปโหลดภาพจากอุปกรณ์</label>
          <input type="file" id="file-input" accept="image/jpeg,image/png,image/webp" class="sr-only">
        </div>
        <div class="camera-controls hidden" id="controls-preview">
          <button class="btn btn-lg" id="btn-retake">${icons.refresh}ถ่ายใหม่</button>
          <button class="btn btn-primary btn-lg" id="btn-confirm">${icons.check}ยืนยันภาพและวิเคราะห์</button>
        </div>
      </div>
      <aside class="stack">
        <section class="card">
          <h3>เลือกตาที่ต้องการตรวจ</h3>
          <div class="segmented" role="group" aria-label="เลือกตา">
            ${Object.entries(EYE_SIDES).reverse().map(([k, v]) => `<button type="button" data-eye="${k}" aria-pressed="${state.eye === k}">${icons.eye}${v}</button>`).join('')}
          </div>
          <p class="small muted mt-2 mb-0">ตรวจทีละข้าง หากต้องการตรวจทั้งสองข้าง ให้ทำซ้ำอีกครั้งหลังได้ผลข้างแรก</p>
        </section>
        <section class="card">
          <div class="row-between"><h3 class="mb-0">คำแนะนำด้วยเสียง</h3>
            <button class="btn btn-sm" id="btn-voice" aria-pressed="false">${icons.volumeOff}ปิดอยู่</button></div>
          <p class="small muted mb-0 mt-2">อ่านคำแนะนำการจัดตำแหน่งเป็นภาษาไทย${'speechSynthesis' in window ? '' : ' (เบราว์เซอร์นี้ไม่รองรับ)'}</p>
        </section>
        <section class="card">
          <h3>การตรวจสอบคุณภาพภาพ</h3>
          <ul class="quality-list" id="quality-list"><li class="muted">ยังไม่มีภาพ</li></ul>
          <div id="quality-verdict" class="mt-3"></div>
        </section>
        <section class="card card-muted">
          <h3>เคล็ดลับการถ่ายภาพ</h3>
          <ul class="small mb-0">
            <li>ถ่ายในที่สว่าง แสงสม่ำเสมอ หลีกเลี่ยงแฟลชและแสงสะท้อน</li>
            <li>ให้ดวงตาอยู่กลางกรอบวงรี ห่างกล้องประมาณ 10–20 ซม.</li>
            <li>ลืมตากว้าง มองตรงมาที่กล้อง ถือกล้องให้นิ่ง</li>
            <li>แนะนำใช้กล้องหลังของโทรศัพท์ให้ผู้อื่นช่วยถ่าย เพื่อความคมชัด</li>
          </ul>
        </section>
      </aside>
    </div>`;

  qs('#btn-consent-change').addEventListener('click', () => { stopCamera(); setWorkflow({ datasetConsent: undefined }); renderConsent(); });
  qs('#btn-camera').addEventListener('click', () => (state.stream ? stopCamera() : startCamera()));
  qs('#btn-switch').addEventListener('click', switchCamera);
  qs('#btn-scan').addEventListener('click', toggleScanning);
  qs('#btn-capture').addEventListener('click', captureFromVideo);
  qs('#file-input').addEventListener('change', onUpload);
  qs('#btn-retake').addEventListener('click', retake);
  qs('#btn-confirm').addEventListener('click', confirmImage);
  qs('#btn-voice').addEventListener('click', toggleVoice);
  qsa('[data-eye]').forEach((b) => b.addEventListener('click', () => {
    state.eye = b.dataset.eye;
    qsa('[data-eye]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    setWorkflow({ eyeSide: state.eye });
  }));
  setWorkflow({ eyeSide: state.eye });

  window.addEventListener('pagehide', stopCamera);
  document.addEventListener('visibilitychange', () => { if (document.hidden && state.stream) stopCamera(); });
}

// ---------------------------------------------------------------------
// Camera
// ---------------------------------------------------------------------
function cameraErrorMessage(err) {
  if (!window.isSecureContext) return 'การใช้กล้องต้องเปิดเว็บผ่าน HTTPS (หรือ localhost)';
  switch (err?.name) {
    case 'NotAllowedError': case 'SecurityError': return 'ไม่ได้รับอนุญาตให้ใช้กล้อง (Permission Denied) กรุณาอนุญาตการใช้กล้องในการตั้งค่าเบราว์เซอร์ หรือใช้การอัปโหลดภาพแทน';
    case 'NotFoundError': case 'OverconstrainedError': return 'ไม่พบกล้องบนอุปกรณ์นี้ กรุณาใช้การอัปโหลดภาพแทน';
    case 'NotReadableError': return 'กล้องถูกใช้งานโดยแอปอื่นอยู่ กรุณาปิดแอปนั้นแล้วลองใหม่';
    default: return 'ไม่สามารถเปิดกล้องได้ กรุณาลองใหม่หรือใช้การอัปโหลดภาพ';
  }
}

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) { toast(cameraErrorMessage({ name: 'NotFoundError' }), 'error', 7000); return; }
  stopCamera();
  const deviceId = state.deviceIds[state.deviceIndex];
  const constraints = {
    audio: false,
    video: deviceId
      ? { deviceId: { exact: deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } }
      : { facingMode: { ideal: state.facing }, width: { ideal: 1920 }, height: { ideal: 1080 } },
  };
  try {
    state.stream = await navigator.mediaDevices.getUserMedia(constraints);
  } catch (err) {
    toast(cameraErrorMessage(err), 'error', 8000);
    showGuide(cameraErrorMessage(err), 'warn');
    return;
  }
  const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
  state.deviceIds = devices.filter((d) => d.kind === 'videoinput').map((d) => d.deviceId).filter(Boolean);
  const track = state.stream.getVideoTracks()[0];
  const settings = track.getSettings?.() ?? {};
  if (settings.facingMode) state.facing = settings.facingMode;

  const video = qs('#video');
  video.srcObject = state.stream;
  video.classList.toggle('mirror', state.facing === 'user');
  await video.play().catch(() => {});
  showLive(true);
  qs('#btn-camera').innerHTML = `${icons.x}ปิดกล้อง`;
  qs('#btn-scan').disabled = false;
  qs('#btn-capture').disabled = false;
  qs('#btn-switch').disabled = state.deviceIds.length < 2 && !/Android|iPhone|iPad/i.test(navigator.userAgent);
  showGuide('กรุณาจัดดวงตาให้อยู่กลางกรอบ แล้วกด "เริ่มสแกนแบบ Real-time"', 'info');
  if (!state.scanning) toggleScanning();
}

function stopCamera() {
  stopScanning();
  if (state.stream) state.stream.getTracks().forEach((t) => t.stop());
  state.stream = null;
  const v = qs('#video');
  if (v) v.srcObject = null;
  if (qs('#btn-camera')) {
    qs('#btn-camera').innerHTML = `${icons.camera}เปิดกล้อง`;
    qs('#btn-scan').disabled = true;
    qs('#btn-capture').disabled = true;
    qs('#btn-switch').disabled = true;
    if (!state.capture) showLive(false);
  }
}

async function switchCamera() {
  if (state.deviceIds.length > 1) {
    state.deviceIndex = (state.deviceIndex + 1) % state.deviceIds.length;
  } else {
    state.facing = state.facing === 'user' ? 'environment' : 'user';
    state.deviceIds = [];
  }
  await startCamera();
  toast(state.facing === 'user' ? 'ใช้กล้องหน้า' : 'สลับกล้องแล้ว', 'info', 2000);
}

function showLive(on) {
  qs('#stage-idle').classList.toggle('hidden', on);
  qs('#video').classList.toggle('hidden', !on);
  qs('#eye-frame').classList.toggle('hidden', !on);
  qs('#cam-badges').classList.toggle('hidden', !on);
  qs('#guide-text').classList.toggle('hidden', !on);
}

function showGuide(text, kind) {
  const g = qs('#guide-text');
  if (!g) return;
  g.classList.remove('hidden');
  g.querySelector('span').textContent = text;
  const frame = qs('#eye-frame');
  frame.classList.toggle('ready', kind === 'ready');
  frame.classList.toggle('warn', kind === 'warn');
}

// ---------------------------------------------------------------------
// Real-time guidance loop
// ---------------------------------------------------------------------
const analysisCanvas = document.createElement('canvas');

function grayFrom(source, sw, sh, crop = null) {
  const scale = Math.min(1, QUALITY_THRESHOLDS.analysisMaxSide / Math.max(crop?.w ?? sw, crop?.h ?? sh));
  const w = Math.max(1, Math.round((crop?.w ?? sw) * scale));
  const h = Math.max(1, Math.round((crop?.h ?? sh) * scale));
  analysisCanvas.width = w;
  analysisCanvas.height = h;
  const ctx = analysisCanvas.getContext('2d', { willReadFrequently: true });
  if (crop) ctx.drawImage(source, crop.x, crop.y, crop.w, crop.h, 0, 0, w, h);
  else ctx.drawImage(source, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;
  return { gray: toGrayscale(data, w, h, 4), width: w, height: h };
}

function analyzeFrame() {
  const video = qs('#video');
  if (!video || !video.videoWidth) return;
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const g = grayFrom(video, vw, vh);
  const q = assessQuality({ ...g, originalWidth: vw, originalHeight: vh });
  const guide = guidanceFromFrame(q);
  showGuide(guide.text, guide.code === 'ready' ? 'ready' : 'warn');
  const m = q.metrics;
  qs('#cam-badges').innerHTML = `
    <span class="badge">แสง ${Math.round(m.brightness)}</span>
    <span class="badge">ความคมชัด ${Math.round(m.blurVariance)}</span>
    <span class="badge">${vw}×${vh}</span>
    <span class="badge">${guide.code === 'ready' ? '✓ พร้อมถ่าย' : '… กำลังจัดตำแหน่ง'}</span>`;
  speak(guide.text);
}

function toggleScanning() {
  if (state.scanning) { stopScanning(); return; }
  if (!state.stream) return;
  state.scanning = true;
  qs('#btn-scan').innerHTML = `${icons.x}หยุดสแกน`;
  const loop = () => {
    if (!state.scanning) return;
    analyzeFrame();
    state.loopTimer = setTimeout(loop, 400);
  };
  loop();
}

function stopScanning() {
  state.scanning = false;
  clearTimeout(state.loopTimer);
  const b = qs('#btn-scan');
  if (b) b.innerHTML = `${icons.eye}เริ่มสแกนแบบ Real-time`;
  if ('speechSynthesis' in window) speechSynthesis.cancel();
}

function toggleVoice() {
  state.voice = !state.voice;
  const b = qs('#btn-voice');
  b.setAttribute('aria-pressed', String(state.voice));
  b.innerHTML = state.voice ? `${icons.volume}เปิดอยู่` : `${icons.volumeOff}ปิดอยู่`;
  if (!state.voice && 'speechSynthesis' in window) speechSynthesis.cancel();
  if (state.voice) { state.lastSpoken = ''; speak('เปิดคำแนะนำด้วยเสียงแล้ว'); }
}

function speak(text) {
  if (!state.voice || !('speechSynthesis' in window)) return;
  const now = Date.now();
  if (text === state.lastSpoken && now - state.lastSpokenAt < 6000) return;
  if (now - state.lastSpokenAt < 2500) return;
  state.lastSpoken = text;
  state.lastSpokenAt = now;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'th-TH';
  u.rate = 1;
  const th = speechSynthesis.getVoices().find((v) => v.lang?.startsWith('th'));
  if (th) u.voice = th;
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
}

// ---------------------------------------------------------------------
// Capture / upload → preview + quality report
// ---------------------------------------------------------------------
function toOutput(source, sw, sh) {
  const scale = Math.min(1, OUTPUT_MAX_SIDE / Math.max(sw, sh));
  const w = Math.round(sw * scale);
  const h = Math.round(sh * scale);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  c.getContext('2d').drawImage(source, 0, 0, w, h);
  return { canvas: c, width: w, height: h };
}

function evaluate(canvas, w, h, origW, origH) {
  const g = grayFrom(canvas, w, h);
  return assessQuality({ ...g, originalWidth: origW, originalHeight: origH });
}

function captureFromVideo() {
  const video = qs('#video');
  if (!video?.videoWidth) { toast('กล้องยังไม่พร้อม', 'warning'); return; }
  const out = toOutput(video, video.videoWidth, video.videoHeight);
  const q = evaluate(out.canvas, out.width, out.height, out.width, out.height);
  showPreview({ dataUrl: out.canvas.toDataURL('image/jpeg', 0.92), width: out.width, height: out.height, quality: q, source: 'camera' });
}

async function onUpload(e) {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { toast('รองรับเฉพาะไฟล์ JPG, PNG หรือ WEBP', 'error'); return; }
  if (file.size > MAX_UPLOAD) { toast('ไฟล์มีขนาดใหญ่เกิน 8 MB', 'error'); return; }
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    toast('ไม่สามารถอ่านไฟล์ภาพได้ (Invalid Image)', 'error');
    return;
  }
  const out = toOutput(bitmap, bitmap.width, bitmap.height);
  const q = evaluate(out.canvas, out.width, out.height, out.width, out.height);
  bitmap.close?.();
  stopCamera();
  showPreview({ dataUrl: out.canvas.toDataURL('image/jpeg', 0.92), width: out.width, height: out.height, quality: q, source: 'upload' });
}

function showPreview(cap) {
  state.capture = cap;
  stopScanning();
  qs('#video').classList.add('hidden');
  qs('#eye-frame').classList.add('hidden');
  qs('#cam-badges').classList.add('hidden');
  qs('#stage-idle').classList.add('hidden');
  const img = qs('#preview');
  img.src = cap.dataUrl;
  img.classList.remove('hidden');
  qs('#controls-live').classList.add('hidden');
  qs('#controls-preview').classList.remove('hidden');

  const q = cap.quality;
  qs('#quality-list').innerHTML = q.checks.map((c) => {
    const cls = c.passed ? 'pass' : c.severity === 'warning' ? 'warn' : 'fail';
    const ic = c.passed ? icons.checkCircle : c.severity === 'warning' ? icons.alert : icons.xCircle;
    return `<li class="${cls}">${ic}<div><strong>${esc(c.label)}</strong> <span class="small muted">(${esc(c.value)})</span><br><span class="small">${esc(c.message)}</span></div></li>`;
  }).join('');
  qs('#quality-verdict').innerHTML = q.passed
    ? `<div class="alert alert-success">${icons.checkCircle}<div><strong>ภาพผ่านเกณฑ์คุณภาพเบื้องต้น</strong>${q.warnings.length ? `ข้อควรระวัง: ${esc(q.warnings.join(' '))}` : 'สามารถยืนยันภาพเพื่อวิเคราะห์ได้'}</div></div>`
    : `<div class="alert alert-danger" role="alert">${icons.xCircle}<div><strong>ภาพไม่ผ่านเกณฑ์ กรุณาถ่ายใหม่</strong>${esc(q.errors.join(' '))}</div></div>`;
  qs('#btn-confirm').disabled = !q.passed;
  const g = qs('#guide-text');
  g.classList.remove('hidden');
  g.querySelector('span').textContent = q.passed ? 'ตรวจสอบภาพ แล้วกด "ยืนยันภาพ"' : 'ภาพยังไม่ผ่านเกณฑ์ กรุณาถ่ายใหม่';
  speak(q.passed ? 'สามารถยืนยันภาพได้' : 'ภาพยังไม่ชัด กรุณาถ่ายใหม่');
}

function retake() {
  state.capture = null;
  qs('#preview').classList.add('hidden');
  qs('#controls-preview').classList.add('hidden');
  qs('#controls-live').classList.remove('hidden');
  qs('#quality-list').innerHTML = '<li class="muted">ยังไม่มีภาพ</li>';
  qs('#quality-verdict').innerHTML = '';
  startCamera();
}

function confirmImage() {
  const cap = state.capture;
  if (!cap?.quality.passed) return;
  const ok = saveCapture(cap.dataUrl, { eyeSide: state.eye, source: cap.source, width: cap.width, height: cap.height });
  if (!ok) { toast('หน่วยความจำของเบราว์เซอร์ไม่พอ กรุณาลองถ่ายใหม่ด้วยความละเอียดต่ำลง', 'error'); return; }
  stopCamera();
  setWorkflow({ eyeSide: state.eye, screeningId: null, analyzed: false, saved: false });
  location.href = '/pages/analyze.html';
}
