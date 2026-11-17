/**
 * Shared helpers for on-screen vision tests.
 * Screen tests are approximations: they depend on the screen calibration, the
 * viewing distance and display quality — never a substitute for standard testing.
 */
export const DEFAULT_FAR_DISTANCE_CM = 100;
const ARCMIN = Math.PI / (180 * 60);
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};
// records written by earlier versions (unverified formats) are discarded
['ec_vt_calibration', 'ec_vt_face_calibration'].forEach((k) => store.del(k));

// =====================================================================
// 1. Physical screen calibration (px/mm) — measured against a reference
//    ruler. Records made earlier with an ID-1 card stay valid (same px/mm meaning).
//    Kept separate from the face-distance data below.
// =====================================================================
const SCREEN_KEY = 'ec_vt_screen_calibration';
export const STANDARD_PX_PER_MM = 96 / 25.4; // CSS reference pixel — used only when not calibrated
export const PX_PER_MM_RANGE = { min: 1.2, max: 12 }; // plausible CSS px per mm (TV … phone)

/** What makes a px/mm value valid: browser zoom (DPR) and the display (screen size in CSS px). */
export function screenFingerprint() {
  return { dpr: Math.round(window.devicePixelRatio * 1000) / 1000, sw: screen.width, sh: screen.height };
}

/**
 * { status: 'none' | 'ok' | 'stale', record, reason }
 * 'stale' = the record was made with another zoom level / display: it must not be used.
 */
export function screenCalibrationState() {
  const record = store.get(SCREEN_KEY);
  if (!record?.pxPerMm || record.status !== 'calibrated') return { status: 'none', record: null };
  const now = screenFingerprint();
  const was = record.fingerprint ?? {};
  if (Math.abs(now.dpr - was.dpr) > 0.01) return { status: 'stale', record, reason: 'ระดับการซูมของเบราว์เซอร์หรือความละเอียดหน้าจอเปลี่ยนไปจากตอนปรับเทียบ' };
  const sameScreen = (now.sw === was.sw && now.sh === was.sh) || (now.sw === was.sh && now.sh === was.sw); // rotation is fine
  if (!sameScreen) return { status: 'stale', record, reason: 'หน้าจอหรืออุปกรณ์เปลี่ยนไปจากตอนปรับเทียบ' };
  return { status: 'ok', record };
}
export const saveScreenCalibration = (r) => store.set(SCREEN_KEY, r);
export const clearScreenCalibration = () => store.del(SCREEN_KEY);

/** CSS px per real millimetre: the calibrated value, or the standard CSS pixel in standard mode. */
export function pxPerMm() {
  const s = screenCalibrationState();
  return s.status === 'ok' ? s.record.pxPerMm : STANDARD_PX_PER_MM;
}
/** Pinch-zoom (mobile) enlarges everything on screen without changing px/mm. */
export const isPinchZoomed = () => (window.visualViewport?.scale ?? 1) > 1.02;

/** Snapshot stored with each test result. */
export function screenSnapshot() {
  const s = screenCalibrationState();
  const r = s.status === 'ok' ? s.record : null;
  return {
    status: r ? 'calibrated' : 'standard',
    method: r?.method ?? null,
    reference_mm: r?.reference.mm ?? null,
    verified: r ? Boolean(r.verified) : null,
    px_per_mm: Math.round(pxPerMm() * 1000) / 1000,
    dpr: screenFingerprint().dpr,
    screen_w: screen.width,
    screen_h: screen.height,
    viewport_w: window.innerWidth,
    viewport_h: window.innerHeight,
    calibrated_at: r ? new Date(r.at).toISOString() : null,
  };
}

// =====================================================================
// 2. Face-distance anchor: eye spacing in the camera image at ONE distance
//    measured with a tape / ruler. distance = anchorCm × ipd0 / ipd (pinhole
//    camera). Eye spacing differs between people, so the anchor is per subject.
// =====================================================================
const ANCHOR_KEY = 'ec_vt_distance_anchor';
const ANCHOR_VALID_MS = 24 * 60 * 60 * 1000;
export function getDistanceAnchor(subjectKey) {
  const a = store.get(ANCHOR_KEY);
  if (!a?.ipdNorm || a.subject !== subjectKey || Date.now() - a.at > ANCHOR_VALID_MS) return null;
  return a;
}
export const saveDistanceAnchor = (a) => store.set(ANCHOR_KEY, a);
/**
 * Two size cues that both scale with 1 / distance: eye spacing and face width (each as a
 * fraction of the frame width). Averaging them reduces the keypoint noise of small faces.
 */
export function estimateDistanceCm(anchor, ipdNorm, faceNorm) {
  const byEyes = (anchor.anchorCm * anchor.ipdNorm) / ipdNorm;
  if (!anchor.faceNorm || !faceNorm) return byEyes;
  return (byEyes + (anchor.anchorCm * anchor.faceNorm) / faceNorm) / 2;
}

/** Viewing distance target for the far visual-acuity test (user setting). */
const FAR_KEY = 'ec_vt_far_distance_cm';
export function getFarDistance() {
  const d = Number(store.get(FAR_KEY));
  return d >= 50 && d <= 600 ? d : DEFAULT_FAR_DISTANCE_CM;
}
export const saveFarDistance = (d) => store.set(FAR_KEY, d);

// =====================================================================
// 3. Optotype geometry
// =====================================================================
/** Letter height (mm) subtending 5′ × MAR at the given distance (cm). */
export function optotypeMm(logmar, distanceCm) {
  return distanceCm * 10 * Math.tan(5 * ARCMIN * 10 ** logmar);
}
/** Letter height in CSS px on this screen. */
export function optotypePx(logmar, distanceCm) {
  return optotypeMm(logmar, distanceCm) * pxPerMm();
}
/** Size actually drawn: canvases use whole device pixels, so report the real rendered size. */
export function renderedOptotype(logmar, distanceCm) {
  const dpr = window.devicePixelRatio || 1;
  const devicePx = Math.round(optotypePx(logmar, distanceCm) * dpr);
  const cssPx = devicePx / dpr;
  return { devicePx, cssPx, mm: cssPx / pxPerMm(), targetMm: optotypeMm(logmar, distanceCm) };
}
export const snellen20 = (logmar) => `20/${Math.round(20 * 10 ** logmar)}`;

export function snellen(logmar) {
  return `6/${Math.round(6 * 10 ** logmar)}`;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export function shuffle(a) {
  const arr = [...a];
  for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
  return arr;
}

export const EYE_TH = { right: 'ตาขวา', left: 'ตาซ้าย' };
export const coverText = (eye) => `กรุณาปิด${eye === 'right' ? 'ตาซ้าย' : 'ตาขวา'}ด้วยฝ่ามือ (ไม่กดลูกตา) แล้วทดสอบด้วย${EYE_TH[eye]}`;

/** Wait for one click on an element matching `selector` inside root; resolves its dataset. */
export function waitChoice(root, selector) {
  return new Promise((resolve) => {
    const onClick = (e) => {
      const b = e.target.closest(selector);
      if (!b || !root.contains(b)) return;
      root.removeEventListener('click', onClick);
      document.removeEventListener('keydown', onKey);
      resolve({ ...b.dataset });
    };
    const onKey = (e) => {
      const map = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
      const dir = map[e.key];
      const b = dir ? root.querySelector(`${selector}[data-dir="${dir}"]`) : null;
      if (b) { e.preventDefault(); b.click(); }
    };
    root.addEventListener('click', onClick);
    document.addEventListener('keydown', onKey);
  });
}
