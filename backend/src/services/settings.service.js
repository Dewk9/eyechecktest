import { getServiceClient } from '../config/supabase.js';
import { config } from '../config/env.js';
import { unwrap } from '../utils/app-error.js';

const DEFAULTS = {
  ai_confidence_threshold: { value: 0.6, validated: false, note: 'ค่าเริ่มต้น ยังไม่ผ่านการประเมินกับชุดข้อมูลทดสอบ' },
  consent_version: { value: '1.0' },
  active_model: null,
};

let cache = null;
let cacheAt = 0;
const TTL = 30 * 1000;

export async function getAllSettings({ fresh = false } = {}) {
  if (!fresh && cache && Date.now() - cacheAt < TTL) return cache;
  const rows = unwrap(await getServiceClient().from('admin_settings').select('setting_key, setting_value, updated_at'));
  const out = { ...DEFAULTS };
  for (const r of rows ?? []) out[r.setting_key] = r.setting_value;
  cache = out;
  cacheAt = Date.now();
  return out;
}

export async function getSetting(key) {
  return (await getAllSettings())[key];
}

export async function setSetting(key, value, userId) {
  unwrap(await getServiceClient()
    .from('admin_settings')
    .upsert({ setting_key: key, setting_value: value, updated_by: userId, updated_at: new Date().toISOString() }, { onConflict: 'setting_key' }));
  cache = null;
}

/** Active model = admin selection in DB, otherwise the .env defaults. */
export async function getActiveModelConfig() {
  const fromDb = await getSetting('active_model');
  if (fromDb && fromDb.workspace && fromDb.project && fromDb.version) {
    return { workspace: fromDb.workspace, project: fromDb.project, version: String(fromDb.version), source: 'admin' };
  }
  const r = config.roboflow;
  if (r.workspace && r.project && r.modelVersion) {
    return { workspace: r.workspace, project: r.project, version: String(r.modelVersion), source: 'env' };
  }
  return null;
}

export async function getConfidenceThreshold() {
  const s = await getSetting('ai_confidence_threshold');
  const v = Number(s?.value);
  return { value: Number.isFinite(v) ? v : 0.6, validated: Boolean(s?.validated), note: s?.note ?? null };
}

export async function getConsentVersion() {
  const s = await getSetting('consent_version');
  return String(s?.value ?? '1.0');
}
