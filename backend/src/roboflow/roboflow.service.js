import { roboflow, RoboflowError, runWorkflow, workflowLabel, WORKFLOW_STATUS } from './client.js';
import { buildModelCapabilities } from '../../../ai/roboflow/class-map.js';
import { extractWorkflowPrediction, normalizePrediction } from '../../../ai/roboflow/normalize.js';
import { config } from '../config/env.js';
import { getServiceClient } from '../config/supabase.js';
import { getActiveModelConfig } from '../services/settings.service.js';
import { logger } from '../utils/logger.js';

const PROJECT_CACHE_TTL = 5 * 60 * 1000;
const projectCache = new Map();

function projectSlug(p) {
  // Roboflow returns ids like "workspace/project"
  return String(p?.id ?? '').split('/').pop() || p?.name;
}

function pickVersion(projectResponse, version) {
  const list = projectResponse?.versions ?? [];
  return list.find((v) => String(v.id ?? '').split('/').pop() === String(version)) ?? null;
}

function versionModel(v) {
  const m = v?.model;
  if (!m || typeof m !== 'object') return null;
  return {
    id: m.id ?? null,
    endpoint: m.endpoint ?? null,
    type: m.type ?? null,
    map: m.map ?? null,
    precision: m.precision ?? null,
    recall: m.recall ?? null,
    start: m.start ?? null,
    end: m.end ?? null,
    status: m.status ?? null,
  };
}

export async function getProjectDetails(workspace, project, { fresh = false } = {}) {
  const key = `${workspace}/${project}`;
  const hit = projectCache.get(key);
  if (!fresh && hit && Date.now() - hit.at < PROJECT_CACHE_TTL) return hit.value;
  const value = await roboflow.project(workspace, project);
  projectCache.set(key, { at: Date.now(), value });
  return value;
}

// ---------------------------------------------------------------------
// Workflow mode (ROBOFLOW_WORKFLOW_URL set) — the deployed Workflow is the
// source of truth. Its availability and its real output classes are learned
// from an actual test call, never from the REST version list (which reports
// `model: null` for Workflow-deployed models such as DINOv3).
// ---------------------------------------------------------------------
const PROBE_OK_TTL = 10 * 60 * 1000;
const PROBE_ERR_TTL = 60 * 1000;
let probeCache = null; // { at, ok, value | error }

export const isWorkflowMode = () => Boolean(config.roboflow.workflowUrl);

async function probeImageBase64() {
  // small neutral test image — only used to verify connectivity and read the class list
  const sharp = (await import('sharp')).default;
  const buf = await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 128, g: 128, b: 128 } } }).jpeg().toBuffer();
  return buf.toString('base64');
}

/** Real test call to the Workflow; result cached (success 10 min, failure 1 min). */
export async function probeWorkflow({ fresh = false } = {}) {
  if (!fresh && probeCache && Date.now() - probeCache.at < (probeCache.ok ? PROBE_OK_TTL : PROBE_ERR_TTL)) {
    if (probeCache.ok) return probeCache.value;
    throw probeCache.error;
  }
  try {
    const { body, ms } = await runWorkflow({ imageBase64: await probeImageBase64(), requestId: `probe-${Date.now()}` });
    const { prediction, modelId, predictionType } = extractWorkflowPrediction(body);
    const normalized = normalizePrediction(prediction);
    const classNames = normalized.classes.map((c) => c.className);
    const value = { modelId, predictionType: predictionType ?? normalized.kind, kind: normalized.kind, classNames, latencyMs: ms, checkedAt: new Date().toISOString() };
    probeCache = { at: Date.now(), ok: true, value };
    return value;
  } catch (err) {
    const e = err instanceof RoboflowError ? err
      : new RoboflowError(502, WORKFLOW_STATUS.INFERENCE_FAILED, `Workflow ตอบกลับแต่ไม่พบผลการทำนายของโมเดล (${err.message})`);
    probeCache = { at: Date.now(), ok: false, error: e };
    throw e;
  }
}

async function getWorkflowModel({ fresh = false } = {}) {
  const probe = await probeWorkflow({ fresh });
  // Detection models only return classes that were detected; for them the project class list is used as a hint.
  let classNames = probe.classNames;
  if (probe.kind === 'detection' && config.roboflow.workspace && config.roboflow.project) {
    try {
      const d = await getProjectDetails(config.roboflow.workspace, config.roboflow.project);
      classNames = [...new Set([...classNames, ...Object.keys(d.project?.classes ?? {})])];
    } catch { /* keep the classes seen in the real output */ }
  }
  const projectType = { classification: 'classification', 'object-detection': 'object-detection', 'instance-segmentation': 'instance-segmentation' }[probe.predictionType] ?? probe.predictionType;
  return {
    mode: 'workflow',
    workspace: config.roboflow.workspace || null,
    project: config.roboflow.project || null,
    projectName: config.roboflow.project || null,
    projectType,
    kind: probe.kind,
    version: config.roboflow.modelVersion || null,
    modelId: probe.modelId,
    workflow: workflowLabel(),
    versionFound: true,
    hasTrainedModel: true, // verified: the Workflow returned real model predictions
    model: null,
    source: 'env',
    classes: classNames,
    capabilities: buildModelCapabilities(classNames),
    latencyMs: probe.latencyMs,
    checkedAt: probe.checkedAt,
  };
}

