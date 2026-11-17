import test from 'node:test';
import assert from 'node:assert/strict';
import { assessQuality, laplacianVariance, luminanceStats } from '../../../ai/image-quality/metrics.js';
import { calcAge, ageGroupFor, generateScreeningCode, sanitizeSearch } from '../../src/utils/helpers.js';
import { aggregate } from '../../src/services/dashboard.service.js';

function image(w, h, fn) {
  const g = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) g[y * w + x] = fn(x, y);
  return g;
}

test('flat image is blurry, sharp checkerboard is not', () => {
  const flat = image(64, 64, () => 128);
  const checker = image(64, 64, (x, y) => (((x >> 2) + (y >> 2)) % 2 ? 40 : 200));
  assert.equal(laplacianVariance(flat, 64, 64), 0);
  assert.ok(laplacianVariance(checker, 64, 64) > 1000);
});

test('dark image fails brightness, good image passes hard checks', () => {
  const dark = image(512, 384, () => 15);
  const q1 = assessQuality({ gray: dark, width: 512, height: 384, originalWidth: 1280, originalHeight: 960 });
  assert.equal(q1.passed, false);
  assert.ok(q1.errors.some((e) => e.includes('มืด')));

  // mid-grey textured background with a dark round "iris" in the centre
  const eye = image(512, 384, (x, y) => {
    const d = Math.hypot(x - 256, y - 192);
    if (d < 45) return 25;
    return 120 + ((x * 7 + y * 13) % 60);
  });
  const q2 = assessQuality({ gray: eye, width: 512, height: 384, originalWidth: 1280, originalHeight: 960 });
  assert.equal(q2.passed, true, JSON.stringify(q2.errors));
  assert.equal(q2.metrics.eye.found, true);
});

test('low resolution fails', () => {
  const g = image(320, 240, (x, y) => 100 + ((x + y) % 50));
  const q = assessQuality({ gray: g, width: 320, height: 240, originalWidth: 320, originalHeight: 240 });
  assert.equal(q.checks.find((c) => c.key === 'resolution').passed, false);
});

test('luminance stats', () => {
  const s = luminanceStats(new Uint8Array([0, 255, 0, 255]));
  assert.equal(s.mean, 127.5);
  assert.equal(s.overRatio, 0.5);
});

test('age helpers', () => {
  assert.equal(calcAge('2000-06-15', new Date('2026-06-14T00:00:00Z')), 25);
  assert.equal(calcAge('2000-06-15', new Date('2026-06-15T00:00:00Z')), 26);
  assert.equal(ageGroupFor(39), 'under_40');
  assert.equal(ageGroupFor(40), '40_59');
  assert.equal(ageGroupFor(60), '60_plus');
});

test('screening code format', () => {
  assert.match(generateScreeningCode(new Date('2026-11-15T10:00:00Z')), /^EC-20261115-[A-Z0-9]{6}$/);
});

test('search sanitising removes PostgREST syntax', () => {
  assert.equal(sanitizeSearch('a,b(c)*%'), 'a b c');
});

test('dashboard aggregate: inconclusive excluded, percentages from conclusive results', () => {
  const rows = [
    { id: '1', user_id: 'u', patient_id: 'p1', primary_finding: 'cataract', risk_level: 'high' },
    { id: '2', user_id: 'u', patient_id: 'p1', primary_finding: 'cataract', risk_level: 'moderate' },
    { id: '3', user_id: 'u', patient_id: 'p2', primary_finding: 'normal', risk_level: 'low' },
    { id: '4', user_id: 'u', patient_id: 'p3', primary_finding: 'inconclusive', risk_level: 'inconclusive' },
    { id: '5', user_id: 'u', patient_id: 'p3', primary_finding: 'pterygium', risk_level: 'urgent' },
  ];
  const byScreening = aggregate(rows, { countBy: 'screening' });
  assert.equal(byScreening.total_screenings, 5);
  assert.equal(byScreening.inconclusive, 1);
  assert.equal(byScreening.denominator, 4);
  assert.equal(byScreening.distribution.find((d) => d.key === 'cataract').percent, 50);
  assert.equal(byScreening.referrals, 2);

  const byPerson = aggregate(rows, { countBy: 'person' });
  assert.equal(byPerson.distribution.find((d) => d.key === 'cataract').count, 1); // p1 counted once
  assert.equal(byPerson.total_persons, 3);
});
