import test from 'node:test';
import assert from 'node:assert/strict';
import { encryptRegistrationCode, decryptRegistrationCode } from '../../src/utils/code-crypto.js';
import { generateRegistrationCode, registrationCodeState, REGISTRATION_CODE_RE } from '../../src/utils/helpers.js';
import { regCodeSchema, regCodeUpdateSchema } from '../../src/validators/schemas.js';

const ID = '514dc487-22b4-4579-9d43-adbcdde8a918';

test('generated codes match the accepted format', () => {
  for (let i = 0; i < 50; i++) assert.match(generateRegistrationCode(), REGISTRATION_CODE_RE);
});

test('encrypted code round-trips, is not plain text, and is bound to its row id', () => {
  const code = generateRegistrationCode();
  const enc = encryptRegistrationCode(code, ID);
  assert.ok(!enc.includes(code));
  assert.notEqual(enc, encryptRegistrationCode(code, ID)); // random IV
  assert.equal(decryptRegistrationCode(enc, ID), code);
  assert.equal(decryptRegistrationCode(enc, '00000000-0000-4000-8000-000000000000'), null); // copied to another row
  const parts = enc.split('.');
  parts[4] = Buffer.from('STAFF-AAAA-AAAA-AAAA').toString('base64url');
  assert.equal(decryptRegistrationCode(parts.join('.'), ID), null); // tampered
  assert.equal(decryptRegistrationCode('garbage', ID), null);
});

test('code state uses the given (server) clock: disabled > expired > fully used > active', () => {
  const now = Date.parse('2026-11-30T16:58:00Z'); // 23:58 Bangkok
  const base = { status: 'active', expires_at: '2026-11-30T16:59:00Z', usage_limit: 5, usage_count: 1 };
  assert.equal(registrationCodeState(base, now), 'active');
  assert.equal(registrationCodeState(base, now + 60e3), 'expired'); // exactly at 23:59
  assert.equal(registrationCodeState({ ...base, usage_count: 5 }, now), 'fully_used');
  assert.equal(registrationCodeState({ ...base, status: 'exhausted' }, now), 'fully_used');
  assert.equal(registrationCodeState({ ...base, status: 'disabled' }, now + 60e3), 'disabled');
  assert.equal(registrationCodeState({ ...base, expires_at: null, usage_limit: null }, now), 'active');
});

test('expiry input: date-only (old clients), exact date-time with offset, presets', () => {
  assert.ok(regCodeSchema.safeParse({ expires_at: '2026-12-31' }).success);
  assert.ok(regCodeSchema.safeParse({ expires_at: '2026-11-30T23:59:00+07:00' }).success);
  assert.ok(regCodeSchema.safeParse({ expires_at: '2026-11-30T16:59:00.000Z' }).success);
  assert.ok(!regCodeSchema.safeParse({ expires_at: '2026-11-30T23:59' }).success); // no timezone → rejected
  assert.ok(regCodeSchema.safeParse({ expires_in_days: 7 }).success);
  assert.ok(!regCodeSchema.safeParse({ expires_in_days: 5 }).success);
  assert.ok(!regCodeSchema.safeParse({ expires_in_days: 7, expires_at: '2026-12-31' }).success);
  assert.ok(regCodeSchema.safeParse({ code: 'staff-7kq2-m9xa-p3td' }).success);
  assert.ok(!regCodeSchema.safeParse({ code: 'STAFF-0000-1111-IIII' }).success);
  assert.ok(regCodeUpdateSchema.safeParse({ status: 'disabled' }).success); // old status-only request
  assert.ok(regCodeUpdateSchema.safeParse({ expires_at: null }).success);
  assert.ok(!regCodeUpdateSchema.safeParse({}).success);
  assert.ok(!regCodeUpdateSchema.safeParse({ code_hash: 'x' }).success);
});
