#!/usr/bin/env node
/**
 * LIVE tests against the real Roboflow Workflow configured in backend/.env.
 * No mocks: every case calls Roboflow over the network. The API key is never printed.
 *
 *   npm run test:roboflow                       (uses a generated test image)
 *   npm run test:roboflow -- --image path.jpg   (use a real eye photo — recommended)
 */
import fs from 'node:fs';
import sharp from 'sharp';
import { config } from '../src/config/env.js';
import { runWorkflow, WORKFLOW_STATUS, workflowLabel } from '../src/roboflow/client.js';
import { extractWorkflowPrediction, normalizePrediction, summarizeFindings } from '../../ai/roboflow/normalize.js';
import { buildModelCapabilities } from '../../ai/roboflow/class-map.js';

const results = [];
const record = (name, pass, detail) => { results.push({ name, pass }); console.log(`${pass ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`); };
const expectCode = async (name, fn, code) => {
  try { await fn(); record(name, false, 'expected an error but the call succeeded'); }
  catch (e) { record(name, e.code === code, `${e.code}${e.upstreamStatus ? ` (HTTP ${e.upstreamStatus})` : ''}: ${e.message}`); }
};

const imgArg = process.argv.indexOf('--image');
let image;
let imageNote;
if (imgArg > 0) {
  image = await sharp(fs.readFileSync(process.argv[imgArg + 1])).rotate().jpeg({ quality: 92 }).toBuffer();
  imageNote = `real image ${process.argv[imgArg + 1]}`;
} else {
  image = await sharp({ create: { width: 640, height: 480, channels: 3, background: { r: 170, g: 130, b: 115 } } }).jpeg().toBuffer();
  imageNote = 'generated test image (NOT an eye — prediction values are meaningless, only the pipeline is tested)';
}

console.log(`\nRoboflow Workflow live test · ${workflowLabel() ?? '(no ROBOFLOW_WORKFLOW_URL)'}\nImage: ${imageNote}\n`);

// 1. environment variables
const missing = ['apiKey', 'workflowUrl'].filter((k) => !config.roboflow[k]);
record('1. Environment variables (ROBOFLOW_API_KEY, ROBOFLOW_WORKFLOW_URL)', missing.length === 0, missing.length ? `missing: ${missing.join(', ')}` : `timeout ${config.roboflow.timeoutMs} ms`);
if (missing.length) process.exit(1);

// 2–5. key + URL valid, send image, receive prediction
let body;
try {
  const r = await runWorkflow({ imageBase64: image.toString('base64'), requestId: 'live-test' });
  body = r.body;
  record('2. API key accepted', true, `HTTP ${r.status}`);
  record('3. Workflow URL found', true, `${r.ms} ms`);
  record('4. Image sent (base64, inputs.image)', true);
} catch (e) {
  record('2–4. Call workflow', false, `${e.code}: ${e.message}`);
  process.exit(1);
}
try {
  const { prediction, modelId } = extractWorkflowPrediction(body);
  const n = normalizePrediction(prediction);
  const cap = buildModelCapabilities(n.classes.map((c) => c.className));
  const s = summarizeFindings(n, cap, 0.6);
  record('5. Prediction received and parsed', n.classes.length > 0,
    `model ${modelId} · ${n.kind} · ${n.classes.map((c) => `${c.className}=${(c.confidence * 100).toFixed(2)}%`).join(', ')} · outcome@60%=${s.outcome}/${s.primary}`);
  console.log(`   supported diseases: ${Object.entries(cap.supported).map(([k, v]) => `${k}:${v ? 'yes' : 'NO'}`).join(', ')}`);
} catch (e) {
  record('5. Prediction received and parsed', false, e.message);
}

// 6. wrong API key
await expectCode('6. Wrong API key → API_KEY_INVALID', () => runWorkflow({ imageBase64: image.toString('base64'), apiKey: 'invalid-key-000' }), WORKFLOW_STATUS.API_KEY_INVALID);

// 7. wrong workflow URL
const badUrl = config.roboflow.workflowUrl.replace(/\/workflows\/.+$/, '/workflows/this-workflow-does-not-exist');
await expectCode('7. Wrong workflow URL → WORKFLOW_NOT_FOUND', () => runWorkflow({ imageBase64: image.toString('base64'), workflowUrl: badUrl }), WORKFLOW_STATUS.WORKFLOW_NOT_FOUND);

// 8. invalid image data
await expectCode('8. Invalid image data → INFERENCE_FAILED', () => runWorkflow({ imageBase64: Buffer.from('this is not an image').toString('base64') }), WORKFLOW_STATUS.INFERENCE_FAILED);

// 9. timeout
await expectCode('9. Timeout (limit 1 ms) → TIMEOUT', () => runWorkflow({ imageBase64: image.toString('base64'), timeoutMs: 1 }), WORKFLOW_STATUS.TIMEOUT);

const failed = results.filter((r) => !r.pass).length;
console.log(`\n${results.length - failed}/${results.length} passed\n`);
process.exit(failed ? 1 : 0);
