/**
 * END-TO-END against REAL services: Express API → Supabase (Auth, DB, Storage) → Roboflow Workflow.
 * Creates ONE temporary personal account, runs a screening + real AI analysis through the HTTP API,
 * verifies what was saved in Supabase, then deletes only that temporary account and its files.
 * Skipped when Supabase or the Roboflow Workflow is not configured. Uses one Roboflow inference credit.
 *
 *   npm run test:integration
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { config, validateConfig } from '../../src/config/env.js';

const ready = validateConfig().errors.length === 0 && config.roboflow.apiKey && config.roboflow.workflowUrl;
const opts = { skip: ready ? false : 'Supabase / Roboflow Workflow not configured', timeout: 120000 };

let server; let base; let svc;
let userId = null;
const cookies = {};

async function call(method, path, body, isForm = false) {
  const headers = { 'X-Requested-With': 'EyeCheck', Cookie: Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ') };
  if (body && !isForm) headers['Content-Type'] = 'application/json';
  const res = await fetch(base + path, { method, headers, body: isForm ? body : body ? JSON.stringify(body) : undefined });
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [pair] = c.split(';');
    const [k, v] = pair.split('=');
    cookies[k] = v;
  }
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

/** Synthetic image that passes the quality gate (NOT a real eye — the model output is not meaningful). */
async function testImage() {
  const w = 960; const h = 720;
  const raw = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const d = Math.hypot(x - w / 2, y - h / 2);
      const v = d < 90 ? 25 : 120 + ((x * 7 + y * 13) % 60);
      const i = (y * w + x) * 3;
      raw[i] = v + 20; raw[i + 1] = v; raw[i + 2] = v - 10;
    }
  }
  return sharp(raw, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 92 }).toBuffer();
}

test.before(async () => {
  if (!ready) return;
  const { createApp } = await import('../../src/app.js');
  const { getServiceClient } = await import('../../src/config/supabase.js');
  svc = getServiceClient();
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}/api`;
});

test.after(async () => {
  if (userId) {
    const { data: scr } = await svc.from('screenings').select('image_path').eq('user_id', userId);
    const paths = (scr ?? []).map((s) => s.image_path).filter(Boolean);
    if (paths.length) await svc.storage.from(config.supabase.screeningBucket).remove(paths);
    await svc.auth.admin.deleteUser(userId); // cascades to all rows of this temporary user only
  }
  server?.close();
});

test('register → history → upload → real AI analysis → saved in Supabase', opts, async () => {
  const username = `e2e_${crypto.randomBytes(4).toString('hex')}`;
  const password = `E2e-${crypto.randomBytes(6).toString('hex')}1`;

  const reg = await call('POST', '/auth/register', {
    account_type: 'personal', full_name: 'E2E Test User', username, birth_date: '1960-03-01', gender: 'unspecified',
    password, confirm_password: password, accept_terms: true,
  });
  assert.equal(reg.status, 201, JSON.stringify(reg.json));
  userId = reg.json.data.profile.id;

  const login = await call('POST', '/auth/login', { username, password, remember: false });
  assert.equal(login.status, 200, JSON.stringify(login.json));

  const hist = await call('POST', '/medical-history', { age_group: '60_plus', diabetes: true, eye_symptoms: ['blurry_cloudy'] });
  assert.equal(hist.status, 201, JSON.stringify(hist.json));

  const fd = new FormData();
  fd.append('image', new Blob([await testImage()], { type: 'image/jpeg' }), 'eye.jpg');
  fd.append('eye_side', 'right');
  fd.append('medical_history_id', hist.json.data.id);
  fd.append('dataset_consent', 'false');
  const up = await call('POST', '/screenings', fd, true);
  assert.equal(up.status, 201, JSON.stringify(up.json));
  const screeningId = up.json.data.screening.id;

  const an = await call('POST', '/ai/analyze', { screening_id: screeningId });
  assert.equal(an.status, 200, JSON.stringify(an.json));
  const r = an.json.data;
  console.log('   ai_status:', r.screening.ai_status, '| primary:', r.screening.primary_finding, '| risk:', r.risk_assessment?.risk_level,
    '| model:', r.ai?.model?.model_id, '| classes:', (r.predictions ?? []).map((p) => `${p.predicted_class}=${(Number(p.confidence_score) * 100).toFixed(2)}%`).join(', '));
  assert.ok(['completed', 'insufficient_confidence'].includes(r.screening.ai_status), `AI did not run: ${r.screening.ai_status} ${r.screening.ai_error}`);
  assert.equal(r.ai.model.mode, 'workflow');
  assert.ok(r.predictions.length > 0);
  assert.equal(r.ai.diseases.find((d) => d.disease === 'pinguecula').status, 'not_supported');

  // verify directly in Supabase (service role)
  const { data: s } = await svc.from('screenings').select('*').eq('id', screeningId).single();
  assert.equal(s.user_id, userId);
  assert.equal(s.ai_status, r.screening.ai_status);
  assert.ok(s.image_path?.startsWith(`${userId}/`));
  const { data: preds } = await svc.from('ai_predictions').select('*').eq('screening_id', screeningId);
  assert.equal(preds.length, r.predictions.length);
  assert.match(preds[0].model_version, /dinov3/);
  const { data: risk } = await svc.from('risk_assessments').select('*').eq('screening_id', screeningId).single();
  assert.ok(risk.medical_history_summary.available, 'history snapshot stored separately');
  const { data: img } = await svc.from('screening_images').select('*').eq('screening_id', screeningId);
  assert.equal(img.length, 1);
  const { data: consent } = await svc.from('consent_records').select('*').eq('screening_id', screeningId);
  assert.equal(consent[0].consent_status, 'denied');
  const { data: file } = await svc.storage.from(config.supabase.screeningBucket).download(s.image_path);
  assert.ok(file && file.size > 0, 'image stored in private bucket');

  const save = await call('POST', `/results/${screeningId}/save`);
  assert.equal(save.status, 200);
  const { data: saved } = await svc.from('screenings').select('is_saved').eq('id', screeningId).single();
  assert.equal(saved.is_saved, true);

  // the image is reachable only through a signed URL
  const res = await call('GET', `/results/${screeningId}`);
  assert.match(res.json.data.image_url, /token=/);
});
