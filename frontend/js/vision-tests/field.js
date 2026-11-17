/**
 * Peripheral visual field (screening) — the user fixates a central cross and
 * responds when a brief light dot appears. 16 stimuli (4 per quadrant) plus
 * 4 catch trials (no dot) to estimate false positives.
 * Limited to the screen's angular size, so it only covers the central ~20–30°.
 */
import { sleep, shuffle, coverText, EYE_TH } from './common.js';

export const meta = {
  key: 'visual_field',
  title: 'ลานสายตา (Visual Field)',
  description: 'จ้องเครื่องหมาย + ตรงกลาง แล้วกดปุ่มทุกครั้งที่เห็นจุดแสงกะพริบรอบ ๆ เพื่อคัดกรองการมองเห็นด้านข้าง',
  instructions: ['นั่งห่างจากหน้าจอประมาณ 40 ซม. ในห้องที่ไม่สว่างจ้า', 'จ้องเครื่องหมาย + ตรงกลางตลอดการทดสอบ ห้ามมองตามจุด', 'กด Spacebar หรือแตะปุ่ม "เห็นจุด" ทุกครั้งที่เห็นจุดแสง', 'ใช้เวลาประมาณ 1 นาทีต่อข้าง'],
};

const QUADS = { upper_left: [-1, -1], upper_right: [1, -1], lower_left: [-1, 1], lower_right: [1, 1] };
const RESPONSE_MS = 1300;

export async function run(stage, { eye }) {
  stage.innerHTML = `
    <span class="vt-eye-banner">${EYE_TH[eye]}</span>
    <p class="small muted mb-0">${coverText(eye)} · จ้อง + ตรงกลางตลอดเวลา</p>
    <canvas class="field-canvas" aria-label="พื้นที่ทดสอบลานสายตา"></canvas>
    <div class="row" style="justify-content:center">
      <button class="btn btn-primary btn-lg" data-start>เริ่มทดสอบ</button>
      <button class="btn btn-accent btn-lg hidden" data-seen style="min-width:220px">เห็นจุด (Space)</button>
    </div>
    <div class="progress" style="width:100%;max-width:600px"><span></span></div>`;
  const canvas = stage.querySelector('canvas');
  const dpr = devicePixelRatio || 1;
  const w = canvas.clientWidth * dpr;
  const h = canvas.clientHeight * dpr;
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  const drawFix = () => {
    ctx.fillStyle = '#222';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 3 * dpr;
    const s = 14 * dpr;
    ctx.beginPath(); ctx.moveTo(w / 2 - s, h / 2); ctx.lineTo(w / 2 + s, h / 2); ctx.moveTo(w / 2, h / 2 - s); ctx.lineTo(w / 2, h / 2 + s); ctx.stroke();
  };
  drawFix();

  await new Promise((r) => stage.querySelector('[data-start]').addEventListener('click', r, { once: true }));
  stage.querySelector('[data-start]').classList.add('hidden');
  const seenBtn = stage.querySelector('[data-seen]');
  seenBtn.classList.remove('hidden');

  let pressed = false;
  const press = () => { pressed = true; seenBtn.blur(); };
  const onKey = (e) => { if (e.code === 'Space') { e.preventDefault(); press(); } };
  seenBtn.addEventListener('click', press);
  canvas.addEventListener('click', press);
  document.addEventListener('keydown', onKey);

  // stimuli: 2 eccentricities × 2 angles per quadrant
  const trials = [];
  for (const [q, [sx, sy]] of Object.entries(QUADS)) {
    for (const ecc of [0.45, 0.9]) {
      for (const ang of [0.35, 1.2]) trials.push({ q, x: sx * Math.cos(ang) * ecc, y: sy * Math.sin(ang) * ecc });
    }
  }
  for (let i = 0; i < 4; i++) trials.push({ catch: true });
  const order = shuffle(trials);
  const quadrants = Object.fromEntries(Object.keys(QUADS).map((k) => [k, { shown: 0, seen: 0 }]));
  let falsePositives = 0;
  const bar = stage.querySelector('.progress span');

  for (let i = 0; i < order.length; i++) {
    const t = order[i];
    await sleep(700 + Math.random() * 1100);
    pressed = false;
    if (!t.catch) {
      const cx = w / 2 + t.x * (w / 2 - 20 * dpr);
      const cy = h / 2 + t.y * (h / 2 - 20 * dpr);
      ctx.fillStyle = '#d9d9d9';
      ctx.beginPath(); ctx.arc(cx, cy, 6 * dpr, 0, Math.PI * 2); ctx.fill();
      await sleep(200);
      drawFix();
    }
    await sleep(RESPONSE_MS);
    if (t.catch) { if (pressed) falsePositives++; }
    else {
      quadrants[t.q].shown++;
      if (pressed) quadrants[t.q].seen++;
    }
    bar.style.width = `${((i + 1) / order.length) * 100}%`;
  }
  document.removeEventListener('keydown', onKey);
  return { status: 'completed', quadrants, catch_trials: 4, false_positives: falsePositives };
}
