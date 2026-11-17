import { config } from '../config/env.js';
import { getServiceClient, createAnonClient } from '../config/supabase.js';
import { AppError, fromDbError } from '../utils/app-error.js';
import { hashRegistrationCode, calcAge, registrationCodeState } from '../utils/helpers.js';
import { logActivity } from './activity.service.js';
import { getConsentVersion } from './settings.service.js';
import { logger } from '../utils/logger.js';

/** Supabase Auth needs an e-mail; EYE Check uses usernames. No mail is ever sent. */
export const usernameToEmail = (username) => `${username.toLowerCase()}@${config.authEmailDomain}`;

function authUnavailable(err) {
  const e = new AppError(503, 'AUTH_UNAVAILABLE', 'ระบบยืนยันตัวตนไม่พร้อมใช้งานชั่วคราว กรุณาลองใหม่');
  e.cause = err;
  return e;
}

const REJECT_MESSAGES = {
  expired: 'โค้ดสมัครบัญชีเจ้าหน้าที่นี้หมดอายุแล้ว กรุณาติดต่อผู้ดูแลระบบ',
  disabled: 'โค้ดสมัครบัญชีเจ้าหน้าที่นี้ถูกปิดใช้งาน กรุณาติดต่อผู้ดูแลระบบ',
  fully_used: 'โค้ดสมัครบัญชีเจ้าหน้าที่นี้ถูกใช้สิทธิ์ครบจำนวนแล้ว กรุณาติดต่อผู้ดูแลระบบ',
};
/**
 * The atomic consume (database clock) already refused the code; this only picks a clearer
 * message, using the server clock — the browser clock is never involved.
 */
async function rejectedCodeError(svc, code) {
  const { data } = await svc.from('staff_registration_codes')
    .select('status, expires_at, usage_limit, usage_count').eq('code_hash', hashRegistrationCode(code)).maybeSingle();
  const state = data ? registrationCodeState(data) : null;
  return new AppError(400, 'INVALID_REGISTRATION_CODE',
    REJECT_MESSAGES[state] ?? 'โค้ดสมัครบัญชีเจ้าหน้าที่ไม่ถูกต้อง หมดอายุ หรือถูกใช้ครบจำนวนแล้ว');
}

export async function register(input) {
  const svc = getServiceClient();

  const { data: existing, error: exErr } = await svc.from('profiles').select('id').eq('username', input.username).maybeSingle();
  if (exErr) throw fromDbError(exErr);
  if (existing) throw new AppError(409, 'USERNAME_TAKEN', 'ชื่อบัญชีนี้ถูกใช้แล้ว กรุณาเลือกชื่ออื่น');

  // Staff: verify + atomically consume the registration code on the backend.
  let codeId = null;
  if (input.account_type === 'staff') {
    const { data, error } = await svc.rpc('consume_staff_registration_code', { p_code_hash: hashRegistrationCode(input.registration_code) });
    if (error) throw fromDbError(error);
    if (!data) throw await rejectedCodeError(svc, input.registration_code);
    codeId = data;
  }
  const releaseCode = async () => {
    if (codeId) await svc.rpc('release_staff_registration_code', { p_code_id: codeId }).then(() => {}, () => {});
  };

  const { data: created, error: cErr } = await svc.auth.admin.createUser({
    email: usernameToEmail(input.username),
    password: input.password,
    email_confirm: true,
    user_metadata: { username: input.username }, // role is NEVER taken from user input
  });
  if (cErr || !created?.user) {
    await releaseCode();
    if (/already|registered|exists/i.test(cErr?.message ?? '')) throw new AppError(409, 'USERNAME_TAKEN', 'ชื่อบัญชีนี้ถูกใช้แล้ว');
    if (/password/i.test(cErr?.message ?? '')) throw new AppError(422, 'WEAK_PASSWORD', 'รหัสผ่านไม่ผ่านนโยบายความปลอดภัย กรุณาตั้งรหัสผ่านที่ซับซ้อนขึ้น');
    throw authUnavailable(cErr);
  }

  const profile = {
    id: created.user.id,
    full_name: input.full_name,
    username: input.username,
    account_type: input.account_type,
    role: 'user',
    status: 'active',
    birth_date: input.account_type === 'personal' ? input.birth_date : null,
    gender: input.account_type === 'personal' ? input.gender : null,
    position: input.account_type === 'staff' ? input.position : null,
    workplace: input.account_type === 'staff' ? input.workplace : null,
  };
  const { data: saved, error: pErr } = await svc.from('profiles').insert(profile).select('*').single();
  if (pErr) {
    await svc.auth.admin.deleteUser(created.user.id).catch(() => {});
    await releaseCode();
    throw fromDbError(pErr, 'ไม่สามารถสร้างบัญชีได้');
  }

  // Record acceptance of the privacy notice / terms (PDPA)
  const consentVersion = await getConsentVersion().catch(() => '1.0');
  const { error: consentErr } = await svc.from('consent_records').insert({
    user_id: saved.id, consent_type: 'data_processing', consent_status: 'granted', consent_version: consentVersion,
  });
  if (consentErr) logger.warn('consent record insert failed', { error: consentErr });

  // Remember which code this staff account used (admin "who used this code" view).
  // A failure here must not undo a valid registration → log it instead.
  if (codeId) {
    const { data: codeRow } = await svc.from('staff_registration_codes').select('label').eq('id', codeId).maybeSingle();
    const { error: linkErr } = await svc.from('staff_code_registrations').insert({
      user_id: saved.id, code_id: codeId, code_ref: codeId, code_label: codeRow?.label ?? null,
    });
    if (linkErr) logger.error('staff code link insert failed (is migration 005 applied?)', { error: linkErr, user_id: saved.id, code_id: codeId });
  }

  await logActivity(saved.id, 'register', { account_type: saved.account_type, via_code: Boolean(codeId), ...(codeId ? { code_id: codeId } : {}) });
  return { ...saved, age: calcAge(saved.birth_date) };
}

