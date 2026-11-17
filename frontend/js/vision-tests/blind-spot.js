/**
 * Viewing-distance calibration without a tape measure: the blind-spot method
 * ("Virtual Chinrest", Li, Joo, Yeatman & Reinecke, Scientific Reports 2020).
 *
 * With the right eye closed, the left eye fixates a square near the right edge while a red dot
 * moves slowly to the left. The dot vanishes when it enters the optic-disc blind spot, which
 * lies ≈ 13.5° temporal to fixation. With the dot–square separation in millimetres (from the
 * ruler-calibrated px/mm), distance = separation / tan(13.5°).
 * The camera runs at the same time, so each trial pairs a distance with the face size in the
 * image: this becomes the anchor of the face-distance estimate (same as a tape measurement).
 *
 * Requires a calibrated screen (px/mm) and a screen wide enough for the separation.
 */
import { icons } from '../icons.js';
import { startFaceSampler, cameraErrorText } from './face-calibration.js';

export const BLIND_SPOT_DEG = 13.5;
const TAN = Math.tan((BLIND_SPOT_DEG * Math.PI) / 180);
const SPEED_MM_S = 15; // slow, so the reaction delay adds only a few millimetres
const START_SEP_MM = 30;
const MARGIN_MM = 12;
const TRIALS = 5;
const VALID_CM = [20, 120];
const MIN_SEP_MM = 100; // ≈ 42 cm: smaller screens cannot measure a normal viewing distance

const median = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };

/** Largest dot–square separation (mm) the current window allows. */
export function blindSpotCapacity(pxPerMm) {
  const maxSepMm = window.innerWidth / pxPerMm - 2 * MARGIN_MM - 4;
  return { maxSepMm, maxCm: maxSepMm / TAN / 10, ok: maxSepMm >= MIN_SEP_MM };
}

