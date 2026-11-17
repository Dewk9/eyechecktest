import sharp from 'sharp';
import { assessQuality, QUALITY_THRESHOLDS } from '../../../ai/image-quality/metrics.js';
import { AppError } from '../utils/app-error.js';
import { ALLOWED_MIME } from '../middleware/upload.js';

const FORMAT_TO_MIME = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

/**
 * Authoritative server-side check. Verifies the real file format from its
 * bytes (not the client-declared MIME type), normalises orientation, strips
 * metadata (EXIF/GPS) and computes quality metrics.
 * @returns {{ buffer: Buffer, mime: string, quality: object }}
 */
export async function inspectAndNormalizeImage(inputBuffer) {
  let meta;
  try {
    meta = await sharp(inputBuffer, { failOn: 'error' }).metadata();
  } catch {
    throw new AppError(415, 'INVALID_IMAGE', 'ไฟล์ไม่ใช่ภาพที่ถูกต้องหรือไฟล์เสียหาย');
  }
  const mime = FORMAT_TO_MIME[meta.format];
  if (!mime || !ALLOWED_MIME.has(mime)) {
    throw new AppError(415, 'UNSUPPORTED_FILE_TYPE', 'รองรับเฉพาะไฟล์ภาพ JPG, PNG หรือ WEBP');
  }
  if (!meta.width || !meta.height || meta.width * meta.height > 50e6) {
    throw new AppError(422, 'INVALID_IMAGE', 'ขนาดภาพไม่ถูกต้อง');
  }

  // Re-encode as JPEG: applies EXIF rotation and removes all metadata (privacy).
  const normalized = await sharp(inputBuffer).rotate().jpeg({ quality: 92, mozjpeg: true }).toBuffer({ resolveWithObject: true });
  const { width: ow, height: oh } = normalized.info;

  const { data, info } = await sharp(normalized.data)
    .resize({ width: QUALITY_THRESHOLDS.analysisMaxSide, height: QUALITY_THRESHOLDS.analysisMaxSide, fit: 'inside', withoutEnlargement: true })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const quality = assessQuality({
    gray: new Uint8Array(data.buffer, data.byteOffset, info.width * info.height),
    width: info.width,
    height: info.height,
    originalWidth: ow,
    originalHeight: oh,
  });

  return { buffer: normalized.data, mime: 'image/jpeg', width: ow, height: oh, quality };
}

/** Compact version stored in screenings.image_quality */
export function qualityRecord(q) {
  return {
    passed: q.passed,
    checks: q.checks.map(({ key, label, passed, value, message, severity }) => ({ key, label, passed, value, message, severity })),
    warnings: q.warnings,
    errors: q.errors,
    checked_at: new Date().toISOString(),
  };
}
