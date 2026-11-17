import { Errors, unwrap } from '../utils/app-error.js';
import { assertSubject } from './patient.service.js';
import { logActivity } from './activity.service.js';
import { summarizeVisionTest, perEyeResult } from './assessment/summaries.js';

const TESTS = ['visual_acuity', 'color_vision', 'central_visual_field', 'visual_field', 'near_vision', 'contrast_sensitivity'];

export async function createVisionTest(auth, input) {
  const patient = await assertSubject(auth, input.patient_id ?? null);
  const record = { user_id: auth.userId, patient_id: patient?.id ?? null };
  for (const t of TESTS) record[t] = input[t] ?? null;
  // Summary is computed on the server with documented criteria (not trusted from the client)
  const summary = summarizeVisionTest(record);
  record.summary = { ...summary, tests: undefined, abnormal_tests: summary.abnormal_tests, tested_count: summary.tested_count };
  record.right_eye_result = perEyeResult(summary, 'right');
  record.left_eye_result = perEyeResult(summary, 'left');

  const row = unwrap(await auth.db.from('vision_tests').insert(record).select('*').single(), 'ไม่สามารถบันทึกผลการทดสอบการมองเห็นได้');
  await logActivity(auth.userId, 'vision_test_created', { vision_test_id: row.id, tested: summary.tested_count });
  return { ...row, summary: summarizeVisionTest(row) };
}

export async function getVisionTest(auth, id) {
  const row = unwrap(await auth.db.from('vision_tests').select('*').eq('id', id).eq('user_id', auth.userId).maybeSingle());
  if (!row) throw Errors.notFound('ไม่พบผลการทดสอบการมองเห็น');
  return { ...row, summary: summarizeVisionTest(row) };
}

export async function getVisionTestForScreening(auth, screeningId) {
  const s = unwrap(await auth.db.from('screenings').select('vision_test_id').eq('id', screeningId).eq('user_id', auth.userId).maybeSingle());
  if (!s) throw Errors.notFound('ไม่พบข้อมูลการตรวจ');
  if (!s.vision_test_id) return null;
  return getVisionTest(auth, s.vision_test_id);
}

export async function listVisionTests(auth, patientId) {
  let q = auth.db.from('vision_tests').select('id, patient_id, created_at, summary, left_eye_result, right_eye_result').eq('user_id', auth.userId);
  if (patientId) {
    await assertSubject(auth, patientId);
    q = q.eq('patient_id', patientId);
  } else if (auth.profile.account_type === 'personal') {
    q = q.is('patient_id', null);
  }
  return unwrap(await q.order('created_at', { ascending: false }).limit(100));
}