/** Resolves { status: 'done', record } | { status: 'cancel' } */
export function runBlindSpotCalibration(container, { pxPerMm }) {
  let resolveFn;
  const result = new Promise((r) => { resolveFn = r; });
  let sampler = null;
  let samplerInfo = null;
  let camSamples = [];
  let overlay = null;
  const cleanup = () => { sampler?.stop(); sampler = null; overlay?.remove(); overlay = null; document.removeEventListener('keydown', onKey); };
  const done = (v) => { cleanup(); container.onclick = null; resolveFn(v); };
  let onKey = () => {};

  function intro(errorHtml = '') {
    const cap = blindSpotCapacity(pxPerMm);
    container.innerHTML = `<section class="card" aria-labelledby="h-bs">
      <div class="row-between mb-2"><h2 id="h-bs" class="mb-0">วัดระยะด้วยจุดบอดของตา (ไม่ต้องใช้ตลับเมตร)</h2><button class="btn btn-ghost btn-sm" type="button" data-bs="cancel">ยกเลิก</button></div>
      <p class="text-2">ตาทุกคนมี "จุดบอด" อยู่ห่างจากจุดที่มองตรงประมาณ ${BLIND_SPOT_DEG}° ระบบใช้มุมนี้ร่วมกับขนาดหน้าจอที่ปรับเทียบด้วยไม้บรรทัดคำนวณระยะดวงตาถึงหน้าจอ (วิธี Virtual Chinrest)
        พร้อมกับให้กล้องบันทึกขนาดใบหน้าที่ระยะนั้น เพื่อใช้วัดระยะแบบ Real-time ภายหลัง</p>
      ${errorHtml}
      ${cap.ok ? '' : `<div class="alert alert-warning">${icons.alert}<div><strong>หน้าจอแคบเกินไปสำหรับวิธีนี้</strong> ต้องมีพื้นที่กว้างอย่างน้อยประมาณ ${Math.round((MIN_SEP_MM + 2 * MARGIN_MM) / 10)} ซม.
        กรุณาหมุนอุปกรณ์เป็นแนวนอน ขยายหน้าต่างเบราว์เซอร์ หรือใช้วิธีวัดด้วยตลับเมตร</div></div>`}
      <ol>
        <li>นั่งในท่าที่จะใช้ทดสอบ ห่างหน้าจอประมาณ 40–60 ซม. วางอุปกรณ์ให้นิ่ง และอยู่นิ่งตลอดการวัด</li>
        <li><strong>หลับตาขวา</strong> (ไม่ต้องใช้มือปิด เพื่อให้กล้องเห็นใบหน้า)</li>
        <li>ใช้ตาซ้ายจ้อง<strong>สี่เหลี่ยมสีดำทางขวา</strong>ตลอดเวลา จุดสีแดงจะเคลื่อนไปทางซ้ายช้า ๆ</li>
        <li>เมื่อจุดสีแดง<strong>หายไป</strong> ให้กด Spacebar หรือแตะปุ่ม "จุดหายไปแล้ว" ทันที (ทำ ${TRIALS} ครั้ง)</li>
      </ol>
      <div class="row mt-4"><button class="btn btn-primary" type="button" data-bs="start" ${cap.ok ? '' : 'disabled'}>${icons.camera}เริ่มวัด</button></div>
    </section>`;
    container.onclick = (e) => {
      const a = e.target.closest('[data-bs]')?.dataset.bs;
      if (a === 'cancel') done({ status: 'cancel' });
      if (a === 'start') start();
    };
  }

  async function start() {
    try {
      sampler = await startFaceSampler({ onSample: (s) => { if (s.faces === 1 && s.ipdNorm) camSamples.push(s); } });
      samplerInfo = { video: sampler.video, deviceId: sampler.deviceId, camera: sampler.camera }; // kept for the anchor record
    } catch (err) {
      const e = cameraErrorText(err);
      intro(`<div class="alert alert-warning">${icons.alert}<div><strong>${e.title}</strong><br>${e.text}</div></div>`);
      return;
    }
    const trials = [];
    for (let i = 0; i < TRIALS + 3 && trials.length < TRIALS; i++) {
      const r = await trial(i, trials.length);
      if (r === 'cancel') { done({ status: 'cancel' }); return; }
      if (r) trials.push(r);
    }
    finishTrials(trials);
  }

  /** One sweep. Resolves { cm, ipdNorm, faceNorm } | null (no response) | 'cancel' */
  function trial(i, doneCount) {
    overlay?.remove();
    overlay = document.createElement('div');
    overlay.className = 'bs-overlay';
    overlay.innerHTML = `
      <div class="bs-top"><span>ครั้งที่ ${doneCount + 1}/${TRIALS} · หลับตาขวา จ้องสี่เหลี่ยมสีดำด้วยตาซ้าย</span><button class="btn btn-sm" type="button" data-bs="cancel">ยกเลิก</button></div>
      <div class="bs-field"><i class="bs-fix"></i><i class="bs-dot"></i></div>
      <button class="btn btn-primary btn-lg bs-hit" type="button" data-bs="hit">จุดหายไปแล้ว (Spacebar)</button>`;
    document.body.append(overlay);
    const field = overlay.querySelector('.bs-field');
    const fix = overlay.querySelector('.bs-fix');
    const dot = overlay.querySelector('.bs-dot');
    const W = field.clientWidth;
    const fixX = W - MARGIN_MM * pxPerMm; // centre of the fixation square
    const minX = MARGIN_MM * pxPerMm;
    fix.style.cssText = `left:${fixX}px;width:${6 * pxPerMm}px;height:${6 * pxPerMm}px`;
    dot.style.width = dot.style.height = `${5 * pxPerMm}px`;
    return new Promise((resolve) => {
      let raf = 0;
      let t0 = 0;
      let x = fixX - START_SEP_MM * pxPerMm;
      let ended = false;
      const end = (v) => { if (ended) return; ended = true; cancelAnimationFrame(raf); setTimeout(() => resolve(v), 350); };
      const respond = () => {
        const sepMm = (fixX - x) / pxPerMm;
        const cm = sepMm / TAN / 10;
        const now = performance.now();
        const cams = camSamples.filter((s) => now - s.t <= 600);
        dot.classList.add('is-hit');
        if (cm < VALID_CM[0] || cm > VALID_CM[1] || !cams.length) { end(null); return; }
        end({ cm, sepMm, ipdNorm: median(cams.map((s) => s.ipdNorm)), faceNorm: median(cams.map((s) => s.faceNorm)) });
      };
      onKey = (e) => { if (e.code === 'Space') { e.preventDefault(); respond(); } };
      document.addEventListener('keydown', onKey);
      overlay.onclick = (e) => {
        const a = e.target.closest('[data-bs]')?.dataset.bs;
        if (a === 'cancel') end('cancel');
        if (a === 'hit') respond();
      };
      const step = (t) => {
        if (!t0) t0 = t;
        x = fixX - (START_SEP_MM + (SPEED_MM_S * (t - t0)) / 1000) * pxPerMm;
        if (x <= minX) { end(null); return; } // reached the edge: no response
        dot.style.left = `${x}px`;
        raf = requestAnimationFrame(step);
      };
      setTimeout(() => { if (!ended) raf = requestAnimationFrame(step); }, 600); // short pause before each sweep
    }).finally(() => document.removeEventListener('keydown', onKey));
  }

  function finishTrials(trials) {
    overlay?.remove();
    overlay = null;
    sampler?.stop();
    sampler = null;
    const errBox = (t) => `<div class="alert alert-warning mt-3">${icons.alert}<div>${t}</div></div>`;
    if (trials.length < 3) { camSamples = []; intro(errBox('วัดได้ไม่ครบ (ต้องมีอย่างน้อย 3 ครั้งที่ตอบทันและกล้องเห็นใบหน้า) กรุณาลองใหม่')); return; }
    const med = median(trials.map((t) => t.cm));
    const kept = trials.filter((t) => Math.abs(t.cm - med) / med <= 0.15);
    const cms = kept.map((t) => t.cm);
    const cv = kept.length ? sd(cms) / mean(cms) : 1;
    if (kept.length < 3 || cv > 0.1) { camSamples = []; intro(errBox(`ผลแต่ละครั้งต่างกันมากเกินไป (ผันแปร ${Math.round(cv * 100)}%) กรุณาอยู่นิ่งและจ้องสี่เหลี่ยมตลอด แล้วลองใหม่`)); return; }
    const anchorCm = mean(cms);
    // pair each trial's distance with the face size seen at that moment (d × size is constant)
    const kIpd = median(kept.map((t) => t.cm * t.ipdNorm));
    const kFace = median(kept.map((t) => t.cm * t.faceNorm));
    const ipds = kept.map((t) => t.ipdNorm);
    done({
      status: 'done',
      record: {
        method: 'blind_spot',
        anchorCm: Math.round(anchorCm * 10) / 10,
        ipdNorm: Math.round((kIpd / anchorCm) * 1e6) / 1e6,
        faceNorm: Math.round((kFace / anchorCm) * 1e6) / 1e6,
        ipdCv: Math.round((sd(ipds) / mean(ipds)) * 1000) / 1000,
        trialsCm: cms.map((c) => Math.round(c * 10) / 10),
        trialCv: Math.round(cv * 1000) / 1000,
        video: samplerInfo.video,
        deviceId: samplerInfo.deviceId,
        camera: samplerInfo.camera,
      },
    });
  }

  intro();
  requestAnimationFrame(() => container.querySelector('section')?.scrollIntoView({ block: 'start' }));
  return result;
}
