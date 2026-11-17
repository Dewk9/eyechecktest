/**
 * Row Level Security / data-isolation tests against a REAL Supabase project.
 * Use a separate TEST project:  NODE_ENV=test with backend/.env.test configured.
 *   npm run test:integration
 * Creates temporary users and removes them afterwards. Skipped when Supabase is not configured.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { config, validateConfig } from '../../src/config/env.js';

const configured = validateConfig().errors.length === 0;
const opts = { skip: configured ? false : 'Supabase not configured (.env.test)' };

let svc; let anon; let userClient;
const created = [];
const pw = `T3st-${crypto.randomBytes(6).toString('hex')}`;

async function makeUser(type) {
  const username = `rls_${type}_${crypto.randomBytes(4).toString('hex')}`;
  const email = `${username}@${config.authEmailDomain}`;
  const { data, error } = await svc.auth.admin.createUser({ email, password: pw, email_confirm: true });
  if (error) throw error;
  created.push(data.user.id);
  const profile = type === 'personal'
    ? { id: data.user.id, username, full_name: 'RLS Test', account_type: 'personal', birth_date: '1980-01-01', gender: 'unspecified' }
    : { id: data.user.id, username, full_name: 'RLS Staff', account_type: 'staff', position: 'tester', workplace: 'test' };
  const { error: pErr } = await svc.from('profiles').insert(profile);
  if (pErr) throw pErr;
  const { data: s, error: sErr } = await anon().auth.signInWithPassword({ email, password: pw });
  if (sErr) throw sErr;
  return { id: data.user.id, db: userClient(s.session.access_token) };
}

test.before(async () => {
  if (!configured) return;
  const m = await import('../../src/config/supabase.js');
  svc = m.getServiceClient();
  anon = m.createAnonClient;
  userClient = m.createUserClient;
});
test.after(async () => {
  for (const id of created) await svc?.auth.admin.deleteUser(id).catch(() => {});
});

test('personal accounts cannot read each other\'s medical history', opts, async () => {
  const a = await makeUser('personal');
  const b = await makeUser('personal');
  const { error } = await a.db.from('medical_histories').insert({ user_id: a.id, age_group: '40_59' });
  assert.equal(error, null);
  const { data } = await b.db.from('medical_histories').select('*').eq('user_id', a.id);
  assert.equal(data.length, 0);
});

test('user cannot write data on behalf of another user', opts, async () => {
  const a = await makeUser('personal');
  const b = await makeUser('personal');
  const { error } = await b.db.from('medical_histories').insert({ user_id: a.id, age_group: '40_59' });
  assert.ok(error, 'insert for another user must fail');
});

test('user cannot escalate role to admin', opts, async () => {
  const a = await makeUser('personal');
  const { error } = await a.db.from('profiles').update({ role: 'admin' }).eq('id', a.id);
  assert.ok(error, 'role update must be rejected');
  const { data } = await svc.from('profiles').select('role').eq('id', a.id).single();
  assert.equal(data.role, 'user');
});

test('staff cannot see another staff member\'s patients', opts, async () => {
  const s1 = await makeUser('staff');
  const s2 = await makeUser('staff');
  const { data: p, error } = await s1.db.from('patients').insert({ owner_id: s1.id, full_name: 'ผู้ทดสอบ', birth_date: '1970-05-05', age: 56, gender: 'male' }).select().single();
  assert.equal(error, null);
  const { data } = await s2.db.from('patients').select('*').eq('id', p.id);
  assert.equal(data.length, 0);
});

test('personal account cannot create patients', opts, async () => {
  const a = await makeUser('personal');
  const { error } = await a.db.from('patients').insert({ owner_id: a.id, full_name: 'x y', birth_date: '1970-05-05', age: 56, gender: 'male' });
  assert.ok(error);
});

test('users cannot fake AI results', opts, async () => {
  const a = await makeUser('personal');
  const { data: h } = await a.db.from('medical_histories').insert({ user_id: a.id, age_group: '40_59' }).select().single();
  const fake = await a.db.from('screenings').insert({
    screening_code: 'EC-20260101-FAKE01', user_id: a.id, medical_history_id: h.id, eye_side: 'left',
    ai_status: 'completed', primary_finding: 'cataract', risk_level: 'low',
  });
  assert.ok(fake.error, 'inserting a completed AI result must be rejected');

  const { data: s, error } = await a.db.from('screenings').insert({ screening_code: 'EC-20260101-REAL01', user_id: a.id, medical_history_id: h.id, eye_side: 'left' }).select().single();
  assert.equal(error, null);
  const upd = await a.db.from('screenings').update({ ai_status: 'completed' }).eq('id', s.id);
  assert.ok(upd.error, 'updating ai_status must be rejected');
  const pred = await a.db.from('ai_predictions').insert({ screening_id: s.id, predicted_class: 'cataract', disease_key: 'cataract', confidence_score: 0.99, model_version: 'x' });
  assert.ok(pred.error, 'inserting predictions must be rejected');
});

test('non-admins cannot read admin tables', opts, async () => {
  const a = await makeUser('personal');
  for (const t of ['dataset_images', 'activity_logs', 'admin_settings', 'staff_registration_codes', 'roboflow_projects']) {
    const { data } = await a.db.from(t).select('*').limit(1);
    assert.equal((data ?? []).length, 0, t);
  }
});
