/**
 * HTTP-level checks that do not need a live Supabase project:
 * CSRF guard, auth guard, admin guard, validation, static serving, 404s.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = 'https://example-unit-test.supabase.co';
process.env.SUPABASE_ANON_KEY = 'test-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
process.env.JWT_SECRET = 'x'.repeat(40);
process.env.ROBOFLOW_API_KEY = '';

const { createApp } = await import('../../src/app.js');
const app = createApp();
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

const post = (path, body, headers = {}) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });

test('health endpoint', async () => {
  const r = await fetch(`${base}/api/health`);
  assert.equal(r.status, 200);
  assert.equal((await r.json()).data.status, 'ok');
});

test('POST without CSRF header is rejected', async () => {
  const r = await post('/api/auth/login', { username: 'abc', password: 'x' });
  assert.equal(r.status, 403);
  assert.equal((await r.json()).error.code, 'CSRF_REJECTED');
});

test('POST from foreign origin is rejected', async () => {
  const r = await post('/api/auth/login', { username: 'abc', password: 'x' }, { 'X-Requested-With': 'EyeCheck', Origin: 'https://evil.example' });
  assert.equal(r.status, 403);
});

test('validation errors are 422 with Thai messages', async () => {
  const r = await post('/api/auth/register', { account_type: 'personal', username: 'A!', password: '1' }, { 'X-Requested-With': 'EyeCheck' });
  assert.equal(r.status, 422);
  const j = await r.json();
  assert.equal(j.error.code, 'VALIDATION_ERROR');
  assert.ok(j.error.details.length > 0);
});

test('registration rejects attempts to set role (field is stripped / never used)', async () => {
  const r = await post('/api/auth/register', { account_type: 'admin', role: 'admin' }, { 'X-Requested-With': 'EyeCheck' });
  assert.equal(r.status, 422);
});

test('protected endpoints require login', async () => {
  for (const p of ['/api/screenings', '/api/profiles/me', '/api/patients', '/api/dashboard/personal']) {
    const r = await fetch(base + p);
    assert.equal(r.status, 401, p);
  }
});

test('admin endpoints require login', async () => {
  const r = await fetch(`${base}/api/admin/users`);
  assert.equal(r.status, 401);
});

test('me returns null when not logged in', async () => {
  const r = await fetch(`${base}/api/auth/me`);
  assert.equal(r.status, 200);
  assert.equal((await r.json()).data, null);
});

test('unknown API → 404 JSON', async () => {
  const r = await fetch(`${base}/api/nope`);
  assert.equal(r.status, 404);
  assert.equal((await r.json()).error.code, 'ENDPOINT_NOT_FOUND');
});

test('frontend pages and shared modules are served with CSP', async () => {
  const r = await fetch(`${base}/`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
  const m = await fetch(`${base}/ai-shared/image-quality/metrics.js`);
  assert.equal(m.status, 200);
  assert.match(m.headers.get('content-type'), /javascript/);
  const c = await fetch(`${base}/vendor/chart.js`);
  assert.equal(c.status, 200);
});

test('unknown page → 404 page', async () => {
  const r = await fetch(`${base}/does-not-exist`);
  assert.equal(r.status, 404);
});

test('secrets are never served', async () => {
  for (const p of ['/.env', '/backend/.env', '/../backend/.env.example']) {
    const r = await fetch(base + p);
    assert.notEqual(r.status, 200, p);
  }
});
