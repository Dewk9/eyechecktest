/**
 * Face camera check for the on-screen vision tests.
 *
 * Live camera + MediaPipe Face Detector (BlazeFace short-range), self-hosted and run
 * on-device: no frame is uploaded or stored. Real-time guidance in a dashed oval checks
 * that exactly one face is centred, looking straight and stable.
 *
 * Modes
 *  - 'frame'    : relative check only (face fills the oval). No distance in cm.
 *  - 'anchor'   : the user sits at a distance measured with a tape/ruler (anchorCm); the eye
 *                 spacing in the image (ipdNorm = eye-to-eye px ÷ frame width) is recorded.
 *  - 'distance' : with an anchor, distance = anchorCm × ipdNorm₀ ÷ ipdNorm (pinhole camera,
 *                 same camera + resolution). Guides the user to targetCm ± tolerance and
 *                 returns the measured distance.
 * The camera focal length is never assumed: without an anchor no distance in cm is shown.
 */
import { icons } from '../icons.js';
import { estimateDistanceCm } from './common.js';

const MP_BASE = '/vendor/mediapipe';
const MODEL_URL = '/vendor/models/blaze_face_short_range.tflite';

// Overlay geometry in viewBox units. The stage has the same 3:4 aspect ratio, so 1 unit maps
// uniformly to the screen and the video (object-fit: cover) can be mapped into it exactly.
const VB = { w: 300, h: 400 };
const OVAL = { cx: 150, cy: 190, rx: 96, ry: 128 };
const TARGET = { x: OVAL.cx, y: OVAL.cy + 14 }; // face-box centre sits a bit below the head-oval centre
const FIT = { min: 0.6, max: 0.8 }; // frame mode: face-box width ÷ oval width
const LOOSE = { min: 0.12, max: 0.95 }; // anchor / distance modes: face only has to be clearly visible
const TOL = { x: 0.1, y: 0.09 }; // allowed centre offset (fraction of oval width / height)
const HYST = 1.3; // once "ok", tolerances widen by 30% so the state does not flip at the edge
const TURN = { yaw: 0.34, rollDeg: 14 };
const HOLD_MS = { frame: 2000, anchor: 2500, distance: 1500 };
const MOVE_RESET = 7; // viewBox units of centre movement between frames that restarts the hold
const SWITCH_MS = 380; // a new guidance message must persist this long before it is shown
const DETECT_EVERY_MS = 70; // ~14 detections / second
const CROP_W = 360; // analysed image width (px) of the visible 3:4 area

const MESSAGES = {
  loading: { text: 'กำลังเปิดกล้อง...', tone: 'idle' },
  none: { text: 'กรุณาหันหน้าเข้าหากล้อง', tone: 'idle', sub: 'ให้ใบหน้าอยู่ภายในกรอบวงรี' },
  multi: { text: 'พบมากกว่าหนึ่งใบหน้า', tone: 'warn', sub: 'ให้มีผู้ทดสอบเพียงคนเดียวในภาพ' },
  close: { text: 'ถอยห่างออกไป', tone: 'warn', sub: 'ใบหน้าอยู่ใกล้กล้องเกินไป' },
  far: { text: 'ขยับเข้ามาใกล้อีกนิด', tone: 'warn', sub: 'ใบหน้าอยู่ไกลกล้องเกินไป' },
  // same headline for every off-centre direction (no flicker); the direction is in the sub-line
  goRight: { text: 'จัดตำแหน่งใบหน้าให้อยู่กึ่งกลาง', tone: 'warn', sub: 'ขยับใบหน้าไปทางขวาเล็กน้อย' },
  goLeft: { text: 'จัดตำแหน่งใบหน้าให้อยู่กึ่งกลาง', tone: 'warn', sub: 'ขยับใบหน้าไปทางซ้ายเล็กน้อย' },
  high: { text: 'จัดตำแหน่งใบหน้าให้อยู่กึ่งกลาง', tone: 'warn', sub: 'ปรับระดับใบหน้าลงเล็กน้อย' },
  low: { text: 'จัดตำแหน่งใบหน้าให้อยู่กึ่งกลาง', tone: 'warn', sub: 'ยกใบหน้าขึ้นเล็กน้อย' },
  turn: { text: 'มองตรงเข้าหากล้อง', tone: 'warn', sub: 'ตั้งศีรษะให้ตรง ไม่เอียงหรือหันข้าง' },
  still: { text: 'กรุณาอยู่นิ่ง ๆ สักครู่', tone: 'warn', sub: 'ตำแหน่งยังไม่นิ่ง ระบบจะยืนยันเมื่อใบหน้าอยู่นิ่ง' },
  ok: { text: 'ตำแหน่งใบหน้าถูกต้อง', tone: 'ok', sub: 'อยู่นิ่ง ๆ สักครู่ ระบบกำลังตรวจสอบความเสถียร' },
  okDistance: { text: 'ตรวจพบระยะทดสอบที่เหมาะสม', tone: 'ok', sub: 'อยู่นิ่ง ๆ สักครู่ ระบบกำลังยืนยันระยะ' },
  done: { text: 'ปรับเทียบสำเร็จ', tone: 'ok', sub: 'บันทึกตำแหน่งและระยะที่เหมาะสมแล้ว' },
};

