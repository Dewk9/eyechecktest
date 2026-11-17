import crypto from 'node:crypto';
import { getServiceClient } from '../config/supabase.js';
import { AppError, Errors, unwrap } from '../utils/app-error.js';
import { pageRange, paged } from '../utils/helpers.js';
import { logActivity } from './activity.service.js';
import { inspectAndNormalizeImage } from './image-quality.service.js';
import {
  uploadDatasetImage, moveDatasetImage, removeDatasetImages, signedDatasetUrls, signedDatasetUrl, downloadDatasetImage,
} from './storage.service.js';
import { roboflow } from '../roboflow/client.js';
import { getActiveModelConfig } from './settings.service.js';

const svc = () => getServiceClient();
const CLASSES = ['pinguecula', 'cataract', 'glaucoma', 'pterygium', 'normal', 'other'];
const COLS = 'id, image_id, source, screening_id, suggested_class, disease_class, storage_path, consent_status, consent_date, review_status, dataset_status, reject_reason, roboflow_image_id, roboflow_error, uploaded_at, reviewed_at';

const fileName = (path) => path.split('/').pop();

export async function listDataset(q) {
  const r = pageRange(q.page, q.pageSize);
  let query = svc().from('dataset_images').select(COLS, { count: 'exact' }).eq('consent_status', 'granted');
  if (q.review_status) query = query.eq('review_status', q.review_status);
  if (q.disease_class) query = query.eq('disease_class', q.disease_class);
  if (q.dataset_status) query = query.eq('dataset_status', q.dataset_status);
  if (q.search) {
    const s = q.search.trim().toLowerCase();
    if (!/^[0-9a-f-]{36}$/.test(s)) throw new AppError(422, 'VALIDATION_ERROR', 'ค้นหาด้วย Image ID (UUID) แบบเต็มเท่านั้น');
    query = query.or(`image_id.eq.${s},id.eq.${s}`);
  }
  const { data, count, error } = await query.order('uploaded_at', { ascending: false }).range(r.from, r.to);
  if (error) unwrap({ error });
  const urls = await signedDatasetUrls((data ?? []).map((d) => d.storage_path));
  return paged((data ?? []).map((d) => ({ ...d, url: urls[d.storage_path] ?? null })), count, r);
}

async function sampleUrls(c) {
  const s = unwrap(await svc().from('dataset_images').select('storage_path').eq('review_status', 'approved').eq('disease_class', c).order('reviewed_at', { ascending: false }).limit(4));
  const urls = await signedDatasetUrls(s.map((x) => x.storage_path));
  return s.map((x) => urls[x.storage_path]).filter(Boolean);
}

export async function datasetSummary() {
  const SAMPLE_CLASSES = ['pinguecula', 'cataract', 'glaucoma', 'pterygium'];
  // sample images per class (approved only) are fetched concurrently with the counts
  const samplesP = Promise.all(SAMPLE_CLASSES.map(sampleUrls));
  samplesP.catch(() => {}); // awaited below
  const rows = [];
  for (let from = 0; from < 100000; from += 1000) {
    const page = unwrap(await svc().from('dataset_images').select('disease_class, suggested_class, review_status, dataset_status').eq('consent_status', 'granted').range(from, from + 999));
    rows.push(...page);
    if (page.length < 1000) break;
  }
  const byClass = Object.fromEntries(CLASSES.map((c) => [c, { approved: 0, uploaded: 0 }]));
  const byStatus = { pending: 0, approved: 0, rejected: 0 };
  for (const r of rows) {
    byStatus[r.review_status]++;
    if (r.review_status === 'approved' && byClass[r.disease_class]) {
      byClass[r.disease_class].approved++;
      if (r.dataset_status === 'uploaded_to_roboflow') byClass[r.disease_class].uploaded++;
    }
  }
  const sampleLists = await samplesP;
  const samples = Object.fromEntries(SAMPLE_CLASSES.map((c, i) => [c, sampleLists[i]]));
  return { total: rows.length, byStatus, byClass, samples };
}

async function getItem(id) {
  const row = unwrap(await svc().from('dataset_images').select(COLS).eq('id', id).maybeSingle());
  if (!row) throw Errors.notFound('ไม่พบภาพใน Dataset');
  return row;
}

export async function getDatasetItem(id) {
  const row = await getItem(id);
  return { ...row, url: await signedDatasetUrl(row.storage_path) };
}

/** Admin upload: goes to pending-review like every other image. */
export async function addDatasetImage(admin, file, suggestedClass) {
  if (!file) throw new AppError(422, 'IMAGE_REQUIRED', 'กรุณาเลือกไฟล์ภาพ');
  const img = await inspectAndNormalizeImage(file.buffer);
  const path = `pending-review/${crypto.randomUUID()}.jpg`;
  await uploadDatasetImage(path, img.buffer, img.mime);
  const row = unwrap(await svc().from('dataset_images').insert({
    source: 'admin_upload', storage_path: path, consent_status: 'granted', consent_date: new Date().toISOString(),
    suggested_class: suggestedClass ?? null, review_status: 'pending', dataset_status: 'local',
  }).select(COLS).single());
  await logActivity(admin.userId, 'admin_dataset_added', { dataset_id: row.id });
  return { ...row, quality: img.quality.checks };
}

