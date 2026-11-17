/**
 * Contrast sensitivity — large letters with decreasing contrast in 0.15 log
 * steps (Pelli-Robson style). 3 letters per level, pass with ≥ 2 correct.
 * 8-bit displays limit the lowest contrast to about 0.4 % (logCS ≈ 2.4).
 */
import { pxPerMm, coverText, EYE_TH, pick, shuffle } from './common.js';

export const meta = {
  key: 'contrast_sensitivity',
  title: 'ความไวต่อความแตกต่างของแสง (Contrast Sensitivity)',
  description: 'แยกแยะตัวอักษรที่จางลงเรื่อย ๆ บนพื้นขาว',
  instructions: ['ตั้งความสว่างหน้าจอประมาณ 70–100% และปิดโหมดประหยัดพลังงาน/ถนอมสายตา', 'นั่งห่างจากหน้าจอประมาณ 1 เมตร', 'เลือกตัวอักษรที่เห็นจากตัวเลือก 4 ตัว หากไม่เห็นให้กด "มองไม่เห็น"'],
};

const LETTERS = ['C', 'D', 'H', 'K', 'N', 'O', 'R', 'S', 'V', 'Z'];
const LEVELS = Array.from({ length: 16 }, (_, i) => Math.round(i * 0.15 * 100) / 100); // 0.00 … 2.25

export async function run(stage, { eye }) {
  const sizePx = Math.min(40 * pxPerMm(), window.innerHeight * 0.3);
  let best = null;
  for (const logcs of LEVELS) {
    const contrast = 10 ** -logcs;
    const v = Math.round(255 * (1 - contrast));
    if (v >= 255) break; // display cannot render this contrast
    let correct = 0;
    for (let t = 0; t < 3; t++) {
      const letter = pick(LETTERS);
      const options = shuffle([letter, ...shuffle(LETTERS.filter((l) => l !== letter)).slice(0, 3)]);
      stage.innerHTML = `
        <span class="vt-eye-banner">${EYE_TH[eye]} · ระดับ logCS ${logcs.toFixed(2)} (${t + 1}/3)</span>
        <p class="small muted mb-0">${coverText(eye)}</p>
        <div style="background:#fff;padding:24px 48px;border-radius:12px">
          <div class="vt-optotype" style="font-size:${sizePx}px;color:rgb(${v},${v},${v});font-family:'Arial',sans-serif" aria-hidden="true">${letter}</div>
        </div>
        <div class="vt-answers" role="group" aria-label="เลือกตัวอักษรที่เห็น">
          ${options.map((o) => `<button class="btn" data-ans="${o}">${o}</button>`).join('')}
          <button class="btn btn-ghost" data-ans="none">มองไม่เห็น</button>
        </div>`;
      const ans = await new Promise((resolve) => {
        stage.querySelector('.vt-answers').addEventListener('click', (e) => {
          const b = e.target.closest('[data-ans]');
          if (b) resolve(b.dataset.ans);
        });
      });
      if (ans === letter) correct++;
      if (correct >= 2 || t + 1 - correct >= 2) break;
    }
    if (correct >= 2) best = logcs;
    else break;
  }
  return { status: 'completed', logcs: best ?? 0 };
}
