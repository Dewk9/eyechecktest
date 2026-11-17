import test from 'node:test';
import assert from 'node:assert/strict';
import { assessRisk } from '../../src/services/assessment/risk-engine.js';
import { summarizeMedicalHistory, summarizeVisionTest } from '../../src/services/assessment/summaries.js';

const baseHistory = { id: 'h1', age_group: 'under_40', family_glaucoma_history: false, diabetes: false, hypertension: false, steroid_use: false, outdoor_exposure: false, high_myopia: false, eye_injury: false, eye_symptoms: [], emergency_symptoms: false };
const h = (over = {}) => summarizeMedicalHistory({ ...baseHistory, ...over });
const noVision = summarizeVisionTest(null);
const aiFinding = (disease, confidence = 0.9) => ({
  status: 'completed',
  summary: { outcome: 'finding', primary: disease, diseases: [{ disease, status: 'detected', confidence }] },
});
const aiNormal = { status: 'completed', summary: { outcome: 'normal', primary: 'normal', diseases: [] } };

test('emergency symptoms always → urgent, even with a normal AI result', () => {
  const r = assessRisk({ history: h({ emergency_symptoms: true }), vision: noVision, ai: aiNormal });
  assert.equal(r.risk_level, 'urgent');
  assert.equal(r.rule, 'R1');
});

test('emergency symptoms → urgent when AI is not connected', () => {
  const r = assessRisk({ history: h({ emergency_symptoms: true }), vision: noVision, ai: { status: 'not_connected' } });
  assert.equal(r.risk_level, 'urgent');
});

test('AI finding + related symptom → high, consistent', () => {
  const r = assessRisk({ history: h({ age_group: '60_plus', eye_symptoms: ['blurry_cloudy'] }), vision: noVision, ai: aiFinding('cataract') });
  assert.equal(r.risk_level, 'high');
  assert.equal(r.consistency.key, 'consistent');
});

test('AI finding alone → moderate (ai_only)', () => {
  const r = assessRisk({ history: h(), vision: noVision, ai: aiFinding('pterygium') });
  assert.equal(r.risk_level, 'moderate');
  assert.equal(r.consistency.key, 'ai_only');
});

test('AI normal, no signals → low', () => {
  const r = assessRisk({ history: h(), vision: noVision, ai: aiNormal });
  assert.equal(r.risk_level, 'low');
});

test('AI normal but symptoms → moderate, flagged inconsistent', () => {
  const r = assessRisk({ history: h({ eye_symptoms: ['irritation'] }), vision: noVision, ai: aiNormal });
  assert.equal(r.risk_level, 'moderate');
  assert.equal(r.consistency.key, 'inconsistent');
});

test('AI not available and no signals → inconclusive (insufficient data)', () => {
  const r = assessRisk({ history: h(), vision: noVision, ai: { status: 'not_connected' } });
  assert.equal(r.risk_level, 'inconclusive');
  assert.equal(r.consistency.key, 'insufficient_data');
});

test('AI insufficient confidence is never treated as a finding', () => {
  const r = assessRisk({ history: h(), vision: noVision, ai: { status: 'insufficient_confidence', summary: { outcome: 'insufficient_confidence', diseases: [] } } });
  assert.equal(r.risk_level, 'inconclusive');
  assert.deepEqual(r.ai_findings, []);
});

test('glaucoma advice includes the external-photo limitation note', () => {
  const r = assessRisk({ history: h({ eye_symptoms: ['peripheral_loss'] }), vision: noVision, ai: aiNormal });
  const g = r.recommendation.diseases.find((d) => d.disease === 'glaucoma');
  assert.ok(g);
  assert.match(g.note, /ไม่สามารถยืนยัน/);
});

test('risk output never contains a blended "AI confidence"', () => {
  const r = assessRisk({ history: h({ eye_symptoms: ['blurry_cloudy'] }), vision: noVision, ai: aiFinding('cataract', 0.77) });
  assert.equal(JSON.stringify(r).includes('0.77'), false);
});

test('vision summary flags abnormal acuity by documented cut-off', () => {
  const v = summarizeVisionTest({
    visual_acuity: { distance_cm: 100, calibrated: true, right: { status: 'completed', logmar: 0.5 }, left: { status: 'completed', logmar: 0.1 } },
    visual_field: { right: { status: 'completed', quadrants: { upper_left: { shown: 4, seen: 1 }, upper_right: { shown: 4, seen: 4 } }, catch_trials: 4, false_positives: 0 }, left: { status: 'skipped' } },
  });
  assert.deepEqual(v.abnormal_tests.sort(), ['visual_acuity', 'visual_field']);
  assert.equal(v.tests.visual_acuity.left.abnormal, false);
  assert.equal(v.tests.visual_field.left.status, 'skipped');
});

test('unreliable visual field (many false positives) is not counted as abnormal', () => {
  const v = summarizeVisionTest({ visual_field: { right: { status: 'completed', quadrants: { upper_left: { shown: 4, seen: 0 } }, catch_trials: 3, false_positives: 3 }, left: { status: 'not_tested' } } });
  assert.equal(v.tests.visual_field.right.reliable, false);
  assert.deepEqual(v.abnormal_tests, []);
});
