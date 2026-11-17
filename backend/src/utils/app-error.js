export class AppError extends Error {
  /**
   * @param {number} status HTTP status
   * @param {string} code machine-readable code (e.g. NOT_FOUND)
   * @param {string} message Thai, user-facing message
   * @param {unknown} [details]
   */
  constructor(status, code, message, details) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const Errors = {
  badRequest: (msg = 'ข้อมูลไม่ถูกต้อง', details) => new AppError(400, 'BAD_REQUEST', msg, details),
  validation: (details) => new AppError(422, 'VALIDATION_ERROR', 'กรุณาตรวจสอบข้อมูลที่กรอก', details),
  unauthorized: (msg = 'กรุณาเข้าสู่ระบบก่อนใช้งาน') => new AppError(401, 'UNAUTHORIZED', msg),
  forbidden: (msg = 'คุณไม่มีสิทธิ์เข้าถึงข้อมูลนี้') => new AppError(403, 'FORBIDDEN', msg),
  notFound: (msg = 'ไม่พบข้อมูลที่ต้องการ') => new AppError(404, 'NOT_FOUND', msg),
  conflict: (msg = 'ข้อมูลซ้ำกับที่มีอยู่แล้ว') => new AppError(409, 'CONFLICT', msg),
  unavailable: (msg = 'บริการไม่พร้อมใช้งานชั่วคราว กรุณาลองใหม่') => new AppError(503, 'SERVICE_UNAVAILABLE', msg),
};

/** Convert a Supabase/PostgREST error into an AppError without leaking internals. */
export function fromDbError(error, fallbackMsg = 'ไม่สามารถดำเนินการกับฐานข้อมูลได้') {
  if (!error) return null;
  const code = error.code || '';
  if (code === '23505') return new AppError(409, 'CONFLICT', 'ข้อมูลนี้มีอยู่ในระบบแล้ว');
  if (code === '23503') return new AppError(400, 'INVALID_REFERENCE', 'ข้อมูลที่อ้างอิงไม่ถูกต้อง');
  if (code === '23514' || code === '22P02' || code === '22007' || code === '22008') {
    return new AppError(422, 'VALIDATION_ERROR', 'ข้อมูลไม่ผ่านเงื่อนไขของระบบ');
  }
  if (code === '42501' || code === 'PGRST301') return Errors.forbidden();
  if (code === 'PGRST116') return Errors.notFound();
  if (/fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT/i.test(error.message || '')) {
    return new AppError(503, 'DATABASE_UNAVAILABLE', 'ไม่สามารถเชื่อมต่อฐานข้อมูลได้ กรุณาลองใหม่');
  }
  const e = new AppError(500, 'DATABASE_ERROR', fallbackMsg);
  e.cause = error;
  return e;
}

/** Return `data` from a Supabase response or throw a mapped AppError. */
export function unwrap(result, fallbackMsg) {
  if (result.error) throw fromDbError(result.error, fallbackMsg);
  return result.data;
}