export async function approve(admin, id, diseaseClass) {
  const item = await getItem(id);
  if (item.consent_status !== 'granted') throw new AppError(409, 'NO_CONSENT', 'ภาพนี้ไม่มีความยินยอม ไม่สามารถใช้ได้');
  const to = `approved/${diseaseClass}/${fileName(item.storage_path)}`;
  await moveDatasetImage(item.storage_path, to);
  const row = unwrap(await svc().from('dataset_images').update({
    review_status: 'approved', disease_class: diseaseClass, reject_reason: null, storage_path: to,
    reviewed_at: new Date().toISOString(), reviewed_by: admin.userId,
  }).eq('id', id).select(COLS).single());
  await logActivity(admin.userId, 'admin_dataset_approved', { dataset_id: id, disease_class: diseaseClass });
  return row;
}

export async function reject(admin, id, reason) {
  const item = await getItem(id);
  const to = `rejected/${fileName(item.storage_path)}`;
  await moveDatasetImage(item.storage_path, to);
  const row = unwrap(await svc().from('dataset_images').update({
    review_status: 'rejected', reject_reason: reason, storage_path: to,
    reviewed_at: new Date().toISOString(), reviewed_by: admin.userId,
  }).eq('id', id).select(COLS).single());
  await logActivity(admin.userId, 'admin_dataset_rejected', { dataset_id: id });
  return row;
}

/** Re-classify an approved image (moves the file to the new class folder). */
export async function updateClass(admin, id, diseaseClass) {
  const item = await getItem(id);
  if (item.review_status !== 'approved') {
    throw new AppError(409, 'NOT_APPROVED', 'แก้ไขประเภทได้เฉพาะภาพที่อนุมัติแล้ว (ภาพที่รอตรวจให้ใช้ปุ่มอนุมัติ)');
  }
  const to = `approved/${diseaseClass}/${fileName(item.storage_path)}`;
  await moveDatasetImage(item.storage_path, to);
  const row = unwrap(await svc().from('dataset_images').update({
    disease_class: diseaseClass, storage_path: to, reviewed_at: new Date().toISOString(), reviewed_by: admin.userId,
  }).eq('id', id).select(COLS).single());
  await logActivity(admin.userId, 'admin_dataset_reclassified', { dataset_id: id, disease_class: diseaseClass });
  return row;
}

export async function removeItem(admin, id) {
  const item = await getItem(id);
  await removeDatasetImages([item.storage_path]);
  unwrap(await svc().from('dataset_images').delete().eq('id', id));
  await logActivity(admin.userId, 'admin_dataset_deleted', { dataset_id: id, roboflow_image_id: item.roboflow_image_id });
  return { id, roboflow_image_id: item.roboflow_image_id };
}

/**
 * Upload an APPROVED image to the active Roboflow project. The class is sent
 * as a tag ("class:<name>"). Bounding boxes / labels must still be annotated
 * in Roboflow — EYE Check never invents annotations.
 */
export async function sendToRoboflow(admin, id) {
  const item = await getItem(id);
  if (item.review_status !== 'approved') throw new AppError(409, 'NOT_APPROVED', 'ต้องอนุมัติภาพก่อนส่งไปยัง Roboflow');
  if (item.consent_status !== 'granted') throw new AppError(409, 'NO_CONSENT', 'ภาพนี้ไม่มีความยินยอม');
  const active = await getActiveModelConfig();
  if (!active) throw new AppError(503, 'AI_NOT_CONFIGURED', 'ยังไม่ได้เลือกโปรเจกต์ Roboflow');

  const buffer = await downloadDatasetImage(item.storage_path);
  try {
    const res = await roboflow.upload({
      project: active.project,
      imageBase64: buffer.toString('base64'),
      name: `${item.image_id}.jpg`,
      tags: ['eyecheck', `class:${item.disease_class}`],
    });
    const rfId = res.id ?? null;
    const row = unwrap(await svc().from('dataset_images').update({
      dataset_status: 'uploaded_to_roboflow', roboflow_image_id: rfId, roboflow_error: res.duplicate ? 'duplicate' : null,
    }).eq('id', id).select(COLS).single());
    await logActivity(admin.userId, 'admin_dataset_uploaded_roboflow', { dataset_id: id, roboflow_image_id: rfId, duplicate: Boolean(res.duplicate) });
    return { ...row, duplicate: Boolean(res.duplicate) };
  } catch (err) {
    await svc().from('dataset_images').update({ dataset_status: 'upload_failed', roboflow_error: String(err.message).slice(0, 300) }).eq('id', id);
    throw err;
  }
}
