import { getServiceClient } from '../config/supabase.js';
import { AppError, Errors, unwrap, fromDbError } from '../utils/app-error.js';
import crypto from 'node:crypto';
import { sanitizeSearch, pageRange, paged, dateRange, bangkokDay, generateRegistrationCode, hashRegistrationCode, hmac, registrationCodeState, REGISTRATION_CODE_RE } from '../utils/helpers.js';
import { config } from '../config/env.js';
import { encryptRegistrationCode, decryptRegistrationCode } from '../utils/code-crypto.js';
import { logActivity } from './activity.service.js';
import { publicProfile } from './profile.service.js';
import { applyFilters, buildResult } from './screening.service.js';
import { adminDashboard } from './dashboard.service.js';
import { getAllSettings, setSetting } from './settings.service.js';
import { checkStorage } from './storage.service.js';
import { getStatus as roboflowStatus } from '../roboflow/roboflow.service.js';

const svc = () => getServiceClient();

// ---------------- statistics & website activity ----------------
async function fetchActivity(actions, range, columns = 'action, user_id, details, created_at') {
  const out = [];
  for (let from = 0; from < 50000; from += 1000) {
    const rows = unwrap(await svc().from('activity_logs').select(columns)
      .in('action', actions).gte('created_at', range.from).lte('created_at', range.to)
      .order('created_at', { ascending: true }).range(from, from + 999));
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

function defaultRange(q) {
  const to = q.to ?? bangkokDay(new Date().toISOString());
  const from = q.from ?? new Date(new Date(`${to}T00:00:00Z`).getTime() - 13 * 864e5).toISOString().slice(0, 10);
  return { from, to };
}

export async function statistics(q) {
  const { from, to } = defaultRange(q);
  const range = dateRange(from, to);
  const today = bangkokDay(new Date().toISOString());
  const todayRange = dateRange(today, today);
  const head = { count: 'exact', head: true };
  // all reads are independent → run them concurrently
  const [events, { count: scansToday }, { count: members }, { count: personal }, { count: staff }, { count: regsInRange }, screening] = await Promise.all([
    fetchActivity(['page_view', 'page_leave', 'register', 'login', 'screening_analyzed'], range),
    svc().from('screenings').select('id', head).gte('screening_date', todayRange.from).lte('screening_date', todayRange.to),
    svc().from('profiles').select('id', head),
    svc().from('profiles').select('id', head).eq('account_type', 'personal'),
    svc().from('profiles').select('id', head).eq('account_type', 'staff'),
    svc().from('profiles').select('id', head).gte('created_at', range.from).lte('created_at', range.to),
    adminDashboard({ from, to, count_by: 'screening' }),
  ]);

  const days = new Map();
  for (let d = new Date(`${from}T00:00:00Z`), i = 0; d <= new Date(`${to}T00:00:00Z`) && i < 366; d.setUTCDate(d.getUTCDate() + 1), i++) {
    const k = d.toISOString().slice(0, 10);
    days.set(k, { date: k, visitors: new Set(), page_views: 0, leaves: 0, registrations: 0, logins: new Set(), scans: 0 });
  }
  for (const e of events) {
    const day = days.get(bangkokDay(e.created_at));
    if (!day) continue;
    if (e.action === 'page_view') { day.page_views++; if (e.details?.v) day.visitors.add(e.details.v); }
    else if (e.action === 'page_leave') day.leaves++;
    else if (e.action === 'register') day.registrations++;
    else if (e.action === 'login' && e.user_id) day.logins.add(e.user_id);
    else if (e.action === 'screening_analyzed') day.scans++;
  }
  const daily = [...days.values()].map((d) => ({
    date: d.date, visitors: d.visitors.size, page_views: d.page_views, leaves: d.leaves,
    registrations: d.registrations, active_logins: d.logins.size, scans: d.scans,
  }));

  const todayRow = daily.find((d) => d.date === today);

  return {
    range: { from, to },
    members: { total: members ?? 0, personal: personal ?? 0, staff: staff ?? 0, registrations_in_range: regsInRange ?? 0 },
    today: {
      date: today,
      scans: scansToday ?? 0,
      visitors: todayRow?.visitors ?? 0,
      registrations: todayRow?.registrations ?? 0,
      active_logins: todayRow?.active_logins ?? 0,
      leaves: todayRow?.leaves ?? 0,
    },
    daily,
    screening,
    notes: {
      visitors: 'นับผู้เข้าชมจากรหัสอุปกรณ์แบบสุ่มที่แฮชแล้ว (ไม่ระบุตัวตน) ต่อวัน',
      leaves: 'นับจากเหตุการณ์ออกจากหน้าเว็บที่เบราว์เซอร์ส่งมา (อาจต่ำกว่าความจริงหากเบราว์เซอร์ปิดกะทันหัน)',
    },
  };
}

export async function trackEvent(visitorId, event, path, userId) {
  // Only a keyed hash of a random device id is stored — no IP, no user agent.
  await logActivity(userId ?? null, event, { v: hmac(`visitor:${visitorId}`).slice(0, 24), path });
}

export async function listActivity(q) {
  const r = pageRange(q.page, q.pageSize);
  let query = svc().from('activity_logs').select('id, user_id, action, details, created_at, profiles(username, account_type)', { count: 'exact' });
  const range = dateRange(q.from, q.to);
  if (range.from) query = query.gte('created_at', range.from);
  if (range.to) query = query.lte('created_at', range.to);
  if (q.action) query = query.eq('action', q.action);
  else query = query.not('action', 'in', '(page_view,page_leave)');
  const term = sanitizeSearch(q.search);
  if (term) {
    const users = unwrap(await svc().from('profiles').select('id').ilike('username', `%${term}%`).limit(100));
    query = query.in('user_id', users.length ? users.map((u) => u.id) : ['00000000-0000-0000-0000-000000000000']);
  }
  const { data, count, error } = await query.order('created_at', { ascending: false }).range(r.from, r.to);
  if (error) unwrap({ error });
  return paged(data, count, r);
}

// ---------------- users ----------------
export async function listUsers(q) {
  const r = pageRange(q.page, q.pageSize);
  let query = svc().from('profiles').select('*', { count: 'exact' });
  if (q.account_type) query = query.eq('account_type', q.account_type);
  if (q.role) query = query.eq('role', q.role);
  if (q.status) query = query.eq('status', q.status);
  const term = sanitizeSearch(q.search);
  if (term) query = query.or(`username.ilike.%${term}%,full_name.ilike.%${term}%,workplace.ilike.%${term}%`);
  const { data, count, error } = await query.order('created_at', { ascending: false }).range(r.from, r.to);
  if (error) unwrap({ error });
  return paged((data ?? []).map(publicProfile), count, r);
}

export async function getUser(id) {
  const p = unwrap(await svc().from('profiles').select('*').eq('id', id).maybeSingle());
  if (!p) throw Errors.notFound('ไม่พบสมาชิก');
  const [scr, pts, act, link] = await Promise.all([
    svc().from('screenings').select('id', { count: 'exact', head: true }).eq('user_id', id),
    svc().from('patients').select('id', { count: 'exact', head: true }).eq('owner_id', id),
    svc().from('activity_logs').select('action, details, created_at').eq('user_id', id).not('action', 'in', '(page_view,page_leave)').order('created_at', { ascending: false }).limit(30),
    svc().from('staff_code_registrations').select('code_id, code_ref, code_label, used_at').eq('user_id', id).maybeSingle(),
  ]);
  if (link.error && !isMissingLinkTable(link.error)) throw fromDbError(link.error);
  return {
    ...publicProfile(p),
    screenings_count: scr.count ?? 0,
    patients_count: pts.count ?? 0,
    recent_activity: unwrap(act),
    // which staff registration code this account used (null: not via code / registered before tracking)
    registration_code: link.data ? { ...link.data, deleted: !link.data.code_id } : null,
  };
}

export async function setUserStatus(admin, id, status, reason) {
  if (id === admin.userId) throw new AppError(409, 'SELF_ACTION', 'ไม่สามารถระงับบัญชีของตนเองได้');
  const target = unwrap(await svc().from('profiles').select('id, role').eq('id', id).maybeSingle());
  if (!target) throw Errors.notFound('ไม่พบสมาชิก');
  // Ban in Supabase Auth too, so existing refresh tokens stop working
  const { error } = await svc().auth.admin.updateUserById(id, { ban_duration: status === 'suspended' ? '876000h' : 'none' });
  if (error) throw new AppError(503, 'AUTH_UNAVAILABLE', 'ไม่สามารถเปลี่ยนสถานะบัญชีในระบบยืนยันตัวตนได้');
  const row = unwrap(await svc().from('profiles').update({ status }).eq('id', id).select('*').single());
  await logActivity(admin.userId, status === 'suspended' ? 'admin_user_suspended' : 'admin_user_activated', { target: id, reason: reason ?? null });
  return publicProfile(row);
}

export async function setUserRole(admin, id, role) {
  if (id === admin.userId) throw new AppError(409, 'SELF_ACTION', 'ไม่สามารถเปลี่ยนสิทธิ์ของตนเองได้');
  const row = unwrap(await svc().from('profiles').update({ role }).eq('id', id).select('*').maybeSingle());
  if (!row) throw Errors.notFound('ไม่พบสมาชิก');
  await logActivity(admin.userId, 'admin_role_changed', { target: id, role });
  return publicProfile(row);
}

// ---------------- screenings ----------------
export async function listAllScreenings(q) {
  const r = pageRange(q.page, q.pageSize);
  let query = svc().from('screenings')
    .select('id, screening_code, screening_date, eye_side, primary_finding, risk_level, ai_status, is_saved, dataset_consent, user_id, patient_id, profiles(username, account_type)', { count: 'exact' });
  query = applyFilters(query, q);
  const term = sanitizeSearch(q.search);
  if (term) query = query.ilike('screening_code', `%${term}%`);
  const { data, count, error } = await query.order(q.sort ?? 'screening_date', { ascending: q.order === 'asc', nullsFirst: false }).range(r.from, r.to);
  if (error) unwrap({ error });
  return paged(data, count, r);
}

export async function getScreeningForAdmin(admin, id) {
  const s = unwrap(await svc().from('screenings').select('*').eq('id', id).maybeSingle());
  if (!s) throw Errors.notFound('ไม่พบข้อมูลการตรวจ');
  await logActivity(admin.userId, 'admin_viewed_screening', { screening_id: id });
  return buildResult(svc(), s, { admin: true });
}

// ---------------- staff registration codes ----------------
const CODE_COLS = 'id, label, status, expires_at, usage_limit, usage_count, created_at';
// migration 006 columns (code_encrypted is only read to derive has_code — never sent to the browser)
const CODE_COLS_V6 = `${CODE_COLS}, updated_at, code_encrypted`;
// PostgREST: missing table / relationship → migration 005 not applied yet
const isMissingLinkTable = (err) => ['PGRST200', 'PGRST205', '42P01'].includes(err?.code);
// missing column → migration 006 not applied yet
const isMissingColumn = (err) => ['42703', 'PGRST204'].includes(err?.code);
const migrationNeeded = () => new AppError(503, 'MIGRATION_REQUIRED', 'ยังไม่ได้ติดตั้งตารางเชื่อมโยงโค้ดกับบัญชี (database/migrations/005_staff_code_registrations.sql) กรุณารัน npm run db:migrate');
const migration6Needed = () => new AppError(503, 'MIGRATION_REQUIRED', 'ยังไม่ได้ติดตั้งระบบเข้ารหัสโค้ด (database/migrations/006_staff_code_encryption.sql) กรุณารัน npm run db:migrate หรือวางไฟล์นี้ใน Supabase SQL Editor');
const bangkokEndOfDay = (date) => new Date(`${date}T23:59:59+07:00`).toISOString();
const MAX_EXPIRY_MS = 10 * 366 * 86400e3;

// When migration 006 was last found missing; the new columns are tried again after 60 s
// (so running the migration takes effect without restarting the server).
let v6MissingAt = 0;
const tryV6 = () => Date.now() - v6MissingAt > 60e3;
const markV6Missing = () => { v6MissingAt = Date.now(); };
/** select with the 006 columns, falling back to the old columns if the migration is not applied */
async function selectCodes(build, extra = '') {
  if (tryV6()) {
    const res = await build(`${CODE_COLS_V6}${extra}`);
    if (!res.error || !isMissingColumn(res.error)) return res;
    markV6Missing();
  }
  return build(`${CODE_COLS}${extra}`);
}

/** Public shape: never includes code_hash / code_encrypted. state is computed with the server clock. */
function decorateCode({ code_encrypted, code_hash, ...row }, now = Date.now()) {
  return {
    ...row,
    has_code: Boolean(code_encrypted), // true → admin can show / copy the real code
    state: registrationCodeState(row, now),
    remaining: row.usage_limit != null ? Math.max(row.usage_limit - row.usage_count, 0) : null,
  };
}

/**
 * Turns the request into an exact UTC timestamp using the SERVER clock.
 * Returns undefined when no expiry field was sent.
 */
function resolveExpiry(input, now = Date.now()) {
  let iso;
  if (input.expires_in_days !== undefined) iso = new Date(now + input.expires_in_days * 86400e3).toISOString();
  else if (input.expires_at === undefined) return undefined;
  else if (input.expires_at === null) return null;
  else if (/^\d{4}-\d{2}-\d{2}$/.test(input.expires_at)) iso = bangkokEndOfDay(input.expires_at);
  else iso = new Date(input.expires_at).toISOString();
  const t = new Date(iso).getTime();
  if (t <= now) throw new AppError(422, 'EXPIRY_IN_PAST', 'วันและเวลาหมดอายุต้องอยู่หลังวันและเวลาปัจจุบัน');
  if (t - now > MAX_EXPIRY_MS) throw new AppError(422, 'EXPIRY_TOO_FAR', 'วันหมดอายุต้องไม่เกิน 10 ปีจากวันนี้');
  return iso;
}

export const newRegistrationCodePreview = () => ({ code: generateRegistrationCode() });

/** used_by = number of accounts actually linked to the code (one row per account → never double counted). */
/**
 * Search by unit name or registration code (server side — codes never leave the server here).
 * - a complete code (STAFF-XXXX-XXXX-XXXX) is matched by its HMAC hash → also finds old hash-only codes
 * - part of a code is matched against the decrypted codes (codes with code_encrypted only)
 */
function matchesSearch(row, q) {
  const term = q.trim().toLowerCase();
  if (!term) return true;
  if (row.label?.toLowerCase().includes(term)) return true;
  const code = q.trim().toUpperCase();
  if (REGISTRATION_CODE_RE.test(code) && row.code_hash === hashRegistrationCode(code)) return true;
  const bare = code.replace(/[^A-Z0-9]/g, '');
  if (bare.length < 3 || !row.code_encrypted) return false;
  const plain = decryptRegistrationCode(row.code_encrypted, row.id);
  return Boolean(plain && plain.replace(/-/g, '').includes(bare));
}

/** used_by = number of accounts actually linked to the code (one row per account → never double counted). */
export async function listRegistrationCodes({ q } = {}) {
  const base = (cols) => svc().from('staff_registration_codes').select(cols).order('created_at', { ascending: false }).limit(500);
  const hashCol = q ? ', code_hash' : '';
  const res = await selectCodes(base, `${hashCol}, used_by:staff_code_registrations(count)`);
  const now = Date.now();
  const keep = (r) => !q || matchesSearch(r, q);
  if (res.error && isMissingLinkTable(res.error)) {
    const rows = unwrap(await selectCodes(base, hashCol));
    return rows.filter(keep).map((r) => ({ ...decorateCode(r, now), used_by: null }));
  }
  return unwrap(res).filter(keep).map(({ used_by, ...r }) => ({ ...decorateCode(r, now), used_by: used_by?.[0]?.count ?? 0 }));
}

/** Whether codes created now can be shown again (migration 006 installed). Never returns key material. */
export async function registrationCodeCapabilities() {
  const res = await svc().from('staff_registration_codes').select('code_encrypted').limit(1);
  if (res.error && !isMissingColumn(res.error)) throw fromDbError(res.error);
  const ready = !res.error;
  if (!ready) markV6Missing();
  return {
    encryption_ready: ready,
    key_source: config.registrationCodeKey ? 'REGISTRATION_CODE_KEY' : 'derived_from_JWT_SECRET',
    migration: ready ? null : 'database/migrations/006_staff_code_encryption.sql',
  };
}

/** Code details + the accounts that registered with it (no passwords / auth secrets are ever selected). */
export async function getRegistrationCode(id) {
  const code = unwrap(await selectCodes((cols) => svc().from('staff_registration_codes').select(cols).eq('id', id).maybeSingle(),
    ', creator:profiles!staff_registration_codes_created_by_fkey(username, full_name)'));
  if (!code) throw Errors.notFound('ไม่พบโค้ด');
  const res = await svc().from('staff_code_registrations')
    .select('used_at, profile:profiles(id, username, full_name, account_type, role, status, position, workplace, created_at, last_login_at)', { count: 'exact' })
    .eq('code_id', id).order('used_at', { ascending: false }).limit(1000);
  if (res.error) throw isMissingLinkTable(res.error) ? migrationNeeded() : fromDbError(res.error);
  const accounts = (res.data ?? []).filter((r) => r.profile).map((r) => ({ ...r.profile, used_at: r.used_at }));
  return { code: { ...decorateCode(code), used_by: res.count ?? accounts.length }, accounts, server_time: new Date().toISOString() };
}

/**
 * Admin-only: decrypt the stored code. The decrypted value is checked against code_hash
 * (the value registration really uses) and every reveal is written to the activity log.
 */
export async function revealRegistrationCode(admin, id) {
  const res = await svc().from('staff_registration_codes').select('id, label, code_hash, code_encrypted').eq('id', id).maybeSingle();
  if (res.error) throw isMissingColumn(res.error) ? migration6Needed() : fromDbError(res.error);
  if (!res.data) throw Errors.notFound('ไม่พบโค้ด');
  if (!res.data.code_encrypted) {
    throw new AppError(409, 'CODE_NOT_RECOVERABLE', 'โค้ดนี้สร้างก่อนเปิดระบบเข้ารหัส ระบบเก็บไว้เฉพาะค่าแฮช จึงแสดงรหัสจริงไม่ได้ (โค้ดยังใช้สมัครได้ตามปกติ) หากต้องการรหัสที่แสดงได้ ให้สร้างโค้ดใหม่');
  }
  const code = decryptRegistrationCode(res.data.code_encrypted, id);
  if (!code || hashRegistrationCode(code) !== res.data.code_hash) {
    throw new AppError(500, 'CODE_DECRYPT_FAILED', 'ถอดรหัสโค้ดไม่สำเร็จ (คีย์เข้ารหัสบนเซิร์ฟเวอร์อาจถูกเปลี่ยน) โค้ดยังใช้สมัครได้ตามปกติ');
  }
  await logActivity(admin.userId, 'admin_reg_code_revealed', { code_id: id });
  return { id, code };
}

/**
 * Creates a code. Stored: HMAC hash (used for registration) + AES-256-GCM ciphertext (admin view).
 * Never stored in plain text. Without migration 006 only the hash is stored (old behaviour) and
 * the response says so, so the admin knows to save the code now.
 */
export async function createRegistrationCode(admin, input) {
  const code = input.code ?? generateRegistrationCode();
  const id = crypto.randomUUID();
  const expires_at = resolveExpiry(input) ?? null;
  const row = {
    id,
    code_hash: hashRegistrationCode(code),
    label: input.label || null,
    usage_limit: input.usage_limit ?? null,
    expires_at,
    status: input.status ?? 'active',
    created_by: admin.userId,
  };
  const insert = (r, cols) => svc().from('staff_registration_codes').insert(r).select(cols).single();
  let res = tryV6() ? await insert({ ...row, code_encrypted: encryptRegistrationCode(code, id) }, CODE_COLS_V6) : { error: { code: '42703' } };
  let encrypted = true;
  if (res.error && isMissingColumn(res.error)) {
    markV6Missing();
    encrypted = false;
    res = await insert(row, CODE_COLS);
  }
  if (res.error?.code === '23505') throw new AppError(409, 'CODE_TAKEN', 'โค้ดนี้มีอยู่ในระบบแล้ว กรุณากดสุ่มโค้ดใหม่');
  const saved = unwrap(res);
  await logActivity(admin.userId, 'admin_reg_code_created', { code_id: id, expires_at, usage_limit: row.usage_limit, status: row.status, encrypted });
  return { ...decorateCode(saved), code, encrypted, used_by: 0 };
}

/**
 * Edit label / usage limit / expiry (exact date + time) / status.
 * 'exhausted' is derived: an active code whose limit is reached becomes exhausted,
 * an exhausted code whose limit is raised (or removed) becomes active again.
 * An expired code becomes usable again by giving it a new expiry in the future (or none).
 * Accounts that already registered are never touched.
 */
export async function updateRegistrationCode(admin, id, input) {
  const cur = unwrap(await svc().from('staff_registration_codes').select(CODE_COLS).eq('id', id).maybeSingle());
  if (!cur) throw Errors.notFound('ไม่พบโค้ด');
  const patch = {};
  if (input.label !== undefined) patch.label = input.label?.trim() || null;
  if (input.usage_limit !== undefined) {
    if (input.usage_limit !== null && input.usage_limit < cur.usage_count) {
      throw new AppError(422, 'USAGE_LIMIT_TOO_LOW', `จำนวนสิทธิ์ต้องไม่น้อยกว่าจำนวนที่ใช้ไปแล้ว (${cur.usage_count} ครั้ง)`);
    }
    patch.usage_limit = input.usage_limit;
  }
  const expiry = resolveExpiry(input);
  if (expiry !== undefined) patch.expires_at = expiry;
  const limit = patch.usage_limit !== undefined ? patch.usage_limit : cur.usage_limit;
  const wanted = input.status ?? (cur.status === 'disabled' ? 'disabled' : 'active');
  patch.status = wanted === 'active' && limit !== null && cur.usage_count >= limit ? 'exhausted' : wanted;

  // optimistic check: if someone registered with this code meanwhile, ask the admin to retry
  const run = (p, cols) => svc().from('staff_registration_codes').update(p)
    .eq('id', id).eq('usage_count', cur.usage_count).select(cols).maybeSingle();
  let res = tryV6() ? await run({ ...patch, updated_at: new Date().toISOString() }, CODE_COLS_V6) : { error: { code: '42703' } };
  if (res.error && isMissingColumn(res.error)) { markV6Missing(); res = await run(patch, CODE_COLS); }
  const row = unwrap(res);
  if (!row) throw new AppError(409, 'CODE_CHANGED', 'มีการใช้โค้ดนี้ระหว่างที่แก้ไข กรุณาลองบันทึกอีกครั้ง');
  const out = decorateCode(row);
  await logActivity(admin.userId, 'admin_reg_code_updated', { code_id: id, changes: Object.keys(patch), status: row.status, state: out.state, expires_at: row.expires_at });
  return out;
}

/** Delete a code. Accounts created with it stay as they are (link keeps code_ref/code_label; code_id → NULL). */
export async function deleteRegistrationCode(admin, id) {
  const cur = unwrap(await svc().from('staff_registration_codes').select('id, label, usage_count').eq('id', id).maybeSingle());
  if (!cur) throw Errors.notFound('ไม่พบโค้ด');
  const linked = await svc().from('staff_code_registrations').select('user_id', { count: 'exact', head: true }).eq('code_id', id);
  if (linked.error && !isMissingLinkTable(linked.error)) throw fromDbError(linked.error);
  const deleted = unwrap(await svc().from('staff_registration_codes').delete().eq('id', id).select('id'));
  if (!deleted.length) throw Errors.notFound('ไม่พบโค้ด');
  await logActivity(admin.userId, 'admin_reg_code_deleted', { code_id: id, label: cur.label, usage_count: cur.usage_count, linked_accounts: linked.count ?? null });
  return { id, linked_accounts: linked.count ?? 0 };
}

// ---------------- settings & system health ----------------
export async function getSettings() {
  return getAllSettings({ fresh: true });
}

export async function updateSettings(admin, input) {
  for (const [k, v] of Object.entries(input)) await setSetting(k, v, admin.userId);
  await logActivity(admin.userId, 'admin_settings_updated', { keys: Object.keys(input) });
  return getAllSettings({ fresh: true });
}

/**
 * @param {{ fresh?: boolean }} o  fresh=true runs a new live Roboflow test call (slow, uses an
 *   inference credit); otherwise the last real probe result (≤10 min old, see checkedAt) is reused.
 */
export async function systemHealth({ fresh = false } = {}) {
  const started = Date.now();
  let dbMs = 0;
  const dbP = svc().from('admin_settings').select('id', { head: true, count: 'exact' }).then((r) => { dbMs = Date.now() - started; return r; });
  const [db, storage, ai] = await Promise.all([dbP, checkStorage().catch((e) => ({ ok: false, error: e.message })), roboflowStatus({ fresh })]);
  return {
    database: { ok: !db.error, latency_ms: dbMs, error: db.error ? 'เชื่อมต่อฐานข้อมูลไม่ได้' : null },
    storage,
    ai,
    server: { uptime_s: Math.round(process.uptime()), node: process.version, memory_mb: Math.round(process.memoryUsage().rss / 1048576) },
    checked_at: new Date().toISOString(),
  };
}