// ---------------------------------------------------------------- detector (loaded once)
let detectorP = null;
function loadDetector() {
  detectorP ??= (async () => {
    const { FilesetResolver, FaceDetector } = await import(`${MP_BASE}/vision_bundle.mjs`);
    const fileset = await FilesetResolver.forVisionTasks(`${MP_BASE}/wasm`);
    const make = (delegate) => FaceDetector.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate },
      runningMode: 'VIDEO',
      minDetectionConfidence: 0.5,
    });
    try { return await make('GPU'); } catch { return make('CPU'); }
  })();
  detectorP.catch(() => { detectorP = null; }); // allow a retry after a failed load
  return detectorP;
}

export function cameraErrorText(err) {
  if (!window.isSecureContext) return { title: 'ต้องเปิดเว็บผ่าน HTTPS', text: 'เบราว์เซอร์อนุญาตให้ใช้กล้องเฉพาะเว็บที่เปิดผ่าน HTTPS (หรือ localhost) เท่านั้น' };
  switch (err?.name) {
    case 'NotAllowedError': case 'SecurityError':
      return { title: 'ไม่ได้รับอนุญาตให้ใช้กล้อง', text: 'กรุณาอนุญาตการใช้กล้องสำหรับเว็บไซต์นี้ในการตั้งค่าเบราว์เซอร์ (ไอคอนแม่กุญแจ/กล้องที่แถบที่อยู่) แล้วกด "ลองใหม่"' };
    case 'NotFoundError': case 'OverconstrainedError': case 'DevicesNotFoundError':
      return { title: 'ไม่พบกล้องบนอุปกรณ์นี้', text: 'กรุณาเชื่อมต่อเว็บแคม หรือใช้โทรศัพท์/แท็บเล็ตที่มีกล้องหน้า' };
    case 'NotReadableError': case 'TrackStartError': case 'AbortError':
      return { title: 'กล้องไม่พร้อมใช้งาน', text: 'กล้องอาจถูกใช้งานโดยแอปหรือแท็บอื่นอยู่ กรุณาปิดแอปนั้นแล้วกด "ลองใหม่"' };
    case 'TrackEnded':
      return { title: 'การเชื่อมต่อกล้องถูกตัด', text: 'กล้องหยุดทำงานระหว่างตรวจ กรุณาตรวจสอบกล้องแล้วกด "ลองใหม่"' };
    case 'DetectorLoadError':
      return { title: 'โหลดระบบตรวจจับใบหน้าไม่สำเร็จ', text: 'กรุณาตรวจสอบการเชื่อมต่ออินเทอร์เน็ตแล้วกด "ลองใหม่"' };
    case 'AnchorMismatch':
      return { title: 'กล้องต่างจากตอนปรับเทียบระยะ', text: 'กล้องหรือความละเอียดกล้องไม่ตรงกับตอนปรับเทียบระยะใบหน้า ระบบจึงคำนวณระยะไม่ได้ กรุณาปรับเทียบระยะใบหน้าใหม่ หรือใช้ระยะที่วัดด้วยตลับเมตร' };
    default:
      return { title: 'ไม่สามารถเปิดกล้องได้', text: 'กรุณาลองใหม่อีกครั้ง' };
  }
}

/**
 * Frame analyser shared by the visible face check and the background sampler.
 * Only the part of the frame visible in the 3:4 stage (object-fit: cover) is analysed, and when
 * the face is small (far away) the analysed region zooms 2× or 3× around it, because the
 * detector works on a 128 px image: this keeps faces at 1.5–2 m detectable.
 * Returned coordinates are viewBox units of the (un-mirrored) visible area.
 */
