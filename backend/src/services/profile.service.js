import { getServiceClient } from '../config/supabase.js';
import { AppError, unwrap } from '../utils/app-error.js';
import { calcAge } from '../utils/helpers.js';
import { logActivity } from './activity.service.js';
import { verifyPassword } from './auth.service.js';
import { removeScreeningImages, removeDatasetImages } from './storage.service.js';

const PERSONAL_FIELDS = ['full_name', 'birth_date', 'gender'];
const STAFF_FIELDS = ['full_name', 'position', 'workplace'];

export function publicProfile(p) {
  if (!p) return null;
  return {
    id: p.id,
    full_name: p.full_name,
    username: p.username,
    account_type: p.account_type,
    role: p.role,
    status: p.status,
    birth_date: p.birth_date,
    age: calcAge(p.birth_date),
    gender: p.gender,
    position: p.position,
    workplace: p.workplace,
    created_at: p.created_at,
    last_login_at: p.last_login_at,
  };
}

export async function updateMe(auth, input) {
  const allowed = auth.profile.account_type === 'personal' ? PERSONAL_FIELDS : STAFF_FIELDS;
  const patch = Object.fromEntries(Object.entries(input).filter(([k]) => allowed.includes(k)));
  if (!Object.keys(patch).length) throw new AppError(422, 'VALIDATION_ERROR', 'ไม่มีข้อมูลที่แก้ไขได้สำหรับบัญชีประเภทนี้');
  // RLS + column grants enforce that users can only change these columns on their own row
  const row = unwrap(await auth.db.from('profiles').update(patch).eq('id', auth.userId).select('*').single(), 'ไม่สามารถบันทึกข้อมูลส่วนตัวได้');
  await logActivity(auth.userId, 'profile_updated', { fields: Object.keys(patch) });
  return publicProfile(row);
}

/**
 * Right to erasure (PDPA): deletes the account and all related data.
 * Images that were consented for the dataset are also removed (consent is
 * withdrawn with the account). Images already uploaded to Roboflow cannot be
 * removed automatically — their ids are written to the audit log for admins.
 */
export async function deleteMyAccount(auth, password) {
  if (!(await verifyPassword(auth.profile.username, password))) {
    throw new AppError(400, 'WRONG_PASSWORD', 'รหัสผ่านไม่ถูกต้อง');
  }
  const svc = getServiceClient();
  const screenings = unwrap(await svc.from('screenings').select('image_path').eq('user_id', auth.userId));
  const dataset = unwrap(await svc.from('dataset_images').select('storage_path, roboflow_image_id').eq('owner_user_id', auth.userId));

  await removeScreeningImages(screenings.map((s) => s.image_path));
  await removeDatasetImages(dataset.map((d) => d.storage_path));

  const roboflowIds = dataset.map((d) => d.roboflow_image_id).filter(Boolean);
  await logActivity(null, 'account_deleted', {
    account_type: auth.profile.account_type,
    roboflow_images_to_remove: roboflowIds,
  });

  const { error } = await svc.auth.admin.deleteUser(auth.userId); // cascades to profiles and all owned rows
  if (error) throw new AppError(503, 'AUTH_UNAVAILABLE', 'ไม่สามารถลบบัญชีได้ในขณะนี้ กรุณาลองใหม่');
}
