/**
 * Physical screen calibration with a ruler: how many CSS pixels make one real millimetre on
 * THIS screen at the current browser zoom. The user stretches an on-screen line until it
 * matches 5 or 10 cm on a real ruler, then verifies a drawn 50 mm bar with the same ruler.
 * Nothing is guessed: without a match the tests stay in standard mode. devicePixelRatio is
 * only recorded to detect zoom / display changes; the camera is never used for screen size.
 */
import { icons } from '../icons.js';
import { PX_PER_MM_RANGE, STANDARD_PX_PER_MM, screenFingerprint, isPinchZoomed, optotypeMm, snellen20, getFarDistance } from './common.js';

const STEP_PX = 0.5;
const fmt = (n, d = 1) => Number(n).toLocaleString('th-TH', { minimumFractionDigits: d, maximumFractionDigits: d });

/** Resolves { status: 'done', record } | { status: 'cancel' } */
export function runScreenCalibration(container) {
  let resolveFn;
  const result = new Promise((r) => { resolveFn = r; });
  const state = {
    rulerMm: window.innerWidth < 560 ? 50 : 100, // a phone is narrower than 10 cm
    sizePx: null, // CSS px of the matched ruler length
    verified: null,
  };
  const ppm = () => state.sizePx / state.rulerMm;
  const done = (v) => { window.removeEventListener('resize', onResize); container.onclick = null; resolveFn(v); };
  const onResize = () => { if (container.querySelector('[data-sc-step="match"]')) clampSize(); };
  window.addEventListener('resize', onResize);

  const head = (title, step) => `
    <div class="row-between mb-2"><h2 class="mb-0" id="h-sc">${title}</h2><button class="btn btn-ghost btn-sm" type="button" data-sc="cancel">ยกเลิก</button></div>
    <ol class="sc-steps" aria-label="ขั้นตอน">${['เตรียมไม้บรรทัด', 'ปรับเส้นให้ตรงไม้บรรทัด', 'ตรวจสอบ', 'บันทึก'].map((s, i) => `<li class="${i < step ? 'is-done' : i === step ? 'is-active' : ''}">${s}</li>`).join('')}</ol>`;
  const zoomGuard = () => (isPinchZoomed()
    ? `<div class="alert alert-warning mb-3">${icons.alert}<div><strong>หน้าจอถูกซูมอยู่</strong> กรุณาซูมกลับเป็นขนาดปกติ (ใช้สองนิ้วย่อหน้าจอ) ก่อนปรับเทียบ ค่าที่วัดขณะซูมจะไม่ถูกต้อง</div></div>`
    : '');

  // ------------------------------------------------------------ step 1: intro
  function stepIntro() {
    container.innerHTML = `<section class="card sc" aria-labelledby="h-sc">${head('ปรับเทียบขนาดหน้าจอด้วยไม้บรรทัด', 0)}
      <p class="text-2">ระบบต้องรู้ว่า 1 มิลลิเมตรจริงเท่ากับกี่พิกเซลบนหน้าจอนี้ (px/มม.) เพื่อแสดงตัวอักษรทดสอบให้มีขนาดจริงถูกต้อง
        กล้องวัดขนาดหน้าจอไม่ได้ จึงต้องใช้<strong>ไม้บรรทัดหรือตลับเมตรที่มีขีดมิลลิเมตร</strong> (ไม่ต้องใช้บัตร)</p>
      <div class="segmented mb-3" role="radiogroup" aria-label="ความยาวที่ใช้วัด">
        <label><input type="radio" name="sc-ruler" value="50" ${state.rulerMm === 50 ? 'checked' : ''}>วัด 5 ซม. (โทรศัพท์)</label>
        <label><input type="radio" name="sc-ruler" value="100" ${state.rulerMm === 100 ? 'checked' : ''}>วัด 10 ซม. (แท็บเล็ต/คอมพิวเตอร์ แม่นยำกว่า)</label></div>
      <p class="small muted mb-0">หน้าจอปัจจุบัน: ${screen.width} × ${screen.height} px (CSS) · พื้นที่แสดงผล ${window.innerWidth} × ${window.innerHeight} px · Device Pixel Ratio ${screenFingerprint().dpr}
        <br>ค่าเหล่านี้ใช้ตรวจจับการเปลี่ยนหน้าจอหรือการซูมเท่านั้น ไม่ได้ใช้แทนขนาดจริง</p>
      <div class="row mt-4"><button class="btn btn-primary" type="button" data-sc="next">ถัดไป</button></div>
    </section>`;
    container.querySelectorAll('input[name="sc-ruler"]').forEach((r) => r.addEventListener('change', () => { state.rulerMm = Number(r.value); state.sizePx = null; }));
    container.onclick = (e) => {
      const a = e.target.closest('[data-sc]')?.dataset.sc;
      if (a === 'cancel') done({ status: 'cancel' });
      if (a === 'next') stepMatch();
    };
  }

  // ------------------------------------------------------------ step 2: match the ruler
  function maxSize() {
    const stage = container.querySelector('.sc-stage');
    return (stage?.clientWidth ?? window.innerWidth) - 4;
  }
  function clampSize() {
    const max = maxSize();
    state.sizePx = Math.max(60, Math.min(max, state.sizePx ?? state.rulerMm * STANDARD_PX_PER_MM));
    const range = container.querySelector('#sc-size');
    if (range) { range.max = String(Math.floor(max)); range.value = String(state.sizePx); }
    drawShape();
  }
  function drawShape() {
    const s = state.sizePx;
    const shape = container.querySelector('[data-sc-shape]');
    if (!shape) return;
    shape.style.width = `${s}px`;
    container.querySelector('[data-sc-ticks]').innerHTML = Array.from({ length: state.rulerMm / 10 + 1 }, (_, i) => `<i style="left:${(i * 10 * s) / state.rulerMm}px"><span>${i}</span></i>`).join('');
    container.querySelector('[data-sc-readout]').textContent = `${fmt(ppm(), 3)} px/มม.`;
  }

  function stepMatch() {
    container.innerHTML = `<section class="card sc" aria-labelledby="h-sc" data-sc-step="match">${head('ปรับเส้นให้เท่าไม้บรรทัด', 1)}
      ${zoomGuard()}
      <ol class="small text-2"><li>วางไม้บรรทัดทาบใต้เส้นสีฟ้า (แตะหน้าจอเบา ๆ) ให้ขีด <strong>0</strong> ตรงกับปลายซ้ายของเส้น</li>
        <li>เลื่อนแถบปรับขนาดหรือกด − / + จนปลายขวาของเส้นตรงกับขีด <strong>${state.rulerMm / 10} ซม. (${state.rulerMm} มม.)</strong> บนไม้บรรทัดพอดี</li></ol>
      <div class="sc-stage is-ruler"><div class="sc-ruler" data-sc-shape><div class="sc-ruler-line"></div><div class="sc-ruler-ticks" data-sc-ticks></div></div></div>
      <div class="sc-adjust">
        <button class="btn btn-icon" type="button" data-sc="minus" aria-label="ลดความยาว">−</button>
        <label class="sr-only" for="sc-size">ความยาวเส้น</label>
        <input type="range" id="sc-size" min="60" step="${STEP_PX}" value="0">
        <button class="btn btn-icon" type="button" data-sc="plus" aria-label="เพิ่มความยาว">+</button>
      </div>
      <p class="center small muted mb-0">ค่าปัจจุบัน <strong data-sc-readout></strong> · ปรับละเอียดได้ด้วยปุ่มลูกศรบนคีย์บอร์ด</p>
      <p class="sc-error small hidden" data-sc-err role="alert"></p>
      <div class="row mt-4"><button class="btn" type="button" data-sc="back">ย้อนกลับ</button><button class="btn btn-primary" type="button" data-sc="next">ตรงกับไม้บรรทัดแล้ว</button></div>
    </section>`;
    clampSize();
    const range = container.querySelector('#sc-size');
    range.addEventListener('input', () => { state.sizePx = Number(range.value); drawShape(); });
    container.onclick = (e) => {
      const a = e.target.closest('[data-sc]')?.dataset.sc;
      if (!a) return;
      if (a === 'cancel') done({ status: 'cancel' });
      else if (a === 'back') stepIntro();
      else if (a === 'minus' || a === 'plus') { state.sizePx += a === 'plus' ? STEP_PX : -STEP_PX; clampSize(); }
      else if (a === 'next') {
        const err = container.querySelector('[data-sc-err]');
        if (isPinchZoomed()) { err.textContent = 'กรุณาซูมหน้าจอกลับเป็นขนาดปกติก่อน'; err.classList.remove('hidden'); return; }
        const v = ppm();
        if (!(v >= PX_PER_MM_RANGE.min && v <= PX_PER_MM_RANGE.max)) {
          err.textContent = `ค่า ${fmt(v, 2)} px/มม. อยู่นอกช่วงที่เป็นไปได้ของหน้าจอ กรุณาตรวจสอบการวางไม้บรรทัดอีกครั้ง`;
          err.classList.remove('hidden');
          return;
        }
        stepVerify();
      }
    };
  }

  // ------------------------------------------------------------ step 3: verify
  function stepVerify() {
    const k = ppm(); // px/mm measured in step 2
    // same length the user chose in step 1 and matched in step 2 (it already fitted on screen there)
    const barMm = state.rulerMm;
    container.innerHTML = `<section class="card sc" aria-labelledby="h-sc">${head('ตรวจสอบความถูกต้อง', 2)}
      <p class="text-2">วัดแถบด้านล่างด้วยไม้บรรทัดอีกครั้ง แถบนี้วาดจากค่าที่ปรับเทียบได้ <strong>ควรยาว ${barMm / 10} ซม. (${barMm} มม.) พอดี</strong> และสี่เหลี่ยมควรกว้าง 10 มม.</p>
      <div class="sc-verify">
        <div class="sc-vbar" style="width:${barMm * k}px">${Array.from({ length: barMm + 1 }, (_, i) => `<i class="${i % 10 === 0 ? 'cm' : i % 5 === 0 ? 'half' : ''}" style="left:${i * k}px"></i>`).join('')}</div>
        <div class="sc-vlabels" style="width:${barMm * k}px">${Array.from({ length: barMm / 10 + 1 }, (_, i) => `<span style="left:${i * 10 * k}px">${i}</span>`).join('')}</div>
        <p class="small muted mt-2 mb-0">หน่วย: เซนติเมตร (ขีดยาว = 1 ซม. · ขีดกลาง = 5 มม. · ขีดสั้น = 1 มม.)</p>
        <div class="sc-vsquare" style="width:${10 * k}px;height:${10 * k}px" title="10 × 10 มม."></div>
      </div>
      <div class="row mt-4">
        <button class="btn btn-primary" type="button" data-sc="ok">${icons.check}ตรง (คลาดเคลื่อนไม่เกิน 1 มม.)</button>
        <button class="btn" type="button" data-sc="adjust">ไม่ตรง กลับไปปรับใหม่</button>
      </div>
    </section>`;
    container.onclick = (e) => {
      const a = e.target.closest('[data-sc]')?.dataset.sc;
      if (a === 'cancel') done({ status: 'cancel' });
      else if (a === 'adjust') stepMatch();
      else if (a === 'ok') { state.verified = true; stepSummary(); }
    };
  }

  // ------------------------------------------------------------ step 4: summary + save
  function stepSummary() {
    const k = ppm();
    const fp = screenFingerprint();
    const wMm = screen.width / k;
    const hMm = screen.height / k;
    const diagIn = Math.hypot(wMm, hMm) / 25.4;
    const far = getFarDistance();
    const rows = [[1.0, 40], [0.0, 40], [1.0, far], [0.0, far]];
    container.innerHTML = `<section class="card sc" aria-labelledby="h-sc">${head('สรุปผลการปรับเทียบขนาดหน้าจอ', 3)}
      <div class="sc-result">
        <div class="sc-big"><span class="small text-2">ค่าที่วัดได้</span><strong>${fmt(k, 3)}</strong><span>px/มม. (CSS)</span></div>
        <dl class="kv">
          <dt>วิธีอ้างอิง</dt><dd>ไม้บรรทัด ${state.rulerMm} มม. · ตรวจสอบซ้ำด้วยแถบ ${state.rulerMm / 10} ซม. แล้ว</dd>
          <dt>ขนาดหน้าจอที่คำนวณได้</dt><dd>${fmt(wMm / 10)} × ${fmt(hMm / 10)} ซม. (ประมาณ ${fmt(diagIn)} นิ้ว)</dd>
          <dt>ความละเอียด</dt><dd>${screen.width} × ${screen.height} px (CSS) · ${Math.round(screen.width * fp.dpr)} × ${Math.round(screen.height * fp.dpr)} px (จริง)</dd>
          <dt>พื้นที่แสดงผล</dt><dd>${window.innerWidth} × ${window.innerHeight} px</dd>
          <dt>Device Pixel Ratio</dt><dd>${fp.dpr}</dd>
        </dl>
      </div>
      <p class="small text-2 mt-3 mb-2">หากขนาดหน้าจอที่คำนวณได้ไม่ใกล้เคียงขนาดจริงของอุปกรณ์ ให้กด "ปรับใหม่"</p>
      <div class="table-wrap"><table class="table"><thead><tr><th>ระดับ</th><th>ระยะ</th><th>ความสูงตัว E</th><th>บนหน้าจอนี้</th></tr></thead><tbody>
        ${rows.map(([l, d]) => `<tr><td>${snellen20(l)}</td><td>${d} ซม.</td><td>${fmt(optotypeMm(l, d), 2)} มม.</td><td>${fmt(optotypeMm(l, d) * k, 1)} px</td></tr>`).join('')}
      </tbody></table></div>
      <div class="row mt-4"><button class="btn btn-primary btn-lg" type="button" data-sc="save">${icons.save}บันทึกการปรับเทียบ</button><button class="btn" type="button" data-sc="adjust">ปรับใหม่</button></div>
    </section>`;
    container.onclick = (e) => {
      const a = e.target.closest('[data-sc]')?.dataset.sc;
      if (a === 'cancel') done({ status: 'cancel' });
      else if (a === 'adjust') stepMatch();
      else if (a === 'save') {
        done({
          status: 'done',
          record: {
            status: 'calibrated',
            method: 'ruler',
            reference: { type: 'ruler', mm: state.rulerMm },
            matchedCssPx: Math.round(state.sizePx * 100) / 100,
            pxPerMm: Math.round(k * 10000) / 10000,
            verified: state.verified,
            fingerprint: fp,
            viewport: { w: window.innerWidth, h: window.innerHeight },
            screenMm: { w: Math.round(wMm), h: Math.round(hMm) },
            at: Date.now(),
          },
        });
      }
    };
  }

  container.onclick = null;
  stepIntro();
  requestAnimationFrame(() => container.querySelector('.sc')?.scrollIntoView({ block: 'start' }));
  return result;
}
