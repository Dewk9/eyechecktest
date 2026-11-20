import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const BACKEND_ROOT = path.resolve(__dirname, '..', '..');
export const PROJECT_ROOT = path.resolve(BACKEND_ROOT, '..');

const NODE_ENV = process.env.NODE_ENV || 'development';

// Environment-specific files first; dotenv never overrides an already-set value.
for (const name of [`.env.${NODE_ENV}.local`, `.env.${NODE_ENV}`, '.env']) {
  const file = path.join(BACKEND_ROOT, name);
  if (fs.existsSync(file)) dotenv.config({ path: file, override: false });
}

const str = (key, def = '') => String(process.env[key] ?? def).trim();
const int = (key, def) => {
  const v = Number.parseInt(process.env[key] ?? '', 10);
  return Number.isFinite(v) ? v : def;
};
const bool = (key, def) => {
  const v = process.env[key];
  if (v === undefined || v === '') return def;
  return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
};

const isProd = NODE_ENV === 'production';

export const config = Object.freeze({
  env: NODE_ENV,
  isProd,
  isTest: NODE_ENV === 'test',
  port: int('BACKEND_PORT', 3000),
  frontendUrl: str('FRONTEND_URL', 'http://localhost:3000').replace(/\/+$/, ''),
  serveFrontend: bool('SERVE_FRONTEND', true),
  // Comma-separated origins added to the CSP connect-src of the served frontend.
  cspConnectSrc: str('CSP_CONNECT_SRC').split(',').map((s) => s.trim()).filter(Boolean),
  trustProxy: bool('TRUST_PROXY', isProd),
  forceHttps: bool('FORCE_HTTPS', isProd),
  cookieSecure: bool('COOKIE_SECURE', isProd),
  // 'strict' when frontend and backend share an origin; 'none' when the frontend is on another domain
  cookieSameSite: str('COOKIE_SAMESITE', 'strict').toLowerCase(),
  jwtSecret: str('JWT_SECRET'),
  // optional dedicated key for encrypting staff registration codes (falls back to a key derived from JWT_SECRET)
  registrationCodeKey: str('REGISTRATION_CODE_KEY'),
  authEmailDomain: str('AUTH_EMAIL_DOMAIN', 'users.eyecheck.example.com'),
  rememberMeDays: int('REMEMBER_ME_DAYS', 30),
  uploadMaxBytes: int('UPLOAD_MAX_MB', 8) * 1024 * 1024,
  supabase: Object.freeze({
    url: str('SUPABASE_URL').replace(/\/+$/, ''),
    anonKey: str('SUPABASE_ANON_KEY'),
    serviceRoleKey: str('SUPABASE_SERVICE_ROLE_KEY'),
    dbUrl: str('SUPABASE_DB_URL'),
    screeningBucket: str('SUPABASE_SCREENING_BUCKET', 'screening-images'),
    datasetBucket: str('SUPABASE_DATASET_BUCKET', 'eye-datasets'),
  }),
  roboflow: Object.freeze({
    apiKey: str('ROBOFLOW_API_KEY'),
    workspace: str('ROBOFLOW_WORKSPACE'),
    project: str('ROBOFLOW_PROJECT'),
    modelVersion: str('ROBOFLOW_MODEL_VERSION'),
    // Cloud API endpoint copied from Roboflow → Deploy Workflow → Cloud API (preferred inference path)
    workflowUrl: str('ROBOFLOW_WORKFLOW_URL').replace(/\/+$/, ''),
    apiUrl: str('ROBOFLOW_API_URL', 'https://api.roboflow.com').replace(/\/+$/, ''),
    timeoutMs: int('ROBOFLOW_TIMEOUT_MS', 30000),
  }),
});

/**
 * Validate configuration before the server starts.
 * Errors stop the server; warnings only disable optional features.
 */
export function validateConfig(c = config) {
  const errors = [];
  const warnings = [];

  if (!c.supabase.url) errors.push('SUPABASE_URL is required');
  else {
    try {
      const u = new URL(c.supabase.url);
      if (u.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(u.hostname)) {
        errors.push('SUPABASE_URL must use https');
      }
    } catch {
      errors.push('SUPABASE_URL is not a valid URL');
    }
  }
  if (!c.supabase.anonKey) errors.push('SUPABASE_ANON_KEY is required');
  if (!c.supabase.serviceRoleKey) errors.push('SUPABASE_SERVICE_ROLE_KEY is required');
  if (c.supabase.anonKey && c.supabase.anonKey === c.supabase.serviceRoleKey) {
    errors.push('SUPABASE_SERVICE_ROLE_KEY must not equal SUPABASE_ANON_KEY');
  }
  if (!c.jwtSecret || c.jwtSecret.length < 32) errors.push('JWT_SECRET must be at least 32 characters');
  if (c.registrationCodeKey && c.registrationCodeKey.length < 32) errors.push('REGISTRATION_CODE_KEY must be at least 32 characters');
  if (!(c.port > 0 && c.port < 65536)) errors.push('BACKEND_PORT must be a valid port number');
  try { new URL(c.frontendUrl); } catch { errors.push('FRONTEND_URL is not a valid URL'); }
  if (!['strict', 'lax', 'none'].includes(c.cookieSameSite)) errors.push('COOKIE_SAMESITE must be strict, lax or none');
  if (c.cookieSameSite === 'none' && !c.cookieSecure) errors.push('COOKIE_SAMESITE=none requires COOKIE_SECURE=true');

  if (c.roboflow.workflowUrl) {
    try {
      const u = new URL(c.roboflow.workflowUrl);
      const local = ['localhost', '127.0.0.1'].includes(u.hostname);
      if (u.protocol !== 'https:' && !local) errors.push('ROBOFLOW_WORKFLOW_URL must use https');
      if (!local && !u.pathname.includes('/workflows/')) {
        errors.push('ROBOFLOW_WORKFLOW_URL must be the Workflow Cloud API URL (…/<workspace>/workflows/<workflow-id>) copied from Roboflow → Deploy → Cloud API');
      }
    } catch {
      errors.push('ROBOFLOW_WORKFLOW_URL is not a valid URL');
    }
  }
  if (!c.roboflow.apiKey) warnings.push('ROBOFLOW_API_KEY is not set — AI analysis will report "Not Connected" (CONFIG_MISSING)');
  else if (!c.roboflow.workflowUrl) {
    warnings.push('ROBOFLOW_WORKFLOW_URL is not set — falling back to legacy hosted model endpoints (DINOv3 / Workflow models need ROBOFLOW_WORKFLOW_URL)');
  }
  if (c.roboflow.apiKey && !c.roboflow.workflowUrl && (!c.roboflow.workspace || !c.roboflow.project)) {
    warnings.push('ROBOFLOW_WORKSPACE / ROBOFLOW_PROJECT not set — an admin must select a project in the Admin panel');
  }
  if (c.isProd && !c.cookieSecure) warnings.push('COOKIE_SECURE should be true in production (HTTPS)');
  if (!c.supabase.dbUrl) warnings.push('SUPABASE_DB_URL is not set — `npm run db:migrate` will not work');

  return { errors, warnings };
}

export const isRoboflowKeyConfigured = () => Boolean(config.roboflow.apiKey);
