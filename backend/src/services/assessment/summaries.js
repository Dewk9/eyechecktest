import { AGE_GROUPS, RISK_FACTORS, SYMPTOMS, EMERGENCY } from './knowledge.js';

/**
 * Screening criteria for on-screen vision tests (version vt-criteria-v1).
 * These are common screening cut-offs, NOT standardised clinical testing:
 *  - Visual acuity: worse than 6/12 (logMAR > 0.30) is a common referral cut-off
 *  - Near vision: logMAR > 0.30 at the chosen reading distance
 *  - Contrast: logCS < 1.50 (Pelli-Robson style; normal adults ≈ 1.65–2.0)
 *  - Colour: < 75 % of plates correct, only valid if the control plate was seen
 *  - Amsler: any distortion / missing area / centre not seen
 *  - Peripheral field: any quadrant < 50 % seen, or overall < 75 %; unreliable if false positives > 33 %
 */
export const VISION_CRITERIA = Object.freeze({
  version: 'vt-criteria-v1',
  acuityLogmarMax: 0.3,
  nearLogmarMax: 0.3,
  contrastLogcsMin: 1.5,
  colorMinRatio: 0.75,
  fieldQuadrantMin: 0.5,
  fieldOverallMin: 0.75,
  fieldFalsePositiveMax: 0.34,
});

export const VISION_TEST_LABELS = {
  visual_acuity: 'ความคมชัดของสายตา (Visual Acuity)',
  color_vision: 'การแยกแยะสี (Color Vision)',
  central_visual_field: 'ลานสายตาส่วนกลาง (Amsler Grid)',
  visual_field: 'ลานสายตา (Visual Field)',
  near_vision: 'การมองเห็นระยะใกล้ (Near Vision)',
  contrast_sensitivity: 'ความไวต่อความแตกต่างของแสง (Contrast Sensitivity)',
};

export function summarizeMedicalHistory(h, subjectAge = null) {
  if (!h) return { available: false };
  const factors = Object.entries(RISK_FACTORS)
    .filter(([key]) => h[key])
    .map(([key, v]) => ({ key, label: v.label, guidance: v.guidance, related: v.related }));
  const symptoms = (h.eye_symptoms ?? [])
    .filter((k) => SYMPTOMS[k])
    .map((key) => ({ key, label: SYMPTOMS[key].label, guidance: SYMPTOMS[key].guidance, related: SYMPTOMS[key].related }));
  const ag = AGE_GROUPS[h.age_group];
  return {
    available: true,
    history_id: h.id,
    recorded_at: h.updated_at ?? h.created_at,
    subject_age: subjectAge,
    age_group: { key: h.age_group, label: ag?.label, guidance: ag?.guidance, related: ag?.related ?? [] },
    risk_factors: factors,
    symptoms,
    emergency: h.emergency_symptoms ? { label: EMERGENCY.label, guidance: EMERGENCY.guidance } : null,
  };
}

