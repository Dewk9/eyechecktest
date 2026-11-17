import rateLimit from 'express-rate-limit';
import { config } from '../config/env.js';
import { AppError } from '../utils/app-error.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF protection for cookie-based auth:
 *  1. cookies are SameSite=Strict
 *  2. state-changing requests must carry a custom header (cannot be sent cross-site without CORS preflight)
 *  3. if an Origin header is present it must be an allowed origin
 */
export function csrfProtection(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  if (req.get('X-Requested-With') !== 'EyeCheck') {
    return next(new AppError(403, 'CSRF_REJECTED', 'คำขอไม่ถูกต้อง (CSRF)'));
  }
  const origin = req.get('Origin');
  if (origin) {
    const allowed = new Set([config.frontendUrl, `${req.protocol}://${req.get('host')}`]);
    if (!allowed.has(origin)) return next(new AppError(403, 'CSRF_REJECTED', 'ไม่อนุญาตคำขอจากต้นทางนี้'));
  }
  return next();
}

export function httpsRedirect(req, res, next) {
  if (!config.forceHttps || req.secure) return next();
  if (SAFE_METHODS.has(req.method)) return res.redirect(301, `https://${req.get('host')}${req.originalUrl}`);
  return next(new AppError(403, 'HTTPS_REQUIRED', 'กรุณาใช้การเชื่อมต่อแบบ HTTPS'));
}

const limitHandler = (message) => (req, res) => {
  res.status(429).json({ success: false, error: { code: 'RATE_LIMITED', message } });
};

export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 300,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: limitHandler('มีการเรียกใช้งานบ่อยเกินไป กรุณารอสักครู่'),
});

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: limitHandler('พยายามเข้าสู่ระบบหรือสมัครบ่อยเกินไป กรุณารอ 15 นาที'),
});

export const analyzeLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 40,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => req.auth?.userId ?? req.ip,
  handler: limitHandler('ส่งภาพวิเคราะห์บ่อยเกินไป กรุณารอสักครู่'),
});

export const trackLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (req, res) => res.status(204).end(),
});
