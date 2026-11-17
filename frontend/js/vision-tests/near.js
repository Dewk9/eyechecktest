/**
 * Near vision: read random 3-digit numbers of decreasing size at the measured reading
 * distance (target 40 cm). Digits are drawn on a canvas and their real glyph height is
 * measured, so the digit height (not a CSS font-size) equals 5′ × MAR on the calibrated screen.
 */
import { optotypeMm, pxPerMm, snellen20, coverText, EYE_TH } from './common.js';

export const meta = {
  key: 'near_vision',
  title: 'การมองเห็นระยะใกล้ (Near Vision)',
  description: 'อ่านตัวเลขที่มีขนาดเล็กลงเรื่อย ๆ ที่ระยะประมาณ 40 เซนติเมตร (ระยะอ่านหนังสือ)',
  instructions: ['ถือโทรศัพท์หรือนั่งห่างจากหน้าจอประมาณ 40 ซม. (ประมาณหนึ่งช่วงแขนงอ)', 'สวมแว่นอ่านหนังสือหากใช้เป็นประจำ', 'พิมพ์ตัวเลขที่เห็นแล้วกด "ตอบ"', 'หากอ่านไม่ออก ให้กด "อ่านไม่ออก"'],
};

const LEVELS = [1.0, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1, 0.0];
const DISTANCE_CM = 40;
const MAX_CSS = 220;
const FONT = (px) => `700 ${px}px Arial, Helvetica, sans-serif`;

let glyphRatio = null; // digit glyph height ÷ font-size for FONT, measured once
function digitRatio(ctx) {
  if (glyphRatio) return glyphRatio;
  ctx.font = FONT(200);
  const m = ctx.measureText('0123456789');
  glyphRatio = (m.actualBoundingBoxAscent + m.actualBoundingBoxDescent) / 200;
  return glyphRatio;
}

/** Draws digits whose glyph height is targetDevicePx; returns the measured glyph height (device px). */
function drawDigits(canvas, text, targetDevicePx) {
  const ctx = canvas.getContext('2d');
  const fontPx = targetDevicePx / digitRatio(ctx);
  ctx.font = FONT(fontPx);
  const m = ctx.measureText(text);
  const height = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
  const widths = [...text].map((c) => ctx.measureText(c).width);
  const gap = fontPx * 0.35;
  const pad = Math.ceil(fontPx * 0.15) + 2;
  canvas.width = Math.ceil(widths.reduce((a, b) => a + b, 0) + gap * (text.length - 1) + pad * 2);
  canvas.height = Math.ceil(height + pad * 2);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = FONT(fontPx); // resizing the canvas resets the context
  ctx.fillStyle = '#000';
  ctx.textBaseline = 'alphabetic';
  let x = pad;
  [...text].forEach((c, i) => { ctx.fillText(c, x, pad + m.actualBoundingBoxAscent); x += widths[i] + gap; });
  canvas.style.width = `${canvas.width / devicePixelRatio}px`;
  canvas.style.height = `${canvas.height / devicePixelRatio}px`;
  return height;
}

function ask(stage, eye, L, targetDevicePx, attempt, distanceCm) {
  const num = String(Math.floor(100 + Math.random() * 900));
  stage.innerHTML = `
    <span class="vt-eye-banner">${EYE_TH[eye]} · ${snellen20(L)} (logMAR ${L.toFixed(1)}) · ครั้งที่ ${attempt}</span>
    <p class="small muted mb-0">${coverText(eye)} · ระยะ ${Math.round(distanceCm)} ซม.</p>
    <canvas class="vt-digits" aria-label="ตัวเลขสำหรับทดสอบ"></canvas>
    <form class="row" style="justify-content:center" novalidate>
      <label class="sr-only" for="near-input">ตัวเลขที่เห็น</label>
      <input class="input" id="near-input" inputmode="numeric" maxlength="3" style="width:140px;text-align:center;font-size:1.3rem" autocomplete="off">
      <button class="btn btn-primary" type="submit">ตอบ</button>
      <button class="btn btn-ghost" type="button" data-skip>อ่านไม่ออก</button>
    </form>`;
  const drawn = drawDigits(stage.querySelector('canvas'), num, targetDevicePx);
  const form = stage.querySelector('form');
  const input = stage.querySelector('input');
  input.focus();
  return new Promise((resolve) => {
    form.addEventListener('submit', (e) => { e.preventDefault(); resolve({ ok: input.value.trim() === num, drawn }); });
    stage.querySelector('[data-skip]').addEventListener('click', () => resolve({ ok: false, drawn }));
  });
}

/** Digit heights for each level that fits this screen at this distance. */
export function levelSizes(distanceCm) {
  const dpr = devicePixelRatio || 1;
  return LEVELS.map((L) => {
    const mm = optotypeMm(L, distanceCm);
    return { logmar: L, targetMm: mm, cssPx: mm * pxPerMm(), devicePx: mm * pxPerMm() * dpr };
  }).filter((x) => x.cssPx <= MAX_CSS && x.devicePx >= 5);
}

export async function run(stage, { eye, distanceCm }) {
  const distance = distanceCm ?? DISTANCE_CM;
  let best = null;
  let smallest = null;
  for (const { logmar: L, devicePx } of levelSizes(distance)) {
    let r = await ask(stage, eye, L, devicePx, 1, distance);
    if (!r.ok) r = await ask(stage, eye, L, devicePx, 2, distance);
    if (!r.ok) break;
    best = L;
    smallest = r.drawn / devicePixelRatio / pxPerMm(); // measured glyph height in mm
  }
  return { status: 'completed', logmar: best ?? 1.1, smallest_size_mm: smallest === null ? null : Math.round(smallest * 100) / 100 };
}

export const distanceCm = DISTANCE_CM;