function evalEye(test, entry, extra) {
  if (!entry || entry.status !== 'completed') return { status: entry?.status ?? 'not_tested', abnormal: null, reliable: null, text: 'ไม่ได้ทดสอบ' };
  const c = VISION_CRITERIA;
  switch (test) {
    case 'visual_acuity': {
      if (typeof entry.logmar !== 'number') return { status: 'completed', abnormal: null, text: 'ไม่มีผล' };
      const abnormal = entry.logmar > c.acuityLogmarMax;
      return { status: 'completed', abnormal, reliable: extra?.calibrated !== false, value: entry.logmar, text: `logMAR ${entry.logmar.toFixed(2)}${entry.snellen ? ` (≈ ${entry.snellen})` : ''}` };
    }
    case 'near_vision': {
      if (typeof entry.logmar !== 'number') return { status: 'completed', abnormal: null, text: 'ไม่มีผล' };
      return { status: 'completed', abnormal: entry.logmar > c.nearLogmarMax, reliable: extra?.calibrated !== false, value: entry.logmar, text: `logMAR ${entry.logmar.toFixed(2)} ที่ระยะ ${extra?.distance_cm ?? 40} ซม.` };
    }
    case 'contrast_sensitivity': {
      if (typeof entry.logcs !== 'number') return { status: 'completed', abnormal: null, text: 'ไม่มีผล' };
      return { status: 'completed', abnormal: entry.logcs < c.contrastLogcsMin, value: entry.logcs, text: `logCS ${entry.logcs.toFixed(2)}` };
    }
    case 'color_vision': {
      if (!entry.total) return { status: 'completed', abnormal: null, text: 'ไม่มีผล' };
      if (entry.control_passed === false) return { status: 'completed', abnormal: null, reliable: false, text: 'ผลไม่น่าเชื่อถือ (มองไม่เห็นแผ่นทดสอบควบคุม)' };
      const ratio = entry.correct / entry.total;
      return { status: 'completed', abnormal: ratio < c.colorMinRatio, value: ratio, text: `ตอบถูก ${entry.correct}/${entry.total}` };
    }
    case 'central_visual_field': {
      const abnormal = entry.sees_center === false || entry.lines_straight === false || entry.missing_areas === true || (entry.marked_cells?.length ?? 0) > 0;
      return { status: 'completed', abnormal, text: abnormal ? 'พบเส้นบิดเบี้ยว/บริเวณที่มองไม่เห็น' : 'ไม่พบความผิดปกติของตาราง' };
    }
    case 'visual_field': {
      const q = entry.quadrants ?? {};
      const qs = Object.entries(q).filter(([, v]) => v.shown > 0);
      if (!qs.length) return { status: 'completed', abnormal: null, text: 'ไม่มีผล' };
      const shown = qs.reduce((s, [, v]) => s + v.shown, 0);
      const seen = qs.reduce((s, [, v]) => s + Math.min(v.seen, v.shown), 0);
      const weak = qs.filter(([, v]) => v.seen / v.shown < c.fieldQuadrantMin).map(([k]) => k);
      const fpRate = entry.catch_trials ? (entry.false_positives ?? 0) / entry.catch_trials : 0;
      const reliable = fpRate <= c.fieldFalsePositiveMax;
      const abnormal = weak.length > 0 || seen / shown < c.fieldOverallMin;
      return { status: 'completed', abnormal: reliable ? abnormal : null, reliable, value: seen / shown, weak_quadrants: weak, text: `มองเห็นจุด ${seen}/${shown}${reliable ? '' : ' (ผลไม่น่าเชื่อถือ: กดผิดบ่อย)'}` };
    }
    default:
      return { status: 'completed', abnormal: null, text: '' };
  }
}

export function summarizeVisionTest(vt) {
  if (!vt) return { available: false, criteria_version: VISION_CRITERIA.version };
  const tests = {};
  const abnormal = [];
  let tested = 0;
  for (const test of Object.keys(VISION_TEST_LABELS)) {
    const data = vt[test];
    const right = evalEye(test, data?.right, data);
    const left = evalEye(test, data?.left, data);
    if (right.status === 'completed' || left.status === 'completed') tested++;
    const isAbnormal = right.abnormal === true || left.abnormal === true;
    if (isAbnormal) abnormal.push(test);
    tests[test] = { label: VISION_TEST_LABELS[test], right, left, abnormal: isAbnormal };
  }
  return {
    available: tested > 0,
    vision_test_id: vt.id ?? null,
    tested_at: vt.created_at ?? null,
    criteria_version: VISION_CRITERIA.version,
    tested_count: tested,
    abnormal_tests: abnormal,
    tests,
  };
}

/** Per-eye summary stored in vision_tests.left_eye_result / right_eye_result */
export function perEyeResult(summary, side) {
  const out = {};
  for (const [k, t] of Object.entries(summary.tests ?? {})) out[k] = { status: t[side].status, abnormal: t[side].abnormal, text: t[side].text };
  return out;
}
