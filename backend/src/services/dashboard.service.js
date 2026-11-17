import { getServiceClient } from '../config/supabase.js';
import { unwrap } from '../utils/app-error.js';
import { dateRange, bangkokDay } from '../utils/helpers.js';

const DISEASES = ['pinguecula', 'cataract', 'glaucoma', 'pterygium'];
const NEGATIVE = ['normal', 'no_finding'];
const REFERRAL = ['high', 'urgent'];
const PAGE = 1000;

/** Fetch all matching rows in pages (PostgREST caps a single response). */
async function fetchAll(buildQuery, max = 20000) {
  const out = [];
  for (let from = 0; from < max; from += PAGE) {
    const rows = unwrap(await buildQuery().range(from, from + PAGE - 1));
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

/**
 * Aggregates screenings. Only SAVED screenings with a finished analysis are
 * counted. Inconclusive / not-analysed results are reported separately and
 * are never assigned to a disease.
 *
 * count_by=screening → each screening counts once
 * count_by=person    → each person counts once per category in the period
 *                      (a person can appear in more than one category)
 */
export function aggregate(rows, { countBy = 'screening', disease } = {}) {
  const personKey = (r) => r.patient_id ?? `self:${r.user_id}`;
  const cats = [...DISEASES, 'negative'];
  const buckets = Object.fromEntries(cats.map((c) => [c, new Set()]));
  const inconclusive = new Set();
  const referrals = new Set();
  const persons = new Set();
  const conclusiveUnits = new Set();

  for (const r of rows) {
    const unit = countBy === 'person' ? personKey(r) : r.id;
    persons.add(personKey(r));
    if (REFERRAL.includes(r.risk_level)) referrals.add(unit);
    if (DISEASES.includes(r.primary_finding)) { buckets[r.primary_finding].add(unit); conclusiveUnits.add(unit); }
    else if (NEGATIVE.includes(r.primary_finding)) { buckets.negative.add(unit); conclusiveUnits.add(unit); }
    else inconclusive.add(unit);
  }

  const denominator = conclusiveUnits.size;
  const pct = (n) => (denominator ? Math.round((n / denominator) * 1000) / 10 : 0);
  const distribution = DISEASES
    .filter((d) => !disease || d === disease)
    .map((d) => ({ key: d, count: buckets[d].size, percent: pct(buckets[d].size) }));
  if (!disease) distribution.push({ key: 'negative', count: buckets.negative.size, percent: pct(buckets.negative.size) });

  return {
    count_by: countBy,
    total_screenings: rows.length,
    total_persons: persons.size,
    referrals: referrals.size,
    inconclusive: inconclusive.size,
    denominator,
    distribution,
    formula: 'เปอร์เซ็นต์ = (จำนวนของประเภทนั้น ÷ จำนวนทั้งหมดที่สรุปผลได้) × 100',
  };
}

export function trend(rows, from, to) {
  const days = new Map();
  for (const r of rows) {
    const d = bangkokDay(r.screening_date);
    const e = days.get(d) ?? { date: d, total: 0, referrals: 0, ...Object.fromEntries(DISEASES.map((k) => [k, 0])) };
    e.total++;
    if (REFERRAL.includes(r.risk_level)) e.referrals++;
    if (DISEASES.includes(r.primary_finding)) e[r.primary_finding]++;
    days.set(d, e);
  }
  // fill empty days between from..to (max 366)
  if (from && to) {
    const start = new Date(`${from}T00:00:00Z`);
    const end = new Date(`${to}T00:00:00Z`);
    for (let d = new Date(start), i = 0; d <= end && i < 366; d.setUTCDate(d.getUTCDate() + 1), i++) {
      const k = d.toISOString().slice(0, 10);
      if (!days.has(k)) days.set(k, { date: k, total: 0, referrals: 0, ...Object.fromEntries(DISEASES.map((x) => [x, 0])) });
    }
  }
  return [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function defaultRange(q) {
  const to = q.to ?? new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
  const from = q.from ?? new Date(new Date(`${to}T00:00:00Z`).getTime() - 29 * 864e5).toISOString().slice(0, 10);
  return { from, to };
}

const COLS = 'id, user_id, patient_id, screening_date, primary_finding, risk_level, ai_status';
const RECENT_COLS = 'id, screening_code, screening_date, eye_side, primary_finding, risk_level, ai_status, is_saved, patient_id, patients(full_name)';
const RECENT_COLS_ADMIN = 'id, screening_code, screening_date, eye_side, primary_finding, risk_level, ai_status, is_saved, patient_id';

async function build(db, scope, q, extra = {}) {
  const { from, to } = defaultRange(q);
  const range = dateRange(from, to);
  const base = () => {
    let query = db.from('screenings').select(COLS).eq('is_saved', true).gte('screening_date', range.from).lte('screening_date', range.to);
    if (scope.userId) query = query.eq('user_id', scope.userId);
    return query.order('screening_date', { ascending: true });
  };
  let recentQ = db.from('screenings').select(scope.userId ? RECENT_COLS : RECENT_COLS_ADMIN).order('screening_date', { ascending: false }).limit(8);
  if (scope.userId) recentQ = recentQ.eq('user_id', scope.userId);
  let allTimeQ = db.from('screenings').select('id', { count: 'exact', head: true }).eq('is_saved', true);
  if (scope.userId) allTimeQ = allTimeQ.eq('user_id', scope.userId);

  // the three reads are independent → run them concurrently
  const [rows, recentRes, { count: allTime }] = await Promise.all([fetchAll(base), recentQ, allTimeQ]);
  const recent = unwrap(recentRes);
  const filtered = q.disease ? rows.filter((r) => r.primary_finding === q.disease) : rows;

  return {
    range: { from, to },
    filters: { disease: q.disease ?? null },
    total_all_time: allTime ?? 0,
    summary: aggregate(filtered, { countBy: q.count_by, disease: q.disease }),
    trend: trend(filtered, from, to),
    // admins (no userId scope) never receive subject names
    recent: recent.map((r) => ({ ...r, subject_name: scope.userId ? (r.patients?.full_name ?? null) : null, patients: undefined })),
    note: 'นับเฉพาะผลการตรวจที่บันทึกแล้ว ผลที่สรุปไม่ได้จะไม่ถูกนับรวมเป็นโรคใดโรคหนึ่ง',
    generated_at: new Date().toISOString(),
    ...extra,
  };
}

export async function personalDashboard(auth, q) {
  const data = await build(auth.db, { userId: auth.userId }, { ...q, count_by: 'screening' });
  // results that need follow-up = high/urgent in range
  return data;
}

export async function staffDashboard(auth, q) {
  const [{ count: patients }, data] = await Promise.all([
    auth.db.from('patients').select('id', { count: 'exact', head: true }).eq('owner_id', auth.userId),
    build(auth.db, { userId: auth.userId }, q),
  ]);
  return { ...data, total_patients: patients ?? 0 };
}

export async function adminDashboard(q) {
  const svc = getServiceClient();
  const [{ count: patients }, { count: members }, data] = await Promise.all([
    svc.from('patients').select('id', { count: 'exact', head: true }),
    svc.from('profiles').select('id', { count: 'exact', head: true }),
    build(svc, {}, q),
  ]);
  return { ...data, total_patients: patients ?? 0, total_members: members ?? 0 };
}
