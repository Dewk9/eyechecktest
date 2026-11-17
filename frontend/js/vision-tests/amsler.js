/**
 * Central visual field — Amsler grid (20 × 20 squares, ~10 cm at ~30 cm).
 * The user answers 3 questions and can tap squares that look wavy/missing.
 */
import { pxPerMm, coverText, EYE_TH } from './common.js';

export const meta = {
  key: 'central_visual_field',
  title: 'ลานสายตาส่วนกลาง (Amsler Grid)',
  description: 'มองจุดกลางตารางเพื่อตรวจหาเส้นบิดเบี้ยวหรือบริเวณที่มองไม่เห็นในส่วนกลางของการมองเห็น',
  instructions: ['ถือหน้าจอห่างประมาณ 30 ซม.', 'จ้องจุดสีดำตรงกลางตลอดเวลา อย่าเลื่อนสายตา', 'สังเกตว่าเส้นตรงทุกเส้นหรือไม่ มีส่วนที่หายไปหรือพร่ามัวหรือไม่', 'แตะช่องที่ผิดปกติเพื่อทำเครื่องหมาย (ถ้ามี)'],
};

const N = 20;

export async function run(stage, { eye }) {
  const sizeCss = Math.min(100 * pxPerMm(), stage.clientWidth - 32, window.innerHeight * 0.6);
  const marked = new Set();
  stage.innerHTML = `
    <span class="vt-eye-banner">${EYE_TH[eye]}</span>
    <p class="small muted mb-0">${coverText(eye)} · จ้องจุดตรงกลาง</p>
    <canvas class="amsler-canvas" aria-label="ตาราง Amsler แตะช่องที่ผิดปกติ" tabindex="0"></canvas>
    <form class="stack" style="text-align:left;max-width:560px;width:100%" novalidate>
      <fieldset class="fieldset mb-0"><legend class="small">1. มองเห็นจุดดำตรงกลางหรือไม่</legend>
        <div class="segmented"><label><input type="radio" name="center" value="yes" required>เห็น</label><label><input type="radio" name="center" value="no">ไม่เห็น</label></div></fieldset>
      <fieldset class="fieldset mb-0"><legend class="small">2. เส้นตรงทุกเส้นหรือไม่ (ขณะจ้องจุดกลาง)</legend>
        <div class="segmented"><label><input type="radio" name="straight" value="yes" required>ตรงทุกเส้น</label><label><input type="radio" name="straight" value="no">มีเส้นบิดเบี้ยว/โค้ง</label></div></fieldset>
      <fieldset class="fieldset mb-0"><legend class="small">3. มีบริเวณที่หายไป มืด หรือพร่ามัวหรือไม่</legend>
        <div class="segmented"><label><input type="radio" name="missing" value="no" required>ไม่มี</label><label><input type="radio" name="missing" value="yes">มี</label></div></fieldset>
      <p class="small muted mb-0" id="marked-count">ทำเครื่องหมายไว้ 0 ช่อง</p>
      <p class="field-error" id="amsler-err"></p>
      <button class="btn btn-primary" type="submit">บันทึกผลตานี้</button>
    </form>`;
  const canvas = stage.querySelector('canvas');
  const dpr = devicePixelRatio || 1;
  canvas.width = sizeCss * dpr;
  canvas.height = sizeCss * dpr;
  canvas.style.width = `${sizeCss}px`;
  canvas.style.height = `${sizeCss}px`;
  const ctx = canvas.getContext('2d');
  const cell = (sizeCss * dpr) / N;
  const draw = () => {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(220, 38, 38, .35)';
    for (const i of marked) ctx.fillRect((i % N) * cell, Math.floor(i / N) * cell, cell, cell);
    ctx.strokeStyle = '#000';
    ctx.lineWidth = Math.max(1, dpr);
    for (let i = 0; i <= N; i++) {
      ctx.beginPath(); ctx.moveTo(i * cell, 0); ctx.lineTo(i * cell, canvas.height); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i * cell); ctx.lineTo(canvas.width, i * cell); ctx.stroke();
    }
    ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.arc(canvas.width / 2, canvas.height / 2, cell * 0.28, 0, Math.PI * 2); ctx.fill();
    stage.querySelector('#marked-count').textContent = `ทำเครื่องหมายไว้ ${marked.size} ช่อง`;
  };
  canvas.addEventListener('click', (e) => {
    const r = canvas.getBoundingClientRect();
    const x = Math.floor(((e.clientX - r.left) / r.width) * N);
    const y = Math.floor(((e.clientY - r.top) / r.height) * N);
    const i = y * N + x;
    if (marked.has(i)) marked.delete(i); else marked.add(i);
    draw();
  });
  draw();

  const form = stage.querySelector('form');
  return new Promise((resolve) => {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      if (!fd.get('center') || !fd.get('straight') || !fd.get('missing')) {
        stage.querySelector('#amsler-err').textContent = 'กรุณาตอบคำถามให้ครบทั้ง 3 ข้อ';
        return;
      }
      resolve({
        status: 'completed',
        sees_center: fd.get('center') === 'yes',
        lines_straight: fd.get('straight') === 'yes',
        missing_areas: fd.get('missing') === 'yes',
        marked_cells: [...marked].sort((a, b) => a - b),
      });
    });
  });
}
