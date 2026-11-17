import crypto from 'node:crypto';
import { getServiceClient } from '../config/supabase.js';
import { AppError, Errors, unwrap } from '../utils/app-error.js';
import { generateScreeningCode, sanitizeSearch, pageRange, paged, dateRange, calcAge } from '../utils/helpers.js';
import { logger } from '../utils/logger.js';
import { assertSubject } from './patient.service.js';
import { getHistory } from './medical-history.service.js';
import { getVisionTest } from './vision-test.service.js';
import { inspectAndNormalizeImage, qualityRecord } from './image-quality.service.js';
import { uploadScreeningImage, removeScreeningImages, signedScreeningUrl, copyScreeningToDataset, removeDatasetImages } from './storage.service.js';
import { getConsentVersion } from './settings.service.js';
import { logActivity } from './activity.service.js';
import { DISCLAIMER } from './assessment/knowledge.js';

const STAFF_HISTORY_MAX_AGE_H = 12;

export async function createScreening(auth, input, file) {
  if (!file) throw new AppError(422, 'IMAGE_REQUIRED', 'กรุณาถ่ายหรืออัปโหลดภาพดวงตา');
  const patient = await assertSubject(auth, input.patient_id ?? null);
  const subjectId = patient?.id ?? null;

  // Medical history must belong to the same subject
  const history = await getHistory(auth, input.medical_history_id);
  if ((history.patient_id ?? null) !== subjectId) throw Errors.badRequest('ประวัติสุขภาพไม่ตรงกับผู้เข้ารับการตรวจ');
  if (auth.profile.account_type === 'staff') {
    const ageH = (Date.now() - new Date(history.created_at).getTime()) / 3600e3;
    if (ageH > STAFF_HISTORY_MAX_AGE_H) {
      throw new AppError(422, 'HISTORY_OUTDATED', 'บัญชีเจ้าหน้าที่ต้องซักประวัติใหม่ทุกครั้งที่ตรวจ กรุณาซักประวัติใหม่');
    }
  }
  if (input.vision_test_id) {
    const vt = await getVisionTest(auth, input.vision_test_id);
    if ((vt.patient_id ?? null) !== subjectId) throw Errors.badRequest('ผลทดสอบการมองเห็นไม่ตรงกับผู้เข้ารับการตรวจ');
  }

  // Image quality gate (server-side, authoritative)
  const img = await inspectAndNormalizeImage(file.buffer);
  if (!img.quality.passed) {
    throw new AppError(422, 'IMAGE_QUALITY_FAILED', 'ภาพไม่ผ่านเกณฑ์คุณภาพ กรุณาถ่ายใหม่', qualityRecord(img.quality));
  }

  const path = await uploadScreeningImage(auth.userId, img.buffer, img.mime);
  let screening;
  try {
    for (let attempt = 0; attempt < 3 && !screening; attempt++) {
      const res = await auth.db.from('screenings').insert({
        screening_code: generateScreeningCode(),
        user_id: auth.userId,
        patient_id: subjectId,
        medical_history_id: history.id,
        vision_test_id: input.vision_test_id ?? null,
        eye_side: input.eye_side,
        image_path: path,
        image_quality_status: 'passed',
        image_quality: qualityRecord(img.quality),
        ai_status: 'pending',
        dataset_consent: input.dataset_consent,
      }).select('*').single();
      if (res.error?.code === '23505' && attempt < 2) continue; // screening_code collision → retry
      screening = unwrap(res, 'ไม่สามารถบันทึกข้อมูลการตรวจได้');
    }
  } catch (err) {
    await removeScreeningImages([path]);
    throw err;
  }

  const consentStatus = input.dataset_consent ? 'granted' : 'denied';
  unwrap(await auth.db.from('screening_images').insert({ screening_id: screening.id, storage_path: path, image_type: 'original', consent_status: consentStatus }));

  const consentVersion = input.consent_version || (await getConsentVersion());
  const consent = unwrap(await auth.db.from('consent_records').insert({
    user_id: auth.userId, patient_id: subjectId, screening_id: screening.id,
    consent_type: 'dataset_image_use', consent_status: consentStatus, consent_version: consentVersion,
  }).select('*').single());

  // With consent only: a copy goes to the dataset review queue (never straight to training)
  let datasetWarning = null;
  if (input.dataset_consent) {
    const dsPath = `pending-review/${crypto.randomUUID()}.jpg`;
    try {
      await copyScreeningToDataset(path, dsPath);
      const { error } = await getServiceClient().from('dataset_images').insert({
        source: 'screening', screening_id: screening.id, owner_user_id: auth.userId, subject_patient_id: subjectId,
        consent_record_id: consent.id, storage_path: dsPath, consent_status: 'granted', consent_date: consent.consent_date,
        review_status: 'pending', dataset_status: 'local',
      });
      if (error) {
        await removeDatasetImages([dsPath]);
        throw error;
      }
    } catch (err) {
      logger.warn('dataset copy failed', { error: err, screening: screening.id });
      datasetWarning = 'ไม่สามารถส่งภาพเข้าคิวตรวจสอบ Dataset ได้ (การตรวจคัดกรองยังดำเนินต่อได้ตามปกติ)';
    }
  }

  await logActivity(auth.userId, 'screening_created', { screening_id: screening.id, eye_side: screening.eye_side, dataset_consent: input.dataset_consent });
  return { screening, quality: qualityRecord(img.quality), datasetWarning };
}

