#!/usr/bin/env node
/**
 * Creates a staff registration code from the command line (admins can also
 * do this in Admin → โค้ดสมัครเจ้าหน้าที่). Stored: HMAC hash (registration) + AES-256-GCM
 * ciphertext (admins can show/copy it later, needs migration 006). Never plain text.
 * --expires accepts YYYY-MM-DD (23:59 Asia/Bangkok) or YYYY-MM-DDTHH:mm (Asia/Bangkok).
 *
 *   npm run create-staff-code -- --label "รพ.สต. บ้านหนองบัว" --limit 20 --expires 2026-12-31
 */
import { getServiceClient } from '../src/config/supabase.js';
import { validateConfig } from '../src/config/env.js';
import crypto from 'node:crypto';
import { generateRegistrationCode, hashRegistrationCode } from '../src/utils/helpers.js';
import { encryptRegistrationCode } from '../src/utils/code-crypto.js';

const { errors } = validateConfig();
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }

const argv = process.argv.slice(2);
const get = (k) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
const limit = get('limit') ? Number.parseInt(get('limit'), 10) : null;
const expires = get('expires');
if (expires && !/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(expires)) { console.error('--expires must be YYYY-MM-DD or YYYY-MM-DDTHH:mm (Asia/Bangkok)'); process.exit(1); }
const expiresAt = expires ? new Date(expires.includes('T') ? `${expires}:00+07:00` : `${expires}T23:59:59+07:00`) : null;
if (expiresAt && !(expiresAt.getTime() > Date.now())) { console.error('--expires must be in the future'); process.exit(1); }

const code = generateRegistrationCode();
const id = crypto.randomUUID();
const row = {
  id,
  code_hash: hashRegistrationCode(code),
  label: get('label') ?? null,
  usage_limit: Number.isFinite(limit) ? limit : null,
  expires_at: expiresAt ? expiresAt.toISOString() : null,
};
const table = () => getServiceClient().from('staff_registration_codes');
let { error } = await table().insert({ ...row, code_encrypted: encryptRegistrationCode(code, id) });
let encrypted = true;
if (error && ['42703', 'PGRST204'].includes(error.code)) { encrypted = false; ({ error } = await table().insert(row)); }
if (error) { console.error(error.message); process.exit(1); }
console.log(`\nStaff registration code:\n\n   ${code}\n`);
console.log(encrypted ? 'Admins can view it again in Admin → โค้ดสมัครบัญชีเจ้าหน้าที่.' : 'Migration 006 not applied — this code is shown only once. Save it now.');
