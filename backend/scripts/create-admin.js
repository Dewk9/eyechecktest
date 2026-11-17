#!/usr/bin/env node
/**
 * Creates an Administrator account, or promotes an existing account.
 * Administrators can NEVER be created through the public registration API.
 *
 *   npm run create-admin -- --username admin01 --name "ผู้ดูแลระบบ" --password "S3cure-Pass"
 *   npm run create-admin -- --username somchai --promote
 */
import { getServiceClient } from '../src/config/supabase.js';
import { validateConfig } from '../src/config/env.js';
import { usernameToEmail } from '../src/services/auth.service.js';

const { errors } = validateConfig();
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => {
  if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]);
  return acc;
}, []));

const username = String(args.username ?? '').toLowerCase();
if (!/^[a-z0-9_.]{3,30}$/.test(username)) { console.error('--username is required (a-z, 0-9, _ or ., 3–30 chars)'); process.exit(1); }

const svc = getServiceClient();
const { data: existing } = await svc.from('profiles').select('id, role').eq('username', username).maybeSingle();

if (args.promote) {
  if (!existing) { console.error(`User ${username} not found`); process.exit(1); }
  const { error } = await svc.from('profiles').update({ role: 'admin' }).eq('id', existing.id);
  if (error) { console.error(error.message); process.exit(1); }
  await svc.from('activity_logs').insert({ user_id: existing.id, action: 'admin_role_changed', details: { role: 'admin', via: 'cli' } });
  console.log(`✓ ${username} is now an administrator`);
  process.exit(0);
}

if (existing) { console.error(`Username ${username} already exists. Use --promote to make it an admin.`); process.exit(1); }
const password = String(args.password ?? '');
if (password.length < 10 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
  console.error('--password must be ≥10 chars and contain letters and digits'); process.exit(1);
}
const { data, error } = await svc.auth.admin.createUser({ email: usernameToEmail(username), password, email_confirm: true, user_metadata: { username } });
if (error) { console.error(`Auth error: ${error.message}`); process.exit(1); }
const { error: pErr } = await svc.from('profiles').insert({
  id: data.user.id,
  username,
  full_name: String(args.name ?? 'ผู้ดูแลระบบ'),
  account_type: 'staff',
  position: 'Administrator',
  workplace: String(args.workplace ?? 'EYE Check'),
  role: 'admin',
  status: 'active',
});
if (pErr) {
  await svc.auth.admin.deleteUser(data.user.id);
  console.error(`Profile error: ${pErr.message}`);
  process.exit(1);
}
await svc.from('activity_logs').insert({ user_id: data.user.id, action: 'admin_created', details: { via: 'cli' } });
console.log(`✓ Administrator ${username} created`);