const LIST_COLUMNS = 'id, screening_code, screening_date, eye_side, screening_type, primary_finding, risk_level, ai_status, model_version, is_saved, patient_id, patients(full_name)';
const SORTS = { screening_date: 'screening_date', screening_code: 'screening_code', risk_level: 'risk_level', primary_finding: 'primary_finding' };

export async function listScreenings(auth, q) {
  const r = pageRange(q.page, q.pageSize);
  let query = auth.db.from('screenings').select(LIST_COLUMNS, { count: 'exact' }).eq('user_id', auth.userId);
  query = applyFilters(query, q);
  if (q.patient_id) query = query.eq('patient_id', q.patient_id);

  const term = sanitizeSearch(q.search);
  if (term) {
    const ors = [`screening_code.ilike.%${term}%`];
    if (auth.profile.account_type === 'staff') {
      const pts = unwrap(await auth.db.from('patients').select('id').eq('owner_id', auth.userId).ilike('full_name', `%${term}%`).limit(200));
      if (pts.length) ors.push(`patient_id.in.(${pts.map((p) => p.id).join(',')})`);
    }
    query = query.or(ors.join(','));
  }

  const { data, count, error } = await query
    .order(SORTS[q.sort] ?? 'screening_date', { ascending: q.order === 'asc', nullsFirst: false })
    .order('created_at', { ascending: false })
    .range(r.from, r.to);
  if (error) unwrap({ error });

  const items = (data ?? []).map((s) => ({
    ...s,
    subject_name: s.patients?.full_name ?? (s.patient_id ? null : auth.profile.full_name),
    patients: undefined,
  }));
  return paged(items, count, r);
}

export function applyFilters(query, q) {
  const range = dateRange(q.from, q.to);
  if (range.from) query = query.gte('screening_date', range.from);
  if (range.to) query = query.lte('screening_date', range.to);
  if (q.disease) query = query.eq('primary_finding', q.disease);
  if (q.risk) query = query.eq('risk_level', q.risk);
  if (q.saved === 'saved') query = query.eq('is_saved', true);
  if (q.saved === 'draft') query = query.eq('is_saved', false);
  return query;
}

async function loadOwned(auth, id) {
  const s = unwrap(await auth.db.from('screenings').select('*').eq('id', id).eq('user_id', auth.userId).maybeSingle());
  if (!s) throw Errors.notFound('ไม่พบข้อมูลการตรวจ');
  return s;
}

/**
 * Full result. `db` is the RLS client for users; admins use the service client
 * (and only see the image if consent for storage/use was granted).
 */
