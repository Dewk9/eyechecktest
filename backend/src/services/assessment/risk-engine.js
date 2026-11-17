/**
 * Rule-based screening risk assessment — version "rules-v1".
 *
 * IMPORTANT: AI model confidence is NEVER added to or blended with the
 * history score. The engine only looks at categorical facts:
 *   - did the AI produce a finding at/above the configured threshold?
 *   - which symptoms / risk factors were reported?
 *   - which on-screen vision tests were flagged by documented cut-offs?
 *
 * Rules (first match wins):
 *  R1 Urgent Referral : emergency symptoms reported (cannot be overridden by any AI result)
 *  R2 High            : AI finding + ≥1 related symptom or related abnormal vision test
 *  R3 High            : (no AI finding) ≥3 independent signals (symptoms + abnormal vision tests)
 *  R4 Moderate        : AI finding alone, OR 1–2 signals
 *  R5 Moderate        : AI normal/no finding, no signals, but age ≥60 with ≥2 risk factors (regular follow-up)
 *  R6 Low             : AI conclusive (normal/no finding) and no signals
 *  R7 Inconclusive    : AI not available/insufficient AND no signals (insufficient data)
 *
 * These rules are a transparent triage heuristic. They have NOT been
 * clinically validated — this is shown to users next to every result.
 */
import { RECOMMENDATIONS, NEXT_STEPS, DISEASE_LABELS, VISION_TEST_RELATED, GLAUCOMA_NOTE, DISCLAIMER } from './knowledge.js';

export const ASSESSMENT_VERSION = 'rules-v1';
export const ASSESSMENT_VALIDATED = false;

const DISEASES = Object.keys(DISEASE_LABELS);

/**
 * @param {object} input
 * @param {object} input.history   summarizeMedicalHistory() output
 * @param {object} input.vision    summarizeVisionTest() output
 * @param {object} input.ai        { status: 'completed'|'insufficient_confidence'|'not_connected'|'failed'|..., summary?: summarizeFindings() output }
 */