export async function login({ username, password }) {
  const { data, error } = await createAnonClient().auth.signInWithPassword({ email: usernameToEmail(username), password });
  if (error) {
    if (/banned/i.test(error.message)) throw new AppError(403, 'ACCOUNT_SUSPENDED', 'บัญชีนี้ถูกระงับการใช้งาน กรุณาติดต่อผู้ดูแลระบบ');
    if (error.status === 400 || /invalid/i.test(error.message)) {
      await logActivity(null, 'login_failed', {});
      throw new AppError(401, 'INVALID_CREDENTIALS', 'ชื่อบัญชีหรือรหัสผ่านไม่ถูกต้อง');
    }
    throw authUnavailable(error);
  }
  const svc = getServiceClient();
  const { data: profile, error: pErr } = await svc.from('profiles').select('*').eq('id', data.user.id).maybeSingle();
  if (pErr) throw fromDbError(pErr);
  if (!profile) throw new AppError(403, 'PROFILE_MISSING', 'ไม่พบข้อมูลบัญชี กรุณาติดต่อผู้ดูแลระบบ');
  if (profile.status !== 'active') {
    await svc.auth.admin.signOut(data.session.access_token).catch(() => {});
    throw new AppError(403, 'ACCOUNT_SUSPENDED', 'บัญชีนี้ถูกระงับการใช้งาน กรุณาติดต่อผู้ดูแลระบบ');
  }
  await svc.from('profiles').update({ last_login_at: new Date().toISOString() }).eq('id', profile.id);
  await logActivity(profile.id, 'login', {});
  return { session: data.session, profile: { ...profile, age: calcAge(profile.birth_date) } };
}

/** Revokes the refresh tokens of this session on Supabase. */
export async function logout(accessToken, userId) {
  if (accessToken) {
    const { error } = await getServiceClient().auth.admin.signOut(accessToken, 'local');
    if (error) logger.warn('supabase signOut failed', { error });
  }
  if (userId) await logActivity(userId, 'logout', {});
}

export async function verifyPassword(username, password) {
  const { error } = await createAnonClient().auth.signInWithPassword({ email: usernameToEmail(username), password });
  if (error) {
    if (error.status === 400 || /invalid/i.test(error.message)) return false;
    throw authUnavailable(error);
  }
  return true;
}

export async function changePassword(profile, currentPassword, newPassword) {
  if (!(await verifyPassword(profile.username, currentPassword))) {
    throw new AppError(400, 'WRONG_PASSWORD', 'รหัสผ่านปัจจุบันไม่ถูกต้อง');
  }
  const { error } = await getServiceClient().auth.admin.updateUserById(profile.id, { password: newPassword });
  if (error) throw authUnavailable(error);
  await logActivity(profile.id, 'password_changed', {});
}
