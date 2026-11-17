/**
 * Screening workflow state (one screening session in this browser tab).
 * Only ids and non-sensitive flags are kept in sessionStorage — health data
 * itself always lives on the server.
 */
import { icons } from './icons.js';

const KEY = 'ec_workflow';
const CAPTURE_KEY = 'ec_capture';

export const STEPS = [
  { key: 'history', href: '/pages/medical-history.html', label: 'ซักประวัติ' },
  { key: 'vision', href: '/pages/vision-test.html', label: 'ทดสอบการมองเห็น' },
  { key: 'scan', href: '/pages/scan.html', label: 'สแกนดวงตา' },
  { key: 'analyze', href: '/pages/analyze.html', label: 'วิเคราะห์ด้วย AI' },
  { key: 'result', href: '/pages/result.html', label: 'ผลการตรวจ' },
];

export function getWorkflow() {
  try { return JSON.parse(sessionStorage.getItem(KEY)) ?? {}; } catch { return {}; }
}

export function setWorkflow(patch) {
  const next = { ...getWorkflow(), ...patch, updatedAt: Date.now() };
  try { sessionStorage.setItem(KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
  return next;
}

export function resetWorkflow(keep = {}) {
  try {
    sessionStorage.removeItem(CAPTURE_KEY);
    sessionStorage.setItem(KEY, JSON.stringify({ ...keep, startedAt: Date.now() }));
  } catch { /* ignore */ }
}

/** Captured image (JPEG data URL) kept only until it is uploaded. */
export function saveCapture(dataUrl, meta) {
  try {
    sessionStorage.setItem(CAPTURE_KEY, JSON.stringify({ dataUrl, meta, at: Date.now() }));
    return true;
  } catch {
    return false;
  }
}
export function getCapture() {
  try { return JSON.parse(sessionStorage.getItem(CAPTURE_KEY)); } catch { return null; }
}
export function clearCapture() {
  try { sessionStorage.removeItem(CAPTURE_KEY); } catch { /* ignore */ }
}

/** Which steps are complete, from the stored ids */
export function stepStatus(wf = getWorkflow()) {
  return {
    history: Boolean(wf.historyId),
    vision: Boolean(wf.visionTestId || wf.visionSkipped),
    scan: Boolean(wf.screeningId || getCapture()),
    analyze: Boolean(wf.analyzed),
    result: Boolean(wf.saved),
  };
}

export function renderStepper(el, currentKey) {
  if (!el) return;
  const done = stepStatus();
  el.innerHTML = `<ol class="stepper" aria-label="ขั้นตอนการตรวจคัดกรอง">
    ${STEPS.map((s, i) => {
      const cls = s.key === currentKey ? 'current' : done[s.key] ? 'done' : '';
      const num = done[s.key] && s.key !== currentKey ? icons.check : String(i + 1);
      return `<li class="${cls}"><a href="${s.href}" ${s.key === currentKey ? 'aria-current="step"' : ''}><span class="num">${num}</span><span class="label">${s.label}</span></a></li>`;
    }).join('')}
  </ol>`;
}

/** Subject summary line (self or patient) */
export function subjectLabel(wf = getWorkflow()) {
  if (!wf.subject) return null;
  return wf.subject.type === 'patient' ? `${wf.subject.name} (อายุ ${wf.subject.age ?? '-'} ปี)` : 'ตนเอง';
}