function makeAnalyzer(video, detector) {
  const crop = document.createElement('canvas');
  crop.width = CROP_W;
  crop.height = Math.round((CROP_W * VB.h) / VB.w);
  const ctx = crop.getContext('2d');
  let zoom = 1;
  let misses = 0;
  let centre = { x: TARGET.x, y: TARGET.y };
  return function analyze(ts) {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const vpu = 1 / Math.max(VB.w / vw, VB.h / vh); // video px per viewBox unit
    const ox = (vw - VB.w * vpu) / 2;
    const oy = (vh - VB.h * vpu) / 2;
    const rw = VB.w / zoom;
    const rh = VB.h / zoom;
    const rx = Math.max(0, Math.min(VB.w - rw, centre.x - rw / 2));
    const ry = Math.max(0, Math.min(VB.h - rh, centre.y - rh / 2));
    ctx.drawImage(video, ox + rx * vpu, oy + ry * vpu, rw * vpu, rh * vpu, 0, 0, crop.width, crop.height);
    const dets = detector.detectForVideo(crop, ts).detections;
    const u = rw / crop.width; // viewBox units per crop px
    const faces = dets.filter((d) => d.boundingBox.width >= 24).map((d) => {
      const b = d.boundingBox;
      const pts = (d.keypoints ?? []).map((k) => ({ x: rx + k.x * crop.width * u, y: ry + k.y * crop.height * u }));
      const ipdVb = pts[0] && pts[1] ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : null;
      return {
        cx: rx + (b.originX + b.width / 2) * u,
        cy: ry + (b.originY + b.height / 2) * u,
        w: b.width * u,
        pts,
        // eye spacing / face width in VIDEO px ÷ frame width: independent of preview size and zoom
        ipdNorm: ipdVb ? (ipdVb * vpu) / vw : null,
        faceNorm: (b.width * u * vpu) / vw,
      };
    }).sort((a, b) => b.w - a.w);
    // adapt the zoom for the next frame
    if (!faces.length) {
      if (++misses >= 3) { zoom = zoom >= 3 ? 1 : zoom + 1; misses = 0; if (zoom === 1) centre = { x: TARGET.x, y: TARGET.y }; }
    } else {
      misses = 0;
      const f = faces[0];
      centre = { x: f.cx, y: f.cy };
      zoom = f.w >= 50 ? 1 : f.w >= 26 ? 2 : 3;
    }
    return faces;
  };
}

const ovalPath = `M${OVAL.cx} ${OVAL.cy - OVAL.ry} A${OVAL.rx} ${OVAL.ry} 0 1 1 ${OVAL.cx} ${OVAL.cy + OVAL.ry} A${OVAL.rx} ${OVAL.ry} 0 1 1 ${OVAL.cx} ${OVAL.cy - OVAL.ry}`;

function template({ title, intro, mode, targetCm, allowManual, range }) {
  return `
    <section class="card fc" aria-labelledby="h-fc" data-mode="${mode}">
      <div class="row-between mb-2"><h2 id="h-fc" class="mb-0">${title}</h2>
        <button class="btn btn-ghost btn-sm" type="button" data-fc="cancel">ยกเลิก</button></div>
      <p class="small text-2 mb-3">${intro} ภาพจากกล้องประมวลผลในเครื่องนี้เท่านั้น ไม่มีการส่งหรือบันทึกภาพ</p>
      <div class="fc-stage is-idle" data-fc-stage>
        <video class="fc-video" playsinline muted autoplay aria-hidden="true"></video>
        <svg class="fc-overlay" viewBox="0 0 ${VB.w} ${VB.h}" aria-hidden="true">
          <path class="fc-shade" fill-rule="evenodd" d="M0 0H${VB.w}V${VB.h}H0Z ${ovalPath}"/>
          <path class="fc-oval" d="${ovalPath}"/>
          <path class="fc-progress" d="${ovalPath}" pathLength="100"/>
        </svg>
        <div class="fc-pill" data-fc-pill><span class="fc-spin" aria-hidden="true"></span><span data-fc-pill-text>กำลังเตรียมกล้อง...</span></div>
        ${mode === 'distance' ? '<div class="fc-dist" data-fc-dist hidden><b data-fc-dist-val>–</b><span>ซม.</span></div>' : ''}
        <div class="fc-done-mark" aria-hidden="true">${icons.check}</div>
      </div>
      <div class="fc-guide" aria-live="polite" aria-atomic="true">
        <p class="fc-msg" data-fc-msg>${MESSAGES.loading.text}</p>
        <p class="fc-sub" data-fc-sub>&nbsp;</p>
      </div>
      ${mode === 'anchor' ? '' : `<div class="fc-meter" aria-hidden="true">
        <span>ไกลเกินไป</span><div class="fc-meter-bar"><i class="fc-meter-ok"></i><b class="fc-meter-dot" data-fc-dot></b></div><span>ใกล้เกินไป</span>
      </div>`}
      ${mode === 'distance' ? `<p class="small muted center mt-2 mb-0">ระยะแนะนำ ${targetCm} ซม. (ยืนยันระยะอื่นได้ในช่วง ${Math.round(range[0])}–${Math.round(range[1])} ซม.) · ระยะประเมินจากกล้องโดยอ้างอิงค่าที่ปรับเทียบไว้</p>` : ''}
      <ul class="fc-checks" aria-label="สถานะการตรวจสอบ">
        <li data-check="face">พบใบหน้า</li>
        <li data-check="single">ใบหน้าเดียว</li>
        <li data-check="center">อยู่กึ่งกลางกรอบ</li>
        ${mode === 'anchor' ? '' : '<li data-check="distance">ระยะเหมาะสม</li>'}
        <li data-check="straight">มองตรง</li>
      </ul>
      <div class="fc-error hidden" data-fc-error role="alert"></div>
      <div class="row mt-4 fc-actions">
        <button class="btn" type="button" data-fc="switch" hidden>${icons.swap}สลับกล้อง</button>
        ${mode === 'distance' ? '<button class="btn btn-primary" type="button" data-fc="confirm" disabled>ยืนยันระยะทดสอบ</button>' : ''}
        ${allowManual ? '<button class="btn btn-ghost" type="button" data-fc="manual">ตรวจจับไม่ได้? ใช้ระยะที่วัดด้วยตลับเมตร</button>' : ''}
      </div>
    </section>`;
}

