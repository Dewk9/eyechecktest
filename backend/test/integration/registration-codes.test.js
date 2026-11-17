/**
 * Staff registration codes against a REAL Supabase project:
 * create (custom date-time / preset) → list → detail → reveal → edit → disable / enable →
 * register with the real code → limit reached → expiry at the exact second → delete.
 * Creates temporary codes and staff accounts and removes them afterwards.
 *   npm run test:integration
 * Works with or without migration 006 (reveal is checked only when the migration is installed).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { validateConfig } from '../../src/config/env.js';

const configured = validateConfig().errors.length === 0;
const opts = { skip: configured ? false : 'Supabase not configured', timeout: 60000 };

let svc; let admin; let auth;
const codes = [];
const users = [];
const ADMIN = { userId: null };
const pw = `T3st-${crypto.randomBytes(6).toString('hex')}Aa1`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function registerStaff(code) {
  const username = `codetest_${crypto.randomBytes(4).toString('hex')}`;
  const p = await auth.register({
    account_type: 'staff', full_name: 'Code Test', username, password: pw, confirm_password: pw,
    accept_terms: true, position: 'tester', workplace: 'integration test', registration_code: code,
  });
  users.push(p.id);
  return p;
}
const expectCode = async (fn, code) => assert.rejects(fn, (e) => { assert.equal(e.code, code, e.message); return true; });

test.before(async () => {
  if (!configured) return;
  svc = (await import('../../src/config/supabase.js')).getServiceClient();
  admin = await import('../../src/services/admin.service.js');
  auth = await import('../../src/services/auth.service.js');
  const { data } = await svc.from('profiles').select('id').eq('role', 'admin').limit(1).maybeSingle();
  ADMIN.userId = data?.id ?? null; // activity log actor
});
test.after(async () => {
  for (const id of users) await svc?.auth.admin.deleteUser(id).catch(() => {});
  for (const id of codes) await svc?.from('staff_registration_codes').delete().eq('id', id);
});

test('full lifecycle with a real code', opts, async () => {
  // custom exact date-time (Asia/Bangkok) is stored as the same instant
  const exp = new Date(Date.now() + 3 * 86400e3);
  exp.setUTCSeconds(0, 0);
  const bkk = new Date(exp.getTime() + 7 * 3600e3).toISOString().slice(0, 16);
  const created = await admin.createRegistrationCode(ADMIN, { label: 'TEST โค้ดทดสอบ', usage_limit: 2, expires_at: `${bkk}+07:00` });
  codes.push(created.id);
  assert.match(created.code, /^STAFF-/);
  assert.equal(new Date(created.expires_at).getTime(), exp.getTime());
  assert.equal(created.state, 'active');
  assert.equal(created.code_hash, undefined);
  assert.equal(created.code_encrypted, undefined);

  // stored: never plain text
  const { data: raw } = await svc.from('staff_registration_codes').select('*').eq('id', created.id).single();
  assert.ok(!JSON.stringify(raw).includes(created.code), 'plain code must not be stored');

  const list = await admin.listRegistrationCodes();
  const row = list.find((r) => r.id === created.id);
  assert.ok(row && row.state === 'active' && row.used_by === 0 && !('code_encrypted' in row));

  if (created.encrypted) {
    assert.equal((await admin.revealRegistrationCode(ADMIN, created.id)).code, created.code);
  } else {
    await expectCode(() => admin.revealRegistrationCode(ADMIN, created.id), 'MIGRATION_REQUIRED');
  }

  // past expiry rejected by the server clock
  await expectCode(() => admin.updateRegistrationCode(ADMIN, created.id, { expires_at: '2020-01-01T00:00:00+07:00' }), 'EXPIRY_IN_PAST');

  // disabled → registration refused with a clear message
  let u = await admin.updateRegistrationCode(ADMIN, created.id, { status: 'disabled', label: 'TEST แก้ไขแล้ว' });
  assert.equal(u.state, 'disabled');
  await assert.rejects(() => registerStaff(created.code), /ปิดใช้งาน/);

  // enabled → real registration works and is linked to the code
  u = await admin.updateRegistrationCode(ADMIN, created.id, { status: 'active', expires_in_days: 7 });
  assert.equal(u.state, 'active');
  assert.ok(Math.abs(new Date(u.expires_at).getTime() - (Date.now() + 7 * 86400e3)) < 60e3);
  const p1 = await registerStaff(created.code.toLowerCase()); // case-insensitive like before
  const detail = await admin.getRegistrationCode(created.id);
  assert.equal(detail.code.usage_count, 1);
  assert.equal(detail.code.remaining, 1);
  assert.ok(detail.accounts.some((a) => a.id === p1.id && a.used_at));

  // limit: second use OK, third refused as fully used
  await registerStaff(created.code);
  await assert.rejects(() => registerStaff(created.code), /ครบจำนวน/);
  assert.equal((await admin.getRegistrationCode(created.id)).code.state, 'fully_used');
  await expectCode(() => admin.updateRegistrationCode(ADMIN, created.id, { usage_limit: 1 }), 'USAGE_LIMIT_TOO_LOW');

  // raise the limit, then let it expire at an exact time a few seconds from now
  const soon = new Date(Date.now() + 4000).toISOString();
  u = await admin.updateRegistrationCode(ADMIN, created.id, { usage_limit: 5, expires_at: soon });
  assert.equal(u.state, 'active');
  await sleep(5000);
  assert.equal((await admin.getRegistrationCode(created.id)).code.state, 'expired');
  await assert.rejects(() => registerStaff(created.code), /หมดอายุ/);

  // re-open an expired code with a new expiry
  u = await admin.updateRegistrationCode(ADMIN, created.id, { expires_at: null });
  assert.equal(u.state, 'active');

  // delete: accounts stay
  await admin.deleteRegistrationCode(ADMIN, created.id);
  codes.pop();
  const { data: still } = await svc.from('profiles').select('id').eq('id', p1.id).maybeSingle();
  assert.ok(still, 'account created with the code must remain');
  await assert.rejects(() => registerStaff(created.code), /ไม่ถูกต้อง/);
});

test('search by code / unit name, and the displayed code registers for real', opts, async () => {
  const cap = await admin.registrationCodeCapabilities();
  const c = await admin.createRegistrationCode(ADMIN, { label: `TEST ค้นหา ${crypto.randomBytes(3).toString('hex')}`, usage_limit: 1 });
  codes.push(c.id);
  assert.equal(c.encrypted, cap.encryption_ready);

  // full code → matched by HMAC hash (works for old hash-only codes too)
  let hits = await admin.listRegistrationCodes({ q: c.code.toLowerCase() });
  assert.deepEqual(hits.map((r) => r.id), [c.id]);
  assert.ok(!JSON.stringify(hits).includes(c.code), 'search results must not contain the code');
  hits = await admin.listRegistrationCodes({ q: c.label.slice(-6) });
  assert.ok(hits.some((r) => r.id === c.id));
  hits = await admin.listRegistrationCodes({ q: 'STAFF-ZZZZ-ZZZZ-ZZZZ' });
  assert.ok(!hits.some((r) => r.id === c.id));

  let shown = c.code; // without migration 006 the code is shown once, in the create response
  if (cap.encryption_ready) {
    hits = await admin.listRegistrationCodes({ q: c.code.slice(6, 10) }); // part of the code
    assert.ok(hits.some((r) => r.id === c.id));
    shown = (await admin.revealRegistrationCode(ADMIN, c.id)).code; // what the admin sees in the table
    assert.equal(shown, c.code);
  }
  const p = await registerStaff(shown);
  const d = await admin.getRegistrationCode(c.id);
  assert.ok(d.accounts.some((a) => a.id === p.id));
  assert.equal(d.code.state, 'fully_used');
});

test('preset expiry + preview code + disabled at creation', opts, async () => {
  const { code } = admin.newRegistrationCodePreview();
  const c = await admin.createRegistrationCode(ADMIN, { code, expires_in_days: 1, status: 'disabled' });
  codes.push(c.id);
  assert.equal(c.code, code);
  assert.equal(c.state, 'disabled');
  assert.ok(Math.abs(new Date(c.expires_at).getTime() - (Date.now() + 86400e3)) < 60e3);
  await expectCode(() => admin.createRegistrationCode(ADMIN, { code }), 'CODE_TAKEN');
  await expectCode(() => admin.createRegistrationCode(ADMIN, { expires_at: new Date(Date.now() - 1000).toISOString() }), 'EXPIRY_IN_PAST');
});
