import crypto from 'node:crypto';
import { getServiceClient } from '../config/supabase.js';
import { config } from '../config/env.js';
import { AppError } from '../utils/app-error.js';
import { logger } from '../utils/logger.js';

const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const SIGNED_URL_TTL = 60 * 10; // 10 minutes

function bucket(name) {
  return getServiceClient().storage.from(name);
}

function storageError(error, msg = 'ไม่สามารถจัดเก็บไฟล์ภาพได้') {
  const e = new AppError(503, 'STORAGE_ERROR', msg);
  e.cause = error;
  return e;
}

/** File names are random UUIDs — never personal data. */
export function randomImageName(mime) {
  return `${crypto.randomUUID()}.${EXT[mime] ?? 'jpg'}`;
}

export async function uploadScreeningImage(userId, buffer, mime) {
  const path = `${userId}/${randomImageName(mime)}`;
  const { error } = await bucket(config.supabase.screeningBucket).upload(path, buffer, { contentType: mime, upsert: false });
  if (error) throw storageError(error);
  return path;
}

export async function downloadScreeningImage(path) {
  const { data, error } = await bucket(config.supabase.screeningBucket).download(path);
  if (error) throw storageError(error, 'ไม่สามารถอ่านไฟล์ภาพได้');
  return Buffer.from(await data.arrayBuffer());
}

export async function signedScreeningUrl(path) {
  if (!path) return null;
  const { data, error } = await bucket(config.supabase.screeningBucket).createSignedUrl(path, SIGNED_URL_TTL);
  if (error) {
    logger.warn('signed url failed', { error });
    return null;
  }
  return data.signedUrl;
}

export async function removeScreeningImages(paths) {
  const list = paths.filter(Boolean);
  if (!list.length) return;
  const { error } = await bucket(config.supabase.screeningBucket).remove(list);
  if (error) logger.warn('screening image remove failed', { error, count: list.length });
}

// ---------------- dataset bucket ----------------
export async function uploadDatasetImage(path, buffer, mime) {
  const { error } = await bucket(config.supabase.datasetBucket).upload(path, buffer, { contentType: mime, upsert: false });
  if (error) throw storageError(error);
  return path;
}

export async function copyScreeningToDataset(screeningPath, datasetPath) {
  const buffer = await downloadScreeningImage(screeningPath);
  const mime = screeningPath.endsWith('.png') ? 'image/png' : screeningPath.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
  await uploadDatasetImage(datasetPath, buffer, mime);
  return datasetPath;
}

export async function moveDatasetImage(from, to) {
  if (from === to) return to;
  const { error } = await bucket(config.supabase.datasetBucket).move(from, to);
  if (error) throw storageError(error, 'ไม่สามารถย้ายไฟล์ใน Dataset ได้');
  return to;
}

export async function downloadDatasetImage(path) {
  const { data, error } = await bucket(config.supabase.datasetBucket).download(path);
  if (error) throw storageError(error, 'ไม่สามารถอ่านไฟล์ภาพ Dataset ได้');
  return Buffer.from(await data.arrayBuffer());
}

export async function signedDatasetUrl(path) {
  const { data, error } = await bucket(config.supabase.datasetBucket).createSignedUrl(path, SIGNED_URL_TTL);
  if (error) return null;
  return data.signedUrl;
}

export async function signedDatasetUrls(paths) {
  if (!paths.length) return {};
  const { data, error } = await bucket(config.supabase.datasetBucket).createSignedUrls(paths, SIGNED_URL_TTL);
  if (error) return {};
  return Object.fromEntries((data ?? []).map((d) => [d.path, d.signedUrl]));
}

export async function removeDatasetImages(paths) {
  const list = paths.filter(Boolean);
  if (!list.length) return;
  const { error } = await bucket(config.supabase.datasetBucket).remove(list);
  if (error) logger.warn('dataset image remove failed', { error, count: list.length });
}

export async function checkStorage() {
  const { data, error } = await getServiceClient().storage.listBuckets();
  if (error) return { ok: false, error: error.message };
  const names = (data ?? []).map((b) => b.name);
  return {
    ok: names.includes(config.supabase.screeningBucket) && names.includes(config.supabase.datasetBucket),
    buckets: names.filter((n) => [config.supabase.screeningBucket, config.supabase.datasetBucket].includes(n)),
  };
}
