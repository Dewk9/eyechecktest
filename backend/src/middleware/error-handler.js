import crypto from 'node:crypto';
import { AppError } from '../utils/app-error.js';
import { logger } from '../utils/logger.js';

export function requestId(req, res, next) {
  req.id = crypto.randomUUID();
  res.setHeader('X-Request-Id', req.id);
  next();
}

export function requestLogger(req, res, next) {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    if (!req.originalUrl.startsWith('/api/')) return;
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    logger.info('request', {
      id: req.id, method: req.method, path: req.originalUrl.split('?')[0],
      status: res.statusCode, ms: Math.round(ms), user: req.auth?.userId,
    });
  });
  next();
}

export function apiNotFound(req, res, next) {
  next(new AppError(404, 'ENDPOINT_NOT_FOUND', 'ไม่พบ API ที่ร้องขอ'));
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  let error = err;
  if (err?.type === 'entity.parse.failed') error = new AppError(400, 'INVALID_JSON', 'รูปแบบข้อมูล JSON ไม่ถูกต้อง');
  if (err?.type === 'entity.too.large') error = new AppError(413, 'PAYLOAD_TOO_LARGE', 'ข้อมูลมีขนาดใหญ่เกินไป');
  if (!(error instanceof AppError)) {
    logger.error('unhandled error', { id: req.id, path: req.originalUrl, error: err, stack: err?.stack });
    error = new AppError(500, 'INTERNAL_ERROR', 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่อีกครั้ง');
  } else if (error.status >= 500) {
    logger.error('server error', { id: req.id, path: req.originalUrl, code: error.code, cause: error.cause });
  }
  res.status(error.status).json({
    success: false,
    error: { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}), requestId: req.id },
  });
}