export function assessRisk({ history, vision, ai }) {
  const symptoms = history?.available ? history.symptoms : [];
  const factors = history?.available ? history.risk_factors : [];
  const abnormalTests = vision?.available ? vision.abnormal_tests : [];
  const emergency = Boolean(history?.emergency);

  const aiCompleted = ai?.status === 'completed';
  const aiOutcome = aiCompleted ? ai.summary?.outcome : null; // finding | normal | no_finding | insufficient_confidence | unrecognized
  const aiFindings = aiOutcome === 'finding'
    ? ai.summary.diseases.filter((d) => d.status === 'detected').map((d) => d.disease)
    : [];
  const aiConclusiveNegative = aiOutcome === 'normal' || aiOutcome === 'no_finding';

  // Which diseases the non-AI information points to
  const historySignals = {};
  for (const d of DISEASES) historySignals[d] = { symptoms: [], vision: [], factors: [] };
  for (const s of symptoms) for (const d of s.related) historySignals[d]?.symptoms.push(s.key);
  for (const t of abnormalTests) for (const d of VISION_TEST_RELATED[t] ?? []) historySignals[d]?.vision.push(t);
  for (const f of factors) for (const d of f.related) historySignals[d]?.factors.push(f.key);

  const signalCount = symptoms.length + abnormalTests.length;
  const supportFor = (d) => historySignals[d].symptoms.length + historySignals[d].vision.length;
  const supportedFindings = aiFindings.filter((d) => supportFor(d) > 0);
  const age60 = history?.age_group?.key === '60_plus';

  let level;
  let rule;
  if (emergency) { level = 'urgent'; rule = 'R1'; }
  else if (supportedFindings.length) { level = 'high'; rule = 'R2'; }
  else if (!aiFindings.length && signalCount >= 3) { level = 'high'; rule = 'R3'; }
  else if (aiFindings.length || signalCount >= 1) { level = 'moderate'; rule = 'R4'; }
  else if (aiConclusiveNegative && age60 && factors.length >= 2) { level = 'moderate'; rule = 'R5'; }
  else if (aiConclusiveNegative) { level = 'low'; rule = 'R6'; }
  else { level = 'inconclusive'; rule = 'R7'; }

  // Agreement between the two information sources (reported, not scored)
  let consistency;
  if (!aiCompleted || aiOutcome === 'insufficient_confidence' || aiOutcome === 'unrecognized') {
    consistency = signalCount ? 'history_only' : 'insufficient_data';
  } else if (aiFindings.length) {
    consistency = supportedFindings.length === aiFindings.length ? 'consistent'
      : supportedFindings.length ? 'partially_consistent' : 'ai_only';
  } else {
    consistency = signalCount ? 'inconsistent' : 'consistent_negative';
  }
  const CONSISTENCY_TEXT = {
    consistent: 'ผล AI และข้อมูลซักประวัติ/การทดสอบการมองเห็นสอดคล้องกัน',
    partially_consistent: 'พบข้อมูลที่สอดคล้องกันบางส่วน',
    ai_only: 'ผล AI พบความผิดปกติ แต่ไม่พบอาการหรือผลทดสอบที่สัมพันธ์กัน',
    inconsistent: 'ผล AI ไม่พบความผิดปกติ แต่มีอาการหรือผลทดสอบที่ควรติดตาม',
    consistent_negative: 'ทั้งผล AI และข้อมูลอื่นไม่พบสัญญาณผิดปกติ',
    history_only: 'ประเมินจากข้อมูลซักประวัติและการทดสอบการมองเห็นเท่านั้น (ไม่มีผล AI ที่สรุปได้)',
    insufficient_data: 'ข้อมูลไม่เพียงพอ (Insufficient Data)',
  };

  // Diseases to give advice for: AI findings + diseases suggested by symptoms/tests
  const adviceFor = new Set(aiFindings);
  for (const d of DISEASES) if (supportFor(d) > 0) adviceFor.add(d);
  if (emergency) adviceFor.add('glaucoma');

  const diseaseAdvice = [...adviceFor].map((d) => ({
    disease: d,
    label: DISEASE_LABELS[d].th,
    source: aiFindings.includes(d) ? (supportFor(d) ? 'ai_and_history' : 'ai') : 'history',
    items: RECOMMENDATIONS[d],
    ...(d === 'glaucoma' ? { note: GLAUCOMA_NOTE } : {}),
  }));

  const riskFactors = [
    ...(history?.available && history.age_group?.key !== 'under_40' ? [{ type: 'age', key: history.age_group.key, label: history.age_group.label, guidance: history.age_group.guidance }] : []),
    ...factors.map((f) => ({ type: 'risk_factor', key: f.key, label: f.label, guidance: f.guidance })),
    ...symptoms.map((s) => ({ type: 'symptom', key: s.key, label: s.label, guidance: s.guidance })),
    ...abnormalTests.map((t) => ({ type: 'vision_test', key: t, label: vision.tests[t].label, guidance: 'ผลการทดสอบผ่านหน้าจอเกินเกณฑ์คัดกรอง' })),
    ...(emergency ? [{ type: 'emergency', key: 'emergency', label: history.emergency.label, guidance: history.emergency.guidance }] : []),
  ];

  return {
    assessment_version: ASSESSMENT_VERSION,
    validated: ASSESSMENT_VALIDATED,
    risk_level: level,
    rule,
    emergency,
    consistency: { key: consistency, text: CONSISTENCY_TEXT[consistency] },
    ai_findings: aiFindings,
    history_signals: historySignals,
    risk_factors: riskFactors,
    recommendation: {
      next_step: NEXT_STEPS[level],
      diseases: diseaseAdvice,
      general: RECOMMENDATIONS.general,
      disclaimer: DISCLAIMER,
    },
  };
}
