import { getServiceClient } from '../config/supabase.js';
import { AppError, Errors, unwrap } from '../utils/app-error.js';
import { calcAge, sanitizeSearch, pageRange, paged } from '../utils/helpers.js';
import { logActivity } from './activity.service.js';
import { removeScreeningImages, removeDatasetImages } from './storage.service.js';

function checkAgeMatchesBirthDate(age, birthDate) {
  const computed = calcAge(birthDate);
  if (computed === null || Math.abs(computed - age) > 1) {
    throw new AppError(422, 'VALIDATION_ERROR', `อายุที่กรอก (${age} ปี) ไม่สอดคล้องกับวันเกิด (คำนวณได้ ${computed} ปี)`, [
      { field: 'age', message: 'อายุไม่สอดคล้องกับวันเกิด' },
    ]);
  }
}

export async function listPatients(auth, { search, page, pageSize }) {
  const r = pageRange(page, pageSize);
  let q = auth.db.from('patients').select('*', { count: 'exact' }).eq('owner_id', auth.userId);
  const term = sanitizeSearch(search);
  if (term) q = q.ilike('full_name', `%${term}%`);
  const { data, count, error } = await q.order('updated_at', { ascending: false }).range(r.from, r.to);
  if (error) throw unwrapErr(error);

  // latest screening per patient (one query)
  const ids = (data ?? []).map((p) => p.id);
  let latest = {};
  if (ids.length) {
    const rows = unwrap(await auth.db.from('screenings')
      .select('patient_id, screening_date, risk_level, primary_finding')
      .in('patient_id', ids)
      .order('screening_date', { ascending: false }));
    for (const s of rows) {
      if (!latest[s.patient_id]) latest[s.patient_id] = { ...s, count: 0 };
      latest[s.patient_id].count++;
    }
  }
  const items = (data ?? []).map((p) => ({ ...p, current_age: calcAge(p.birth_date), latest_screening: latest[p.id] ?? null }));
  return paged(items, count, r);
}

function unwrapErr(error) {
  try { unwrap({ error }); } catch (e) { return e; }
  return error;
}

export async function getPatient(auth, id) {
  const p = unwrap(await auth.db.from('patients').select('*').eq('id', id).eq('owner_id', auth.userId).maybeSingle());
  if (!p) throw Errors.notFound('ไม่พบข้อมูลผู้เข้ารับการตรวจ');
  return { ...p, current_age: calcAge(p.birth_date) };
}

export async function createPatient(auth, input) {
  checkAgeMatchesBirthDate(input.age, input.birth_date);
  const row = unwrap(await auth.db.from('patients').insert({ ...input, owner_id: auth.userId }).select('*').single(), 'ไม่สามารถเพิ่มรายชื่อได้');
  await logActivity(auth.userId, 'patient_created', { patient_id: row.id });
  return row;
}

export async function updatePatient(auth, id, input) {
  await getPatient(auth, id);
  checkAgeMatchesBirthDate(input.age, input.birth_date);
  const row = unwrap(await auth.db.from('patients').update(input).eq('id', id).eq('owner_id', auth.userId).select('*').single(), 'ไม่สามารถแก้ไขข้อมูลได้');
  await logActivity(auth.userId, 'patient_updated', { patient_id: id });
  return row;
}

/** Deletes the patient and every screening/history/vision test (FK cascade) + images. */
export async function deletePatient(auth, id) {
  await getPatient(auth, id);
  const scr = unwrap(await auth.db.from('screenings').select('image_path').eq('patient_id', id));
  const ds = unwrap(await getServiceClient().from('dataset_images').select('storage_path, roboflow_image_id').eq('subject_patient_id', id));
  unwrap(await auth.db.from('patients').delete().eq('id', id).eq('owner_id', auth.userId));
  await removeScreeningImages(scr.map((s) => s.image_path));
  await removeDatasetImages(ds.map((d) => d.storage_path));
  await logActivity(auth.userId, 'patient_deleted', {
    patient_id: id,
    screenings_deleted: scr.length,
    roboflow_images_to_remove: ds.map((d) => d.roboflow_image_id).filter(Boolean),
  });
}

/** Owner check used by other services (staff must own the patient). */
export async function assertSubject(auth, patientId) {
  const type = auth.profile.account_type;
  if (type === 'staff') {
    if (!patientId) throw new AppError(422, 'PATIENT_REQUIRED', 'บัญชีเจ้าหน้าที่ต้องเลือกผู้เข้ารับการตรวจ');
    return getPatient(auth, patientId);
  }
  if (patientId) throw Errors.forbidden('บัญชีส่วนบุคคลไม่สามารถบันทึกข้อมูลของผู้อื่นได้');
  return null;
}