/**
 * Resolves the active model and what it can actually detect.
 * Throws RoboflowError when not connected / not configured.
 */
export async function getActiveModel({ fresh = false } = {}) {
  if (!config.roboflow.apiKey) {
    throw new RoboflowError(503, WORKFLOW_STATUS.CONFIG_MISSING, 'ยังไม่ได้เชื่อมต่อ Roboflow (ไม่ได้ตั้งค่า ROBOFLOW_API_KEY)');
  }
  if (isWorkflowMode()) return getWorkflowModel({ fresh });
  const active = await getActiveModelConfig();
  if (!active) {
    throw new RoboflowError(503, 'AI_NOT_CONFIGURED', 'ยังไม่ได้เลือกโปรเจกต์และเวอร์ชันโมเดล กรุณาให้ผู้ดูแลระบบตั้งค่า');
  }
  const details = await getProjectDetails(active.workspace, active.project, { fresh });
  const proj = details.project ?? {};
  const version = pickVersion(details, active.version);
  const classNames = Object.keys(proj.classes ?? version?.classes ?? {});
  const model = versionModel(version);
  return {
    mode: 'legacy',
    workspace: active.workspace,
    project: active.project,
    projectName: proj.name ?? active.project,
    projectType: proj.type ?? null,
    version: active.version,
    versionFound: Boolean(version),
    hasTrainedModel: Boolean(model),
    model,
    source: active.source,
    classes: classNames,
    capabilities: buildModelCapabilities(classNames),
    images: proj.images ?? null,
    updated: proj.updated ?? null,
  };
}

const RECORD_INTERVAL_MS = 5 * 60 * 1000;
let lastRecorded = { sig: null, at: 0 };

/** Public, secret-free status for /api/ai/status */
export async function getStatus({ fresh = false } = {}) {
  try {
    const m = await getActiveModel({ fresh });
    const ready = m.versionFound && m.hasTrainedModel;
    if (m.project) {
      // bookkeeping write: only when something changed (or every 5 min); public calls don't wait for it
      const sig = `${m.workspace}/${m.project}@${m.version}:connected`;
      if (fresh || sig !== lastRecorded.sig || Date.now() - lastRecorded.at > RECORD_INTERVAL_MS) {
        lastRecorded = { sig, at: Date.now() };
        const write = recordProjectStatus(m, 'connected');
        if (fresh) await write;
      }
    }
    return {
      connected: true,
      ready,
      status: ready ? WORKFLOW_STATUS.CONNECTED : 'MODEL_UNVERIFIED',
      mode: m.mode,
      // legacy mode only: the REST API did not report a model — that does NOT prove it is untrained
      reason: !m.versionFound ? 'ไม่พบเวอร์ชันที่เลือกในโปรเจกต์'
        : !m.hasTrainedModel ? 'Roboflow REST API ไม่รายงานโมเดลของเวอร์ชันนี้ (โมเดลแบบ Workflow เช่น DINOv3 ต้องตั้งค่า ROBOFLOW_WORKFLOW_URL)' : null,
      modelId: m.modelId ?? null,
      workflow: m.workflow ?? null,
      kind: m.kind ?? null,
      latencyMs: m.latencyMs ?? null,
      checkedAt: m.checkedAt ?? new Date().toISOString(),
      project: m.project,
      projectName: m.projectName,
      projectType: m.projectType,
      modelVersion: m.version,
      supportedDiseases: m.capabilities.supported,
      hasNormalClass: m.capabilities.hasNormalClass,
      classes: m.capabilities.classes,
    };
  } catch (err) {
    if (err instanceof RoboflowError) {
      const status = Object.values(WORKFLOW_STATUS).includes(err.code) ? err.code
        : err.code === 'AI_AUTH_FAILED' ? WORKFLOW_STATUS.API_KEY_INVALID
          : err.code === 'AI_NOT_FOUND' ? WORKFLOW_STATUS.WORKFLOW_NOT_FOUND
            : err.code === 'AI_TIMEOUT' ? WORKFLOW_STATUS.TIMEOUT
              : err.code === 'AI_NOT_CONFIGURED' ? WORKFLOW_STATUS.CONFIG_MISSING : WORKFLOW_STATUS.INFERENCE_FAILED;
      return { connected: false, ready: false, status, code: err.code, mode: isWorkflowMode() ? 'workflow' : 'legacy', workflow: isWorkflowMode() ? workflowLabel() : null, reason: err.message, checkedAt: new Date().toISOString() };
    }
    throw err;
  }
}

async function recordProjectStatus(m, status, lastError = null) {
  try {
    const svc = getServiceClient();
    await svc.from('roboflow_projects').update({ is_active: false }).neq('project_id', `${m.workspace}/${m.project}`).eq('is_active', true);
    await svc.from('roboflow_projects').upsert({
      workspace_name: m.workspace,
      project_name: m.projectName ?? m.project,
      project_id: `${m.workspace}/${m.project}`,
      project_type: m.projectType,
      model_version: m.version,
      classes: m.capabilities?.classes ?? [],
      is_active: true,
      connection_status: status,
      last_error: lastError,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'project_id' });
  } catch (err) {
    logger.warn('roboflow_projects upsert failed', { error: err });
  }
}

export function clearProjectCache() {
  projectCache.clear();
  probeCache = null;
}

export { projectSlug, pickVersion, versionModel };
