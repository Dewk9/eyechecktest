#!/usr/bin/env node
/**
 * Verifies configuration AND live connectivity (Supabase DB/Auth/Storage, Roboflow).
 * Usage: npm run check-config
 */
import { config, validateConfig } from '../src/config/env.js';

const { errors, warnings } = validateConfig();
const line = (icon, msg) => console.log(`${icon} ${msg}`);

console.log(`\nEYE Check configuration check (NODE_ENV=${config.env})\n`);
for (const e of errors) line('✗', e);
for (const w of warnings) line('!', w);
if (errors.length) {
  console.log('\nFix the errors above (see backend/.env.example).');
  process.exit(1);
}
line('✓', 'Required environment variables present');

const { getServiceClient } = await import('../src/config/supabase.js');
const svc = getServiceClient();

const tables = ['profiles', 'patients', 'medical_histories', 'vision_tests', 'screenings', 'ai_predictions', 'risk_assessments',
  'screening_images', 'dataset_images', 'consent_records', 'activity_logs', 'roboflow_projects', 'admin_settings', 'staff_registration_codes'];
let dbOk = true;
for (const t of tables) {
  const { error } = await svc.from(t).select('id', { head: true, count: 'exact' });
  if (error) { dbOk = false; line('✗', `table ${t}: ${error.message}`); }
}
if (dbOk) line('✓', `Supabase database reachable, ${tables.length} tables found`);
else line('!', 'Run the migrations: npm run db:migrate (or paste database/migrations/*.sql into the Supabase SQL editor)');

const { data: buckets, error: bErr } = await svc.storage.listBuckets();
if (bErr) line('✗', `Storage: ${bErr.message}`);
else {
  for (const b of [config.supabase.screeningBucket, config.supabase.datasetBucket]) {
    const found = buckets.find((x) => x.name === b);
    if (!found) line('✗', `Storage bucket "${b}" missing (run 003_storage.sql)`);
    else line(found.public ? '!' : '✓', `Storage bucket "${b}" ${found.public ? 'is PUBLIC — should be private!' : 'exists (private)'}`);
  }
}

const { error: aErr } = await svc.auth.admin.listUsers({ page: 1, perPage: 1 });
line(aErr ? '✗' : '✓', aErr ? `Supabase Auth admin: ${aErr.message}` : 'Supabase Auth reachable with service role');

if (config.roboflow.apiKey) {
  const { getStatus } = await import('../src/roboflow/roboflow.service.js');
  const s = await getStatus({ fresh: true });
  if (!s.connected) line('✗', `Roboflow: ${s.reason}`);
  else {
    line('✓', `Roboflow connected: ${s.project} v${s.modelVersion} (${s.projectType})`);
    if (!s.ready) line('!', `Roboflow model not ready: ${s.reason}`);
    const sup = Object.entries(s.supportedDiseases).map(([k, v]) => `${k}:${v ? 'yes' : 'no'}`).join(', ');
    line('i', `Supported disease classes: ${sup}`);
  }
} else {
  line('!', 'Roboflow not configured — AI analysis will show "Not Connected"');
}
console.log('');
process.exit(0);