export async function buildResult(db, screening, { viewerProfile, admin = false } = {}) {
  const [predRes, riskRes, patientRes, ownerRes, imgRes] = await Promise.all([
    db.from('ai_predictions').select('predicted_class, disease_key, confidence_score, bounding_box, model_version, created_at').eq('screening_id', screening.id).order('confidence_score', { ascending: false }),
    db.from('risk_assessments').select('*').eq('screening_id', screening.id).maybeSingle(),
    screening.patient_id ? db.from('patients').select('id, full_name, birth_date, age, gender').eq('id', screening.patient_id).maybeSingle() : Promise.resolve({ data: null }),
    admin ? db.from('profiles').select('id, full_name, username, account_type, birth_date, gender').eq('id', screening.user_id).maybeSingle() : Promise.resolve({ data: null }),
    db.from('screening_images').select('consent_status').eq('screening_id', screening.id).eq('image_type', 'original').maybeSingle(),
  ]);
  const predictions = unwrap(predRes) ?? [];
  const risk = unwrap(riskRes);
  const patient = unwrap(patientRes);
  const owner = admin ? unwrap(ownerRes) : viewerProfile;
  const imageConsent = unwrap(imgRes)?.consent_status ?? 'denied';

  // Data minimisation: administrators never receive the subject's name
  const subject = patient
    ? { type: 'patient', id: patient.id, full_name: admin ? null : patient.full_name, age: calcAge(patient.birth_date), gender: patient.gender }
    : { type: 'self', id: owner?.id, full_name: admin ? null : owner?.full_name, age: calcAge(owner?.birth_date), gender: owner?.gender };

  const canSeeImage = !admin || imageConsent === 'granted';
  return {
    screening: {
      id: screening.id,
      screening_code: screening.screening_code,
      screening_date: screening.screening_date,
      eye_side: screening.eye_side,
      screening_type: screening.screening_type,
      image_quality_status: screening.image_quality_status,
      image_quality: screening.image_quality,
      ai_status: screening.ai_status,
      ai_error: screening.ai_error,
      model_project: screening.model_project,
      model_version: screening.model_version,
      primary_finding: screening.primary_finding,
      risk_level: screening.risk_level,
      dataset_consent: screening.dataset_consent,
      is_saved: screening.is_saved,
      saved_at: screening.saved_at,
      patient_id: screening.patient_id,
    },
    subject,
    ...(admin ? { owner: owner ? { id: owner.id, username: owner.username, account_type: owner.account_type } : null } : {}),
    image_url: canSeeImage ? await signedScreeningUrl(screening.image_path) : null,
    image_hidden_reason: canSeeImage ? null : 'ผู้เข้ารับการตรวจไม่ได้ให้ความยินยอมให้จัดเก็บ/ใช้ภาพ ผู้ดูแลระบบจึงไม่สามารถดูภาพนี้ได้',
    predictions,
    ai: risk?.ai_summary ?? null,
    risk_assessment: risk
      ? {
        risk_level: risk.risk_level,
        risk_factors: risk.risk_factors,
        recommendation: risk.recommendation,
        assessment_version: risk.assessment_version,
        created_at: risk.created_at,
      }
      : null,
    medical_history: risk?.medical_history_summary ?? null,
    vision_test: risk?.vision_test_summary ?? null,
    disclaimer: DISCLAIMER,
  };
}

export async function getResult(auth, id) {
  const s = await loadOwned(auth, id);
  return buildResult(auth.db, s, { viewerProfile: auth.profile });
}

export async function saveResult(auth, id) {
  const s = await loadOwned(auth, id);
  if (['pending', 'processing'].includes(s.ai_status)) {
    throw new AppError(409, 'NOT_ANALYZED', 'ยังไม่ได้วิเคราะห์ผล ไม่สามารถบันทึกได้');
  }
  if (!s.is_saved) {
    unwrap(await auth.db.from('screenings').update({ is_saved: true, saved_at: new Date().toISOString() }).eq('id', id).eq('user_id', auth.userId));
    await logActivity(auth.userId, 'screening_saved', { screening_id: id });
  }
  return { id, is_saved: true };
}

export async function deleteScreening(auth, id) {
  const s = await loadOwned(auth, id);
  unwrap(await auth.db.from('screenings').delete().eq('id', id).eq('user_id', auth.userId));
  await removeScreeningImages([s.image_path]);
  // A consented dataset copy is kept (consent stays valid until withdrawn).
  await logActivity(auth.userId, 'screening_deleted', { screening_id: id });
}

export { loadOwned };
