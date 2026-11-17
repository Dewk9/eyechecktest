/**
 * Thin HTTP client for the Roboflow REST + hosted inference APIs.
 * The API key is read from the backend environment only and is never sent
 * to the browser or written to logs (logger redacts api_key=...).
 *
 * Docs: https://docs.roboflow.com/api-reference
 */
import { config } from '../config/env.js';
import { AppError } from '../utils/app-error.js';
import { logger } from '../utils/logger.js';

const INFER_HOSTS = {
  'object-detection': 'https://detect.roboflow.com',
  'instance-segmentation': 'https://outline.roboflow.com',
  'semantic-segmentation': 'https://segment.roboflow.com',
  classification: 'https://classify.roboflow.com',
};

export class RoboflowError extends AppError {
  constructor(status, code, message, upstreamStatus, upstreamMessage) {
    super(status, code, message);
    this.upstreamStatus = upstreamStatus;
    this.upstreamMessage = upstreamMessage;
  }
}

function requireKey() {
  if (!config.roboflow.apiKey) {
    throw new RoboflowError(503, 'AI_NOT_CONNECTED', 'ยังไม่ได้เชื่อมต่อ Roboflow (ไม่ได้ตั้งค่า ROBOFLOW_API_KEY)');
  }
  return config.roboflow.apiKey;
}

function withKey(url, params = {}) {
  const u = new URL(url);
  u.searchParams.set('api_key', requireKey());
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, String(v));
  }
  return u;
}

async function request(url, { method = 'GET', body, headers = {}, timeoutMs = config.roboflow.timeoutMs } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(url, { method, body, headers, signal: controller.signal });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new RoboflowError(504, 'AI_TIMEOUT', 'Roboflow ใช้เวลาตอบกลับนานเกินกำหนด กรุณาลองใหม่');
    }
    throw new RoboflowError(503, 'AI_UNREACHABLE', 'ไม่สามารถเชื่อมต่อ Roboflow ได้ กรุณาตรวจสอบอินเทอร์เน็ตของเซิร์ฟเวอร์');
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON body */ }

  if (!res.ok) {
    const upstream = json?.error?.message || json?.message || json?.error || text.slice(0, 200);
    const msg = typeof upstream === 'string' ? upstream : JSON.stringify(upstream);
    if (res.status === 401 || res.status === 403) {
      throw new RoboflowError(502, 'AI_AUTH_FAILED', 'Roboflow ปฏิเสธ API Key หรือไม่มีสิทธิ์เข้าถึงโปรเจกต์นี้', res.status, msg);
    }
    if (res.status === 404) {
      throw new RoboflowError(404, 'AI_NOT_FOUND', 'ไม่พบ Workspace / Project / Version ที่ระบุใน Roboflow', res.status, msg);
    }
    if (res.status === 429) {
      throw new RoboflowError(429, 'AI_RATE_LIMITED', 'Roboflow จำกัดจำนวนการเรียกใช้ กรุณารอสักครู่', res.status, msg);
    }
    throw new RoboflowError(502, 'AI_UPSTREAM_ERROR', `Roboflow ตอบกลับข้อผิดพลาด (${res.status})`, res.status, msg);
  }
  if (json === null) throw new RoboflowError(502, 'AI_BAD_RESPONSE', 'Roboflow ส่งข้อมูลกลับมาในรูปแบบที่ไม่รองรับ');
  return json;
}

const api = (path) => `${config.roboflow.apiUrl}${path}`;

// ---------------------------------------------------------------------
// Roboflow Workflow Cloud API
// ---------------------------------------------------------------------
/** Connection / inference status codes reported to the app */
export const WORKFLOW_STATUS = Object.freeze({
  CONNECTED: 'CONNECTED',
  API_KEY_INVALID: 'API_KEY_INVALID',
  WORKFLOW_NOT_FOUND: 'WORKFLOW_NOT_FOUND',
  INFERENCE_FAILED: 'INFERENCE_FAILED',
  TIMEOUT: 'TIMEOUT',
  CONFIG_MISSING: 'CONFIG_MISSING',
});