/**
 * Runs a face check inside `container`.
 * opts: { mode: 'frame' | 'anchor' | 'distance', title, intro,
 *         anchorCm (anchor), anchor + targetCm + tolPct (distance), allowManual }
 * Resolves:
 *   { status: 'done', record }       frame  → { faceRatio, camera }
 *                                     anchor → { ipdNorm, video, deviceId, camera }
 *                                     distance → { distanceCm, sdCm, samples }
 *   { status: 'cancel' } | { status: 'skip' } (camera unusable) | { status: 'manual' } (use a tape-measured distance)
 */
export function runFaceCheck(container, opts = {}) {
  const mode = opts.mode ?? 'frame';
  const tolPct = opts.tolPct ?? 0.1;
  container.innerHTML = template({
    mode,
    title: opts.title ?? 'ปรับเทียบระยะด้วยใบหน้า',
    intro: opts.intro ?? 'นั่งหน้าจอในท่าที่จะใช้ทดสอบ วางอุปกรณ์ให้นิ่ง แล้วจัดใบหน้าให้อยู่ในกรอบวงรีตามคำแนะนำ',
    targetCm: opts.targetCm,
    range: opts.range ?? [opts.targetCm * 0.9, opts.targetCm * 1.1],
    allowManual: opts.allowManual,
  });
  const $ = (s) => container.querySelector(s);
  const section = $('.fc');
  const stage = $('[data-fc-stage]');
  const video = $('.fc-video');
  const progress = $('.fc-progress');
  const msgEl = $('[data-fc-msg]');
  const subEl = $('[data-fc-sub]');
  const pill = $('[data-fc-pill]');
  const dot = $('[data-fc-dot]');
  const distBox = $('[data-fc-dist]');
  const errBox = $('[data-fc-error]');
  const switchBtn = $('[data-fc="switch"]');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  // bring the camera view into sight (it opens below the page header / stepper)
  requestAnimationFrame(() => section.scrollIntoView({ block: 'start', behavior: reduced ? 'auto' : 'smooth' }));

  let stream = null;
  let detector = null;
  let raf = 0;
  let finished = false;
  let facing = 'user'; // default: front camera / webcam
  let deviceId = opts.anchor?.deviceId ?? null; // distance mode: reopen the anchored camera
  let mirror = true;
  let lastDetect = 0;
  let smooth = null; // EMA of the face box in viewBox units (+ ipdNorm)
  let shownKey = 'loading';
  let pendingKey = null;
  let pendingSince = 0;
  let holdStart = 0;
  let samples = [];
  let lastEst = null;
  let stillUntil = 0;
  let recent = []; // distance mode: last ~1.2 s of usable estimates for "confirm this distance"
  const range = opts.range ?? [opts.targetCm * 0.9, opts.targetCm * 1.1];
  let resolveFn;
  const result = new Promise((r) => { resolveFn = r; });

  // ---------------------------------------------------------------- UI helpers
  function show(key) {
    const m = key === 'ok' && mode === 'distance' ? MESSAGES.okDistance : MESSAGES[key];
    let sub = m.sub;
    if (key === 'ok' && mode === 'anchor') sub = `อยู่นิ่ง ๆ ที่ระยะ ${opts.anchorCm} ซม. ที่วัดไว้ ระบบกำลังบันทึกค่าอ้างอิง`;
    if (key === 'done' && mode === 'distance') sub = 'วัดระยะเรียบร้อย กำลังเริ่มแบบทดสอบ';
    if (key === 'done' && mode === 'anchor') sub = 'บันทึกค่าอ้างอิงระยะใบหน้าแล้ว';
    if (msgEl.textContent !== m.text) {
      msgEl.classList.remove('is-in');
      void msgEl.offsetWidth; // restart the fade-in
      msgEl.classList.add('is-in');
    }
    msgEl.textContent = m.text;
    subEl.textContent = sub ?? ' ';
    stage.classList.remove('is-idle', 'is-warn', 'is-ok');
    stage.classList.add(`is-${m.tone}`);
    section.dataset.tone = m.tone;
    shownKey = key;
  }
  function setChecks(c) {
    for (const [k, v] of Object.entries(c)) {
      const li = container.querySelector(`[data-check="${k}"]`);
      if (!li) continue;
      li.classList.toggle('is-ok', v === true);
      li.classList.toggle('is-bad', v === false);
    }
  }
  function setPill(text) {
    pill.hidden = !text;
    if (text) $('[data-fc-pill-text]').textContent = text;
  }
  function setProgress(p) { progress.style.strokeDashoffset = String(100 - Math.max(0, Math.min(1, p)) * 100); }
  // meter: 0 = far … 1 = close. frame mode uses face ratio 0.3…1.1, distance mode uses est/target 1.6…0.4
  const meterPos = (v) => (mode === 'distance' ? (1.6 - v) / 1.2 : (v - 0.3) / 0.8);
  function setMeter(v) {
    if (!dot) return;
    if (v == null) { dot.classList.add('is-off'); return; }
    dot.classList.remove('is-off');
    dot.style.left = `${Math.max(0, Math.min(1, meterPos(v))) * 100}%`;
  }
  const okZone = $('.fc-meter-ok');
  if (okZone) {
    const [a, b] = mode === 'distance' ? [meterPos(1 + tolPct), meterPos(1 - tolPct)] : [meterPos(FIT.min), meterPos(FIT.max)];
    okZone.style.cssText = `left:${a * 100}%;width:${(b - a) * 100}%`;
  }
  function setDistance(cm) {
    if (!distBox) return;
    distBox.hidden = cm == null;
    if (cm != null) $('[data-fc-dist-val]').textContent = `≈ ${Math.round(cm)}`;
  }

  // ---------------------------------------------------------------- lifecycle
  function stopCamera() {
    cancelAnimationFrame(raf);
    raf = 0;
    stream?.getTracks().forEach((t) => { t.onended = null; t.stop(); });
    stream = null;
    video.srcObject = null;
  }
  function finish(value) {
    if (finished) return;
    finished = true;
    stopCamera();
    window.removeEventListener('pagehide', stopCamera);
    document.removeEventListener('visibilitychange', onVisibility);
    container.removeEventListener('click', onClick);
    resolveFn(value);
  }
  function onVisibility() {
    if (document.visibilityState === 'visible' && stream && video.paused) video.play().catch(() => {});
  }
  function showError(err) {
    stopCamera();
    const e = cameraErrorText(err);
    stage.classList.add('is-error');
    setPill('');
    setDistance(null);
    show('loading');
    msgEl.textContent = e.title;
    subEl.textContent = ' ';
    setChecks({ face: null, single: null, center: null, distance: null, straight: null });
    errBox.classList.remove('hidden');
    const skipLabel = mode === 'distance' ? 'ใช้ระยะที่วัดด้วยตลับเมตรแทน' : mode === 'anchor' ? 'ข้ามการปรับเทียบระยะใบหน้า' : 'ทำแบบทดสอบโดยไม่ตรวจตำแหน่งใบหน้า';
    errBox.innerHTML = `<div class="alert alert-warning">${icons.alert}<div><strong>${e.title}</strong><br>${e.text}
      <div class="row mt-3"><button class="btn btn-primary btn-sm" type="button" data-fc="retry">${icons.refresh}ลองใหม่</button>
      <button class="btn btn-sm" type="button" data-fc="skip">${skipLabel}</button></div></div></div>`;
  }

  async function start() {
    errBox.classList.add('hidden');
    errBox.innerHTML = '';
    stage.classList.remove('is-error', 'is-done');
    show('loading');
    setPill('กำลังเปิดกล้อง...');
    setProgress(0);
    setMeter(null);
    setDistance(null);
    smooth = null; holdStart = 0; samples = []; pendingKey = null;
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) { showError({ name: window.isSecureContext ? 'NotFoundError' : 'SecurityError' }); return; }
    const detP = loadDetector(); // download the model while the user answers the permission prompt
    const size = mode === 'distance' && opts.anchor?.video
      ? { width: { ideal: opts.anchor.video.w }, height: { ideal: opts.anchor.video.h } }
      : { width: { ideal: 1280 }, height: { ideal: 720 } };
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { ...(deviceId ? { deviceId: { ideal: deviceId } } : { facingMode: { ideal: facing } }), ...size },
      });
    } catch (err) { if (!finished) showError(err); return; }
    if (finished) { stopCamera(); return; }
    const track = stream.getVideoTracks()[0];
    track.onended = () => { if (!finished) showError({ name: 'TrackEnded' }); };
    const settings = track.getSettings();
    // laptops' webcams usually report no facingMode: treat them as a front camera (mirrored)
    mirror = settings.facingMode ? settings.facingMode === 'user' : facing !== 'environment';
    video.classList.toggle('mirror', mirror);
    video.srcObject = stream;
    try { await video.play(); } catch { /* autoplay with muted+playsinline normally succeeds */ }

    navigator.mediaDevices.enumerateDevices?.().then((list) => {
      switchBtn.hidden = mode === 'distance' || list.filter((d) => d.kind === 'videoinput').length < 2;
    }).catch(() => {});

    // a distance can only be computed with the same camera and image size as the anchor
    if (mode === 'distance') {
      const a = opts.anchor;
      const sameCam = !a.deviceId || !settings.deviceId || a.deviceId === settings.deviceId;
      if (!sameCam || video.videoWidth !== a.video.w || video.videoHeight !== a.video.h) { showError({ name: 'AnchorMismatch' }); return; }
    }

    setPill('กำลังโหลดระบบตรวจจับใบหน้า...');
    try { detector = await detP; } catch (err) { console.error(err); if (!finished) showError({ name: 'DetectorLoadError' }); return; }
    if (finished || !stream) return;
    setPill('');
    show('none');
    lastDetect = 0;
    raf = requestAnimationFrame(loop);
  }

  // ---------------------------------------------------------------- detection
  let analyze = null;
  const toBox = (f) => {
    const mx = (x) => (mirror ? VB.w - x : x);
    const pt = (i) => (f.pts[i] ? { x: mx(f.pts[i].x), y: f.pts[i].y } : null);
    return { x: mx(f.cx), y: f.cy, w: f.w, eyeA: pt(0), eyeB: pt(1), nose: pt(2), ipdNorm: f.ipdNorm, faceNorm: f.faceNorm };
  };

  function classify(faces) {
    const prevOk = shownKey === 'ok';
    const k = prevOk ? HYST : 1;
    const none = { face: false, single: null, center: null, distance: null, straight: null };
    if (!faces.length) return { key: 'none', checks: none };
    if (faces.length > 1) return { key: 'multi', checks: { ...none, face: true, single: false } };
    const f = smooth;
    const ratio = f.w / (OVAL.rx * 2);
    const dx = (f.x - TARGET.x) / (OVAL.rx * 2);
    const dy = (f.y - TARGET.y) / (OVAL.ry * 2);
    let tooClose;
    let tooFar;
    let est = null;
    if (mode === 'distance' && f.ipdNorm) {
      est = estimateDistanceCm(opts.anchor, f.ipdNorm, f.faceNorm);
      const t = tolPct * k;
      tooClose = est < opts.targetCm * (1 - t);
      tooFar = est > opts.targetCm * (1 + t);
    } else {
      const fit = mode === 'frame' ? FIT : LOOSE;
      tooClose = ratio > fit.max + (prevOk ? 0.03 : 0);
      tooFar = ratio < fit.min - (prevOk ? 0.03 : 0);
    }
    const offX = Math.abs(dx) > TOL.x * k;
    const offY = Math.abs(dy) > TOL.y * k;
    let turned = false;
    if (f.eyeA && f.eyeB && f.nose) {
      const ex = f.eyeB.x - f.eyeA.x;
      const ey = f.eyeB.y - f.eyeA.y;
      const dist = Math.hypot(ex, ey) || 1;
      const yaw = (f.nose.x - (f.eyeA.x + f.eyeB.x) / 2) / dist;
      let roll = Math.abs((Math.atan2(ey, ex) * 180) / Math.PI);
      if (roll > 90) roll = 180 - roll; // eye order flips when mirrored
      turned = Math.abs(yaw) > TURN.yaw * k || roll > TURN.rollDeg * k;
    }
    const checks = { face: true, single: true, center: !offX && !offY, distance: !tooClose && !tooFar, straight: !turned };
    // the screen is a mirror for the front camera: face on the left of the screen → move to the right.
    // With the rear camera the image is not mirrored, so the direction (for the person being tested) flips.
    const horizontal = ((dx < 0) === mirror) ? 'goRight' : 'goLeft';
    let key = 'ok';
    if (tooClose) key = 'close';
    else if (offX) key = horizontal;
    else if (offY) key = dy < 0 ? 'high' : 'low';
    else if (tooFar) key = 'far';
    else if (turned) key = 'turn';
    if (mode === 'distance' && !f.ipdNorm) key = 'turn'; // eyes not located: cannot measure
    return { key, checks, ratio, est };
  }

  function loop(now) {
    if (finished || !stream) return;
    raf = requestAnimationFrame(loop);
    if (now - lastDetect < DETECT_EVERY_MS || video.readyState < 2 || !video.videoWidth) return;
    lastDetect = now;
    let dets;
    analyze ??= makeAnalyzer(video, detector);
    try { dets = analyze(now); } catch (err) { console.error(err); return; }
    const faces = dets.map(toBox);

    let moved = Infinity;
    if (faces.length === 1) {
      const f = faces[0];
      if (!smooth) smooth = { ...f };
      else {
        moved = Math.hypot(f.x - smooth.x, f.y - smooth.y);
        const a = 0.45;
        const ipd = f.ipdNorm && smooth.ipdNorm ? smooth.ipdNorm + (f.ipdNorm - smooth.ipdNorm) * 0.35 : f.ipdNorm;
        const fn = smooth.faceNorm ? smooth.faceNorm + (f.faceNorm - smooth.faceNorm) * 0.35 : f.faceNorm;
        smooth = { ...f, x: smooth.x + (f.x - smooth.x) * a, y: smooth.y + (f.y - smooth.y) * a, w: smooth.w + (f.w - smooth.w) * a, ipdNorm: ipd, faceNorm: fn };
      }
    } else smooth = null;

    const c = classify(faces);
    const { checks, ratio, est } = c;
    let { key } = c;
    // unstable: the face (or, in distance mode, the estimate) is still moving
    const jump = est != null && lastEst != null ? Math.abs(est - lastEst) / est : 0;
    lastEst = est;
    if (moved !== Infinity && (moved > MOVE_RESET || jump > 0.04)) stillUntil = now + 700;
    if (key === 'ok' && now < stillUntil) key = 'still';
    if (mode === 'distance') trackConfirm(now, key, c);
    setChecks(checks);
    if (mode === 'distance') { setMeter(est != null ? est / opts.targetCm : null); setDistance(est); } else setMeter(faces.length === 1 ? ratio : null);

    // debounce the message so it never flickers
    if (key !== shownKey) {
      if (pendingKey !== key) { pendingKey = key; pendingSince = now; }
      if (now - pendingSince >= SWITCH_MS) { show(key); pendingKey = null; }
    } else pendingKey = null;

    // stability: correct position must be held continuously
    if (shownKey === 'ok' && key === 'ok') {
      if (!holdStart || moved > MOVE_RESET) { holdStart = now; samples = []; }
      samples.push({ ratio, ipdNorm: faces[0].ipdNorm, faceNorm: faces[0].faceNorm, est });
      const p = (now - holdStart) / HOLD_MS[mode];
      setProgress(p);
      if (p >= 1) complete();
    } else if (holdStart) {
      holdStart = 0;
      samples = [];
      setProgress(0);
    }
  }

  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const sd = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };

  /** Enables "confirm" once one centred, straight face has given a steady estimate inside the allowed range. */
  function trackConfirm(now, key, c) {
    const btn = container.querySelector('[data-fc="confirm"]');
    const usable = c.est != null && c.checks.single && c.checks.center && c.checks.straight && key !== 'still' && c.est >= range[0] && c.est <= range[1];
    if (usable) recent.push({ t: now, est: c.est }); else recent = [];
    recent = recent.filter((x) => now - x.t <= 1200);
    const ests = recent.map((x) => x.est);
    const steady = recent.length >= 8 && now - recent[0].t >= 900 && sd(ests) / mean(ests) <= 0.03;
    if (!btn) return;
    btn.disabled = !steady;
    btn.textContent = steady ? `ยืนยันระยะทดสอบ ≈ ${Math.round(mean(ests))} ซม.` : 'ยืนยันระยะทดสอบ';
  }
  function confirmCurrent() {
    const ests = recent.map((x) => x.est);
    if (ests.length < 8) return;
    stopCamera();
    show('done');
    stage.classList.add('is-done');
    setProgress(1);
    const record = { distanceCm: Math.round(mean(ests) * 10) / 10, sdCm: Math.round(sd(ests) * 10) / 10, samples: ests.length, confirmed: true };
    setTimeout(() => finish({ status: 'done', record }), reduced ? 200 : 700);
  }

  function complete() {
    const camSettings = stream?.getVideoTracks()[0]?.getSettings() ?? {};
    let record;
    if (mode === 'anchor') {
      const ipds = samples.map((s) => s.ipdNorm).filter(Boolean);
      if (ipds.length < 5) { holdStart = 0; samples = []; return; }
      record = {
        anchorCm: opts.anchorCm,
        ipdNorm: Math.round(mean(ipds) * 1e6) / 1e6,
        faceNorm: Math.round(mean(samples.map((s) => s.faceNorm)) * 1e6) / 1e6,
        ipdCv: Math.round((sd(ipds) / mean(ipds)) * 1000) / 1000, // spread of the samples (quality)
        video: { w: video.videoWidth, h: video.videoHeight },
        deviceId: camSettings.deviceId ?? null,
        camera: mirror ? 'front' : 'rear',
      };
    } else if (mode === 'distance') {
      const ests = samples.map((s) => s.est).filter(Boolean);
      if (ests.length < 5) { holdStart = 0; samples = []; return; }
      record = { distanceCm: Math.round(mean(ests) * 10) / 10, sdCm: Math.round(sd(ests) * 10) / 10, samples: ests.length };
    } else {
      record = { faceRatio: Math.round(mean(samples.map((s) => s.ratio)) * 1000) / 1000, camera: mirror ? 'front' : 'rear' };
    }
    stopCamera();
    setProgress(1);
    show('done');
    stage.classList.add('is-done');
    setTimeout(() => finish({ status: 'done', record }), reduced ? 300 : 1100);
  }

  /** Next camera: front ↔ rear on phones, next webcam on computers with several cameras. */
  async function switchCamera() {
    const current = stream?.getVideoTracks()[0]?.getSettings().deviceId;
    let cams = [];
    try { cams = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput' && d.deviceId); } catch { /* ignore */ }
    const i = cams.findIndex((d) => d.deviceId === current);
    if (cams.length > 1 && i >= 0) { deviceId = cams[(i + 1) % cams.length].deviceId; facing = null; }
    else { deviceId = null; facing = mirror ? 'environment' : 'user'; }
    stopCamera();
    start();
  }

  // ---------------------------------------------------------------- events
  function onClick(e) {
    const a = e.target.closest('[data-fc]')?.dataset.fc;
    if (!a) return;
    if (a === 'cancel') finish({ status: 'cancel' });
    else if (a === 'skip') finish({ status: mode === 'distance' ? 'manual' : 'skip' });
    else if (a === 'manual') finish({ status: 'manual' });
    else if (a === 'confirm') confirmCurrent();
    else if (a === 'retry') { stopCamera(); start(); }
    else if (a === 'switch') switchCamera();
  }
  container.addEventListener('click', onClick);
  window.addEventListener('pagehide', stopCamera);
  document.addEventListener('visibilitychange', onVisibility);

  start();
  return result;
}

