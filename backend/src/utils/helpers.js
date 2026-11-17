import crypto from 'node:crypto';
import { config } from '../config/env.js';

export function ok(res, data, status = 200) {
  return res.status(status).json({ success: true, data });
}

export function calcAge(birthDate, now = new Date()) {
  if (!birthDate) return null;
  const b = new Date(`${String(birthDate).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(b.getTime())) return null;
  let age = now.getUTCFullYear() - b.getUTCFullYear();
  const m = now.getUTCMonth() - b.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < b.getUTCDate())) age--;
  return age;
}

export function ageGroupFor(age) {
  if (age === null || age === undefined) return null;
  if (age < 40) return 'under_40';
  if (age < 60) return '40_59';
  return '60_plus';
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
/** EC-YYYYMMDD-XXXXXX */
export function generateScreeningCode(date = new Date()) {
  const ymd = date.toISOString().slice(0, 10).replace(/-/g, '');
  const bytes = crypto.randomBytes(6);
  let suffix = '';
  for (const b of bytes) suffix += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return `EC-${ymd}-${suffix}`;
}

/** Random human-friendly staff registration code, e.g. STAFF-7KQ2-M9XA-P3TD */
export function generateRegistrationCode() {
  const bytes = crypto.randomBytes(12);
  let s = '';
  for (const b of bytes) s += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return `STAFF-${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`;
}

/** HMAC-SHA256 with the server secret — only hashes are stored in the DB. */
export function hmac(value) {
  return crypto.createHmac('sha256', config.jwtSecret).update(String(value)).digest('hex');
}

/**
 * Effective state of a staff registration code, from the SERVER clock:
 * disabled > expired > fully_used > active. 'expired' needs no job — it is derived from expires_at.
 */
export function registrationCodeState(c, now = Date.now()) {
  if (c.status === 'disabled') return 'disabled';
  if (c.expires_at && new Date(c.expires_at).getTime() <= now) return 'expired';
  if (c.status === 'exhausted' || (c.usage_limit != null && c.usage_count >= c.usage_limit)) return 'fully_used';
  return 'active';
}

export const REGISTRATION_CODE_RE =/^STAFF-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;

export function hashRegistrationCode(code) {
  return hmac(`staff-code:${String(code).trim().toUpperCase()}`);
}

/** Strip characters that have meaning in PostgREST filter syntax. */
export function sanitizeSearch(term, max = 80) {
  if (!term) return '';
  return String(term).replace(/[%,()*\\:"']/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

export function pageRange(page = 1, pageSize = 20) {
  const p = Math.max(1, Number(page) || 1);
  const s = Math.min(100, Math.max(1, Number(pageSize) || 20));
  return { page: p, pageSize: s, from: (p - 1) * s, to: p * s - 1 };
}

export function paged(rows, count, { page, pageSize }) {
  return { items: rows ?? [], page, pageSize, total: count ?? 0, totalPages: Math.max(1, Math.ceil((count ?? 0) / pageSize)) };
}

/** Inclusive date-range helper → ISO strings (end of day for `to`). */
export function dateRange(from, to) {
  const out = {};
  if (from) out.from = new Date(`${from}T00:00:00+07:00`).toISOString();
  if (to) out.to = new Date(`${to}T23:59:59.999+07:00`).toISOString();
  return out;
}

/** YYYY-MM-DD in Asia/Bangkok */
export function bangkokDay(iso) {
  return new Date(new Date(iso).getTime() + 7 * 3600e3).toISOString().slice(0, 10);
}
