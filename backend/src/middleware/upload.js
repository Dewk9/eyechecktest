import multer from 'multer';
import { config } from '../config/env.js';
import { AppError } from '../utils/app-error.js';

export const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.uploadMaxBytes, files: 1, fields: 20 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME.has(file.mimetype)) {
      return cb(new AppError(415, 'UNSUPPORTED_FILE_TYPE', 'รองรับเฉพาะไฟล์ภาพ JPG, PNG หรือ WEBP'));
    }
    return cb(null, true);
  },
});

/** Single image field `image`, with multer errors mapped to Thai messages. */
export const singleImage = (req, res, next) => {
  upload.single('image')(req, res, (err) => {
    if (!err) return next();
    if (err instanceof AppError) return next(err);
    if (err.code === 'LIMIT_FILE_SIZE') {
      return next(new AppError(413, 'FILE_TOO_LARGE', `ไฟล์มีขนาดใหญ่เกิน ${Math.round(config.uploadMaxBytes / 1048576)} MB`));
    }
    return next(new AppError(400, 'UPLOAD_ERROR', 'ไม่สามารถรับไฟล์ได้'));
  });
};
