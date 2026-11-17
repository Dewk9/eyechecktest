import { getServiceClient } from '../config/supabase.js';
import { AppError, Errors, unwrap } from '../utils/app-error.js';
import { removeDatasetImages } from './storage.service.js';
import { logActivity } from './activity.service.js';

export async function listMyConsents(auth) {
  return unwrap(await auth.db
    .from('consent_records')
    .select('id, consent_type, consent_status, consent_version, consent_date, withdrawn_at, screening_id, patient_id, screenings(screening_code), patients(full_name)')
    .eq('user_id', auth.userId)
    .order('consent_date', { ascending: false })
    .limit(200));
}

/**
 * Withdraw consent (PDPA). For image-use consent the dataset copy is deleted
 * immediately. If the image was already pushed to Roboflow, its id is written
 * to the audit log so an admin can remove it there (Roboflow deletion is not
 * guaranteed through the public API).
 */
export async function withdrawConsent(auth, id) {
  const c = unwrap(await auth.db.from('consent_records').select('*').eq('id', id).eq('user_id', auth.userId).maybeSingle());
  if (!c) throw Errors.notFound('ไม่พบรายการความยินยอม');
  if (c.consent_status !== 'granted') throw new AppError(409, 'NOT_GRANTED', 'รายการนี้ไม่ได้อยู่ในสถานะยินยอม');
  if (c.consent_type === 'data_processing') {
    throw new AppError(409, 'USE_ACCOUNT_DELETION', 'การเพิกถอนความยินยอมในการประมวลผลข้อมูลหลัก ให้ใช้เมนู "ลบบัญชีและข้อมูลทั้งหมด" ในหน้าข้อมูลส่วนตัว');
  }

  const now = new Date().toISOString();
  unwrap(await auth.db.from('consent_records').update({ consent_status: 'withdrawn', withdrawn_at: now }).eq('id', id).eq('user_id', auth.userId));

  const svc = getServiceClient();
  const ds = unwrap(await svc.from('dataset_images').select('id, storage_path, roboflow_image_id').eq('consent_record_id', id));
  await removeDatasetImages(ds.map((d) => d.storage_path));
  if (ds.length) unwrap(await svc.from('dataset_images').delete().in('id', ds.map((d) => d.id)));
  if (c.screening_id) {
    await svc.from('screening_images').update({ consent_status: 'withdrawn' }).eq('screening_id', c.screening_id);
    await svc.from('screenings').update({ dataset_consent: false }).eq('id', c.screening_id);
  }
  const roboflowIds = ds.map((d) => d.roboflow_image_id).filter(Boolean);
  await logActivity(auth.userId, 'consent_withdrawn', { consent_id: id, dataset_images_removed: ds.length, roboflow_images_to_remove: roboflowIds });
  return { id, consent_status: 'withdrawn', withdrawn_at: now, dataset_images_removed: ds.length, roboflow_pending_removal: roboflowIds.length };
}
