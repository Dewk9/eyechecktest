import { AppError, Errors, unwrap } from '../utils/app-error.js';
import { ageGroupFor } from '../utils/helpers.js';
import { assertSubject } from './patient.service.js';
import { logActivity } from './activity.service.js';
import { summarizeMedicalHistory } from './assessment/summaries.js';

const FIELDS = ['age_group', 'family_glaucoma_history', 'diabetes', 'hypertension', 'steroid_use', 'outdoor_exposure', 'high_myopia', 'eye_injury', 'eye_symptoms', 'emergency_symptoms'];
const pick = (o) => Object.fromEntries(FIELDS.filter((k) => k in o).map((k) => [k, o[k]]));

function subjectAge(auth, patient) {
  return patient ? patient.current_age : auth.profile.age;
}

function checkAgeGroup(ageGroup, age) {
  const expected = ageGroupFor(age);
  if (expected && expected !== ageGroup) {
    throw new AppError(422, 'VALIDATION_ERROR', 'ช่วงอายุที่เลือกไม่ตรงกับอายุของผู้เข้ารับการตรวจ', [
      { field: 'age_group', message: `อายุ ${age} ปี ควรอยู่ในช่วง ${expected === 'under_40' ? 'ต่ำกว่า 40 ปี' : expected === '40_59' ? '40–59 ปี' : '60 ปีขึ้นไป'}` },
    ]);
  }
}

/**
 * Personal: one history per account — created once, then edited.
 * Staff: a new history row for every screening.
 */
export async function createHistory(auth, input) {
  const patient = await assertSubject(auth, input.patient_id ?? null);
  checkAgeGroup(input.age_group, subjectAge(auth, patient));

  if (auth.profile.account_type === 'personal') {
    const existing = unwrap(await auth.db.from('medical_histories').select('id').eq('user_id', auth.userId).is('patient_id', null).maybeSingle());
    if (existing) throw new AppError(409, 'HISTORY_EXISTS', 'คุณมีประวัติสุขภาพอยู่แล้ว กรุณาแก้ไขข้อมูลเดิม', { id: existing.id });
  }
  const row = unwrap(await auth.db.from('medical_histories')
    .insert({ ...pick(input), user_id: auth.userId, patient_id: patient?.id ?? null })
    .select('*').single(), 'ไม่สามารถบันทึกประวัติสุขภาพได้');
  await logActivity(auth.userId, 'medical_history_created', { history_id: row.id, emergency: row.emergency_symptoms });
  return { ...row, summary: summarizeMedicalHistory(row, subjectAge(auth, patient)) };
}

export async function updateHistory(auth, id, input) {
  const current = await getHistory(auth, id);
  const patient = current.patient_id ? await assertSubject(auth, current.patient_id) : null;
  checkAgeGroup(input.age_group, subjectAge(auth, patient));
  const row = unwrap(await auth.db.from('medical_histories').update(pick(input)).eq('id', id).eq('user_id', auth.userId).select('*').single(), 'ไม่สามารถแก้ไขประวัติสุขภาพได้');
  await logActivity(auth.userId, 'medical_history_updated', { history_id: id });
  return { ...row, summary: summarizeMedicalHistory(row, subjectAge(auth, patient)) };
}

export async function getHistory(auth, id) {
  const row = unwrap(await auth.db.from('medical_histories').select('*').eq('id', id).eq('user_id', auth.userId).maybeSingle());
  if (!row) throw Errors.notFound('ไม่พบประวัติสุขภาพ');
  return { ...row, summary: summarizeMedicalHistory(row) };
}

/** Latest personal history (or null) */
export async function getMyHistory(auth) {
  const row = unwrap(await auth.db.from('medical_histories').select('*').eq('user_id', auth.userId).is('patient_id', null).maybeSingle());
  return row ? { ...row, summary: summarizeMedicalHistory(row, auth.profile.age) } : null;
}

/** All histories of one patient, newest first (staff) */
export async function listPatientHistories(auth, patientId) {
  const patient = await assertSubject(auth, patientId);
  const rows = unwrap(await auth.db.from('medical_histories').select('*').eq('patient_id', patient.id).order('created_at', { ascending: false }).limit(100));
  return rows.map((r) => ({ ...r, summary: summarizeMedicalHistory(r, patient.current_age) }));
}