// =====================================================================
// Background sampler (no on-screen preview): used by the in-test distance monitor and by the
// blind-spot calibration. Reports eye spacing / face width of exactly one visible face.
// =====================================================================
export async function startFaceSampler({ deviceId = null, size = null, everyMs = 120, onSample }) {
  const detP = loadDetector();
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      ...(deviceId ? { deviceId: { ideal: deviceId } } : { facingMode: { ideal: 'user' } }),
      ...(size ? { width: { ideal: size.w }, height: { ideal: size.h } } : { width: { ideal: 1280 }, height: { ideal: 720 } }),
    },
  });
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.setAttribute('playsinline', '');
  video.className = 'fc-hidden-video';
  video.setAttribute('aria-hidden', 'true');
  document.body.append(video);
  video.srcObject = stream;
  const stopAll = () => { stream.getTracks().forEach((t) => t.stop()); video.remove(); };
  let detector;
  try {
    await video.play().catch(() => {});
    if (!video.videoWidth) await new Promise((r) => video.addEventListener('loadedmetadata', r, { once: true }));
    detector = await detP;
  } catch (err) { stopAll(); throw Object.assign(err ?? new Error('detector'), { name: err?.name ?? 'DetectorLoadError' }); }

  const analyze = makeAnalyzer(video, detector);
  const timer = setInterval(() => {
    if (video.readyState < 2 || !video.videoWidth) return;
    let faces;
    try { faces = analyze(performance.now()); } catch { return; }
    if (faces.length !== 1) { onSample({ faces: faces.length }); return; }
    onSample({ faces: 1, ipdNorm: faces[0].ipdNorm, faceNorm: faces[0].faceNorm, t: performance.now() });
  }, everyMs);
  const settings = stream.getVideoTracks()[0].getSettings();
  return {
    stop() { clearInterval(timer); stopAll(); },
    video: { w: video.videoWidth, h: video.videoHeight },
    deviceId: settings.deviceId ?? null,
    camera: settings.facingMode === 'environment' ? 'rear' : 'front',
  };
}