/** Host + path of the workflow (not secret) for logs and admin display */
export function workflowLabel(url = config.roboflow.workflowUrl) {
  try { const u = new URL(url); return `${u.host}${u.pathname}`; } catch { return null; }
}

/**
 * Run the deployed Workflow (e.g. DINOv3 classifier) exactly as Roboflow's
 * "Deploy → Cloud API" snippet does: POST JSON { inputs: { image: { type, value } } }.
 * Auth: `Authorization: Bearer <key>` (verified against the live endpoint).
 * @param {{ imageBase64?: string, imageUrl?: string, timeoutMs?: number, requestId?: string }} p
 * @returns {Promise<{ body: object, status: number, ms: number }>}
 */
export async function runWorkflow({
  imageBase64, imageUrl, timeoutMs = config.roboflow.timeoutMs, requestId,
  apiKey = config.roboflow.apiKey, workflowUrl = config.roboflow.workflowUrl, // overrides: test script only
} = {}) {
  if (!apiKey || !workflowUrl) {
    throw new RoboflowError(503, WORKFLOW_STATUS.CONFIG_MISSING,
      `ยังตั้งค่า Roboflow ไม่ครบ (${[!apiKey && 'ROBOFLOW_API_KEY', !workflowUrl && 'ROBOFLOW_WORKFLOW_URL'].filter(Boolean).join(', ')})`);
  }
  if (!imageBase64 && !imageUrl) throw new RoboflowError(400, WORKFLOW_STATUS.INFERENCE_FAILED, 'ไม่มีภาพสำหรับวิเคราะห์');
  const image = imageUrl ? { type: 'url', value: imageUrl } : { type: 'base64', value: imageBase64 };

  const started = Date.now();
  const log = (level, msg, extra = {}) => logger[level](msg, {
    requestId, workflow: workflowLabel(workflowUrl), startedAt: new Date(started).toISOString(), ms: Date.now() - started, ...extra,
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(workflowUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ inputs: { image } }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      log('warn', 'roboflow workflow timeout', { code: WORKFLOW_STATUS.TIMEOUT, timeoutMs });
      throw new RoboflowError(504, WORKFLOW_STATUS.TIMEOUT, `Roboflow ใช้เวลาเกิน ${Math.max(1, Math.ceil(timeoutMs / 1000))} วินาที (Timeout) กรุณาลองใหม่`);
    }
    log('warn', 'roboflow workflow unreachable', { code: WORKFLOW_STATUS.INFERENCE_FAILED, error: err.message });
    throw new RoboflowError(503, WORKFLOW_STATUS.INFERENCE_FAILED, 'ไม่สามารถเชื่อมต่อ Roboflow ได้ กรุณาตรวจสอบอินเทอร์เน็ตของเซิร์ฟเวอร์');
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
  const upstream = String(json?.message ?? json?.error?.message ?? json?.error ?? text ?? '').slice(0, 300);

  if (!res.ok) {
    let code = WORKFLOW_STATUS.INFERENCE_FAILED;
    let msg = `Roboflow วิเคราะห์ภาพไม่สำเร็จ (HTTP ${res.status})`;
    if (res.status === 401 || res.status === 403) { code = WORKFLOW_STATUS.API_KEY_INVALID; msg = 'Roboflow API Key ไม่ถูกต้องหรือไม่มีสิทธิ์ใช้ Workflow นี้'; }
    else if (res.status === 404) { code = WORKFLOW_STATUS.WORKFLOW_NOT_FOUND; msg = 'ไม่พบ Workflow ที่ระบุใน ROBOFLOW_WORKFLOW_URL'; }
    else if (res.status === 429) { msg = 'Roboflow จำกัดจำนวนการเรียกใช้ (Rate limit/เครดิตหมด) กรุณารอสักครู่'; }
    else if (res.status === 408 || res.status === 504) { code = WORKFLOW_STATUS.TIMEOUT; msg = 'Roboflow ประมวลผลไม่ทันเวลา (Timeout)'; }
    log('warn', 'roboflow workflow error', { status: res.status, code, upstream });
    throw new RoboflowError(res.status >= 500 ? 502 : res.status === 429 ? 429 : 502, code, msg, res.status, upstream);
  }
  if (!json || !Array.isArray(json.outputs)) {
    log('warn', 'roboflow workflow bad response', { status: res.status, code: WORKFLOW_STATUS.INFERENCE_FAILED });
    throw new RoboflowError(502, WORKFLOW_STATUS.INFERENCE_FAILED, 'Roboflow ส่งผลลัพธ์ในรูปแบบที่ไม่รองรับ', res.status, upstream);
  }
  log('info', 'roboflow workflow ok', { status: res.status });
  return { body: json, status: res.status, ms: Date.now() - started };
}

export const roboflow = {
  /** Validates the key and returns the workspace the key belongs to. */
  async root() {
    return request(withKey(api('/')));
  },
  async workspace(ws) {
    return request(withKey(api(`/${encodeURIComponent(ws)}`)));
  },
  async project(ws, project) {
    return request(withKey(api(`/${encodeURIComponent(ws)}/${encodeURIComponent(project)}`)));
  },
  async version(ws, project, version) {
    return request(withKey(api(`/${encodeURIComponent(ws)}/${encodeURIComponent(project)}/${encodeURIComponent(version)}`)));
  },

  /** Hosted inference. `imageBase64` is the raw base64 (no data: prefix). */
  async infer({ projectType, project, version, imageBase64, confidence = 1, endpointHost }) {
    const host = endpointHost || INFER_HOSTS[projectType] || INFER_HOSTS['object-detection'];
    // Request every prediction (confidence floor 1%) so the app applies its own threshold transparently.
    const params = projectType === 'classification' ? {} : { confidence, overlap: 30 };
    const url = withKey(`${host}/${encodeURIComponent(project)}/${encodeURIComponent(version)}`, params);
    return request(url, {
      method: 'POST',
      body: imageBase64,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeoutMs: Math.max(config.roboflow.timeoutMs, 20000),
    });
  },

  /** Upload an image into the project's dataset. */
  async upload({ project, imageBase64, name, split = 'train', tags = [], batch = 'eyecheck' }) {
    const url = withKey(api(`/dataset/${encodeURIComponent(project)}/upload`), { name, split, batch });
    for (const t of tags) url.searchParams.append('tag', t);
    return request(url, {
      method: 'POST',
      body: imageBase64,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeoutMs: 60000,
    });
  },

  /** Image search in the project (Roboflow "search" endpoint). */
  async searchImages(ws, project, { offset = 0, limit = 24, className, tag, prompt }) {
    const body = {
      offset, limit,
      fields: ['id', 'name', 'split', 'tags', 'labels', 'annotations', 'created', 'owner'],
      ...(className ? { class_name: className } : {}),
      ...(tag ? { tag } : {}),
      ...(prompt ? { prompt } : {}),
    };
    return request(withKey(api(`/${encodeURIComponent(ws)}/${encodeURIComponent(project)}/search`)), {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    });
  },

  async image(ws, project, imageId) {
    return request(withKey(api(`/${encodeURIComponent(ws)}/${encodeURIComponent(project)}/images/${encodeURIComponent(imageId)}`)));
  },

  /**
   * Delete an image. Roboflow's public API support for this varies by plan;
   * the upstream response is reported back as-is.
   */
  async deleteImage(ws, project, imageId) {
    return request(withKey(api(`/${encodeURIComponent(ws)}/${encodeURIComponent(project)}/images/${encodeURIComponent(imageId)}`)), {
      method: 'DELETE',
    });
  },

  /** Generate a new dataset version. */
  async generateVersion(ws, project, settings) {
    return request(withKey(api(`/${encodeURIComponent(ws)}/${encodeURIComponent(project)}/generate`)), {
      method: 'POST',
      body: JSON.stringify(settings),
      headers: { 'Content-Type': 'application/json' },
      timeoutMs: 60000,
    });
  },

  /** Start hosted training for a version (requires a Roboflow plan with training credits). */
  async train(ws, project, version, options = {}) {
    return request(withKey(api(`/${encodeURIComponent(ws)}/${encodeURIComponent(project)}/${encodeURIComponent(version)}/train`)), {
      method: 'POST',
      body: JSON.stringify(options),
      headers: { 'Content-Type': 'application/json' },
      timeoutMs: 60000,
    });
  },
};
