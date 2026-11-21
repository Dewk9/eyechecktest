/**
 * Builds a self-contained static site in dist/ for hosting the frontend on its own
 * (e.g. a Vercel project with Root Directory = frontend).
 *
 * When the backend serves the frontend (local dev), it also serves these paths itself
 * (see backend/src/app.js). A static host has no backend, so they are copied in here:
 *   /vendor/chart.js        <- node_modules/chart.js/dist/chart.umd.js
 *   /vendor/mediapipe/...   <- node_modules/@mediapipe/tasks-vision (bundle + wasm)
 *
 * /ai-shared/image-quality/metrics.js is a committed copy of ai/image-quality/metrics.js
 * (frontend/ai-shared/), so it ships with the site content and needs no build step.
 * Keep it in sync when ai/image-quality/metrics.js changes.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const NM = path.join(ROOT, 'node_modules');

// Top-level entries of frontend/ that are build tooling, not site content.
const SKIP = new Set(['dist', 'node_modules', 'scripts', 'package.json', 'package-lock.json', 'vercel.json', '.gitignore']);

function copy(from, to) {
  if (!fs.existsSync(from)) throw new Error(`build: missing ${path.relative(path.resolve(ROOT, '..'), from)}`);
  fs.cpSync(from, to, { recursive: true });
}

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });

for (const entry of fs.readdirSync(ROOT)) {
  if (!SKIP.has(entry)) copy(path.join(ROOT, entry), path.join(DIST, entry));
}

copy(path.join(NM, 'chart.js', 'dist', 'chart.umd.js'), path.join(DIST, 'vendor', 'chart.js'));

const MP = path.join(NM, '@mediapipe', 'tasks-vision');
copy(path.join(MP, 'vision_bundle.mjs'), path.join(DIST, 'vendor', 'mediapipe', 'vision_bundle.mjs'));
copy(path.join(MP, 'wasm'), path.join(DIST, 'vendor', 'mediapipe', 'wasm'));

console.log('build: dist/ ready');
