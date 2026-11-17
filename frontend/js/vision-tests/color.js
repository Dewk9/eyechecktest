/**
 * Colour vision — procedurally generated pseudo-isochromatic dot plates
 * (red/orange figure on green background with luminance noise), plus one
 * high-contrast control plate everybody should read. Screening only.
 */
import { coverText, EYE_TH, shuffle } from './common.js';

export const meta = {
  key: 'color_vision',
  title: 'การแยกแยะสี (Color Vision)',
  description: 'มองหาตัวเลขที่ซ่อนอยู่ในแผ่นภาพจุดสี',
  instructions: ['ปรับความสว่างหน้าจอให้เหมาะสม ไม่เปิดโหมดถนอมสายตา/Night Shift', 'ดูแผ่นภาพแต่ละแผ่นไม่เกิน 5 วินาที', 'เลือกตัวเลขที่เห็น หากไม่เห็นตัวเลขให้เลือก "มองไม่เห็นตัวเลข"'],
};

const FIG = ['#d9774b', '#e08a55', '#cf6a4a', '#e39b62', '#d5824f', '#c9714f'];
const BG = ['#8fa65a', '#9cae63', '#a3b56e', '#7f9a55', '#b4bb73', '#94a95e', '#a8a35e'];

function drawPlate(canvas, digit, control = false) {
  const size = 300;
  const dpr = devicePixelRatio || 1;
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, size, size);

  // digit mask
  const mask = document.createElement('canvas');
  mask.width = size; mask.height = size;
  const m = mask.getContext('2d');
  m.fillStyle = '#000';
  m.font = 'bold 190px Arial, sans-serif';
  m.textAlign = 'center';
  m.textBaseline = 'middle';
  m.fillText(String(digit), size / 2, size / 2 + 8);
  const md = m.getImageData(0, 0, size, size).data;
  const inFigure = (x, y) => md[(Math.round(y) * size + Math.round(x)) * 4 + 3] > 128;

  const R = size / 2 - 4;
  const dots = [];
  for (let i = 0; i < 6000 && dots.length < 900; i++) {
    const r = 3 + Math.random() * 6;
    const a = Math.random() * Math.PI * 2;
    const d = Math.sqrt(Math.random()) * (R - r);
    const x = size / 2 + Math.cos(a) * d;
    const y = size / 2 + Math.sin(a) * d;
    if (dots.some((o) => (o.x - x) ** 2 + (o.y - y) ** 2 < (o.r + r + 1) ** 2)) continue;
    dots.push({ x, y, r });
  }
  for (const dot of dots) {
    const fig = inFigure(dot.x, dot.y);
    ctx.fillStyle = control ? (fig ? '#1d3f7a' : '#c9ced6') : (fig ? FIG : BG)[Math.floor(Math.random() * (fig ? FIG.length : BG.length))];
    ctx.beginPath();
    ctx.arc(dot.x, dot.y, dot.r, 0, Math.PI * 2);
    ctx.fill();
  }
}

export async function run(stage, { eye }) {
  const digits = shuffle([2, 3, 5, 6, 7, 8, 9]).slice(0, 6);
  const plates = [{ digit: 4 + Math.floor(Math.random() * 5), control: true }, ...digits.map((d) => ({ digit: d, control: false }))];
  let correct = 0;
  let controlPassed = null;
  for (let i = 0; i < plates.length; i++) {
    const p = plates[i];
    stage.innerHTML = `
      <span class="vt-eye-banner">${EYE_TH[eye]} · แผ่นที่ ${i + 1}/${plates.length}</span>
      <p class="small muted mb-0">${coverText(eye)}</p>
      <canvas aria-label="แผ่นภาพจุดสีสำหรับทดสอบ"></canvas>
      <div class="vt-answers" role="group" aria-label="เลือกตัวเลขที่เห็น">
        ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button class="btn" data-ans="${n}">${n}</button>`).join('')}
        <button class="btn btn-ghost" data-ans="none">มองไม่เห็นตัวเลข</button>
      </div>`;
    drawPlate(stage.querySelector('canvas'), p.digit, p.control);
    const ans = await new Promise((resolve) => {
      stage.querySelector('.vt-answers').addEventListener('click', (e) => {
        const b = e.target.closest('[data-ans]');
        if (b) resolve(b.dataset.ans);
      });
    });
    const ok = ans === String(p.digit);
    if (p.control) controlPassed = ok;
    else if (ok) correct++;
  }
  return { status: 'completed', correct, total: plates.length - 1, control_passed: controlPassed };
}