/**
 * Watches the viewing distance during a test. status: 'ok' | 'far' | 'close' (outside
 * lockedCm ± tolPct for longer than graceMs) | 'noface' | 'multi'. Throws AnchorMismatch when
 * the camera differs from the calibrated one.
 */
export async function startDistanceMonitor({ anchor, lockedCm, tolPct = 0.15, graceMs = 1500, onUpdate }) {
  const st = { samples: 0, valid: 0, maxDev: 0, warnings: 0, outMs: 0 };
  let ipdS = null;
  let faceS = null;
  let offSince = 0;
  let warned = false;
  let lastT = 0;
  const sampler = await startFaceSampler({
    deviceId: anchor.deviceId,
    size: anchor.video,
    onSample: (s) => {
      st.samples++;
      const t = performance.now();
      const dt = lastT ? t - lastT : 0;
      lastT = t;
      if (s.faces !== 1 || !s.ipdNorm) { onUpdate?.({ status: s.faces > 1 ? 'multi' : 'noface' }); return; }
      ipdS = ipdS ? ipdS + (s.ipdNorm - ipdS) * 0.4 : s.ipdNorm;
      faceS = faceS ? faceS + (s.faceNorm - faceS) * 0.4 : s.faceNorm;
      const est = estimateDistanceCm(anchor, ipdS, faceS);
      st.valid++;
      const dev = (est - lockedCm) / lockedCm;
      st.maxDev = Math.max(st.maxDev, Math.abs(dev));
      let status = 'ok';
      if (Math.abs(dev) > tolPct) {
        if (!offSince) offSince = t;
        if (t - offSince >= graceMs) {
          status = dev > 0 ? 'far' : 'close';
          if (!warned) { st.warnings++; warned = true; }
          st.outMs += dt;
        }
      } else { offSince = 0; warned = false; }
      onUpdate?.({ status, est });
    },
  });
  if (sampler.video.w !== anchor.video.w || sampler.video.h !== anchor.video.h || (anchor.deviceId && sampler.deviceId && sampler.deviceId !== anchor.deviceId)) {
    sampler.stop();
    throw Object.assign(new Error('anchor mismatch'), { name: 'AnchorMismatch' });
  }
  const r1 = (v) => Math.round(v * 10) / 10;
  return {
    stop: () => sampler.stop(),
    stats: () => ({ samples: st.samples, valid: st.valid, max_dev_pct: r1(st.maxDev * 100), warnings: st.warnings, out_of_range_s: r1(st.outMs / 1000) }),
  };
}
