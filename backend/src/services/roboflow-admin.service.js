import crypto from 'node:crypto';
import { roboflow } from '../roboflow/client.js';
import { getProjectDetails, getActiveModel, getStatus, clearProjectCache, projectSlug, versionModel, isWorkflowMode } from '../roboflow/roboflow.service.js';
import { buildModelCapabilities } from '../../../ai/roboflow/class-map.js';
import { config } from '../config/env.js';
import { AppError } from '../utils/app-error.js';
import { getActiveModelConfig, setSetting } from './settings.service.js';
import { logActivity } from './activity.service.js';
import { inspectAndNormalizeImage } from './image-quality.service.js';

async function workspaceId() {
  const active = await getActiveModelConfig();
  if (active?.workspace) return active.workspace;
  if (config.roboflow.workspace) return config.roboflow.workspace;
  const root = await roboflow.root();
  if (typeof root.workspace === 'string') return root.workspace;
  throw new AppError(503, 'AI_NOT_CONFIGURED', 'ไม่สามารถระบุ Workspace ได้ กรุณาตั้งค่า ROBOFLOW_WORKSPACE');
}

async function requireProject() {
  const active = await getActiveModelConfig();
  if (active) return active;
  if (config.roboflow.workspace && config.roboflow.project) {
    return { workspace: config.roboflow.workspace, project: config.roboflow.project, version: config.roboflow.modelVersion || null };
  }
  throw new AppError(503, 'AI_NOT_CONFIGURED', 'ยังไม่ได้เลือกโปรเจกต์ Roboflow');
}

export async function status() {
  const base = {
    api_key_configured: Boolean(config.roboflow.apiKey),
    env_defaults: { workspace: config.roboflow.workspace || null, project: config.roboflow.project || null, version: config.roboflow.modelVersion || null },
    active: await getActiveModelConfig(),
  };
  base.mode = isWorkflowMode() ? 'workflow' : 'legacy';
  if (!base.api_key_configured) return { ...base, connected: false, status: 'CONFIG_MISSING', reason: 'ยังไม่ได้ตั้งค่า ROBOFLOW_API_KEY ในไฟล์ .env ของ Backend' };
  if (isWorkflowMode()) {
    // the Workflow test call is the source of truth for the AI connection
    const ai = await getStatus({ fresh: true });
    if (!ai.connected) return { ...base, connected: false, status: ai.status, reason: ai.reason, code: ai.code, ai };
    base.active = base.active ?? { workspace: config.roboflow.workspace, project: config.roboflow.project, version: config.roboflow.modelVersion, source: 'env' };
    let project = null;
    if (config.roboflow.workspace && config.roboflow.project) {
      try { project = await projectSummary(config.roboflow.workspace, config.roboflow.project); } catch (err) { project = { error: `ข้อมูล Dataset จาก REST API: ${err.message}` }; }
    }
    return { ...base, connected: true, status: ai.status, ai, project };
  }
  try {
    await roboflow.root(); // validates the key
  } catch (err) {
    return { ...base, connected: false, reason: err.message, code: err.code };
  }
  const ai = await getStatus({ fresh: true });
  let project = null;
  if (base.active) {
    try { project = await projectSummary(base.active.workspace, base.active.project); } catch (err) { project = { error: err.message }; }
  }
  return { ...base, connected: true, ai, project };
}

/** Dataset metadata from the Roboflow REST API (informational) */
async function projectSummary(workspace, projectId) {
  const d = await getProjectDetails(workspace, projectId);
  const p = d.project ?? {};
  return {
    id: p.id, name: p.name, type: p.type, images: p.images ?? null, unannotated: p.unannotated ?? null,
    annotated: typeof p.images === 'number' && typeof p.unannotated === 'number' ? p.images - p.unannotated : null,
    classes: p.classes ?? {}, class_count: Object.keys(p.classes ?? {}).length,
    versions: (d.versions ?? []).length, splits: p.splits ?? null, created: p.created ?? null, updated: p.updated ?? null,
    annotation_group: p.annotation ?? null,
  };
}

export async function workspaces() {
  const ws = await workspaceId();
  const data = await roboflow.workspace(ws);
  const w = data.workspace ?? {};
  return [{ id: w.url ?? ws, name: w.name ?? ws, members: Array.isArray(w.members) ? w.members.length : null, project_count: (w.projects ?? []).length }];
}

export async function projects() {
  const ws = await workspaceId();
  const data = await roboflow.workspace(ws);
  return (data.workspace?.projects ?? []).map((p) => ({
    id: projectSlug(p), full_id: p.id, name: p.name, type: p.type, images: p.images ?? null,
    unannotated: p.unannotated ?? null, classes: p.classes ?? {}, versions: p.versions ?? null, updated: p.updated ?? null,
    workspace: ws,
  }));
}

/** Dataset versions of a project (with their trained model, if any) */
export async function versions(projectId) {
  const active = await requireProject();
  const ws = active.workspace;
  const proj = projectId || active.project;
  const d = await getProjectDetails(ws, proj, { fresh: true });
  const classes = Object.keys(d.project?.classes ?? {});
  return {
    workspace: ws,
    project: proj,
    project_type: d.project?.type ?? null,
    capabilities: buildModelCapabilities(classes),
    versions: (d.versions ?? []).map((v) => ({
      version: String(v.id ?? '').split('/').pop(),
      name: v.name ?? null,
      images: v.images ?? null,
      splits: v.splits ?? null,
      created: v.created ?? null,
      preprocessing: v.preprocessing ?? null,
      augmentation: v.augmentation ?? null,
      model: versionModel(v),
      is_active: active.project === proj && String(active.version) === String(String(v.id ?? '').split('/').pop()),
    })),
  };
}

export async function versionDetail(version) {
  const active = await requireProject();
  return roboflow.version(active.workspace, active.project, version);
}

export async function setActiveModel(admin, { workspace, project, version }) {
  const d = await getProjectDetails(workspace, project, { fresh: true });
  const v = (d.versions ?? []).find((x) => String(x.id ?? '').split('/').pop() === String(version));
  if (!v) throw new AppError(404, 'AI_NOT_FOUND', `ไม่พบเวอร์ชัน ${version} ในโปรเจกต์ ${project}`);
  if (!versionModel(v)) throw new AppError(409, 'MODEL_NOT_TRAINED', `เวอร์ชัน ${version} ยังไม่มีโมเดลที่ฝึกแล้ว จึงยังตั้งเป็นโมเดลที่ใช้งานไม่ได้`);
  await setSetting('active_model', { workspace, project, version: String(version) }, admin.userId);
  clearProjectCache();
  await logActivity(admin.userId, 'admin_active_model_set', { workspace, project, version: String(version) });
  return getActiveModel({ fresh: true });
}

export async function searchImages(q) {
  const active = await requireProject();
  const res = await roboflow.searchImages(active.workspace, active.project, {
    offset: q.offset, limit: q.limit, className: q.class_name, tag: q.tag, prompt: q.search,
  });
  return {
    offset: res.offset ?? q.offset,
    total: res.total ?? null,
    items: (res.results ?? []).map((r) => ({
      id: r.id, name: r.name, split: r.split ?? null, tags: r.tags ?? [], labels: r.labels ?? r.annotations?.classes ?? null,
      created: r.created ?? null, owner: undefined,
    })),
  };
}

export async function imageDetail(id) {
  const active = await requireProject();
  const res = await roboflow.image(active.workspace, active.project, id);
  const img = res.image ?? res;
  return {
    id: img.id, name: img.name, split: img.split ?? null, tags: img.tags ?? [], labels: img.labels ?? null,
    annotation: img.annotation ?? null, urls: img.urls ?? null, created: img.created ?? null,
  };
}

export async function deleteImage(admin, id) {
  const active = await requireProject();
  try {
    const res = await roboflow.deleteImage(active.workspace, active.project, id);
    await logActivity(admin.userId, 'admin_roboflow_image_deleted', { roboflow_image_id: id });
    return { deleted: true, response: res };
  } catch (err) {
    if ([404, 405].includes(err.upstreamStatus)) {
      throw new AppError(501, 'NOT_SUPPORTED_BY_API', 'Roboflow API ไม่รองรับการลบภาพนี้ผ่าน API กรุณาลบผ่านหน้าเว็บ Roboflow');
    }
    throw err;
  }
}

export async function uploadImage(admin, file, { split = 'train', tag } = {}) {
  const active = await requireProject();
  const img = await inspectAndNormalizeImage(file.buffer); // verifies format, strips EXIF/GPS
  const res = await roboflow.upload({
    project: active.project, imageBase64: img.buffer.toString('base64'),
    name: `${crypto.randomUUID()}.jpg`, split, tags: ['eyecheck-admin', ...(tag ? [tag] : [])],
  });
  await logActivity(admin.userId, 'admin_roboflow_upload', { roboflow_image_id: res.id ?? null });
  return res;
}

export async function generateVersion(admin, { resize }) {
  const active = await requireProject();
  const res = await roboflow.generateVersion(active.workspace, active.project, {
    preprocessing: { 'auto-orient': true, resize: { width: resize, height: resize, format: 'Stretch to' } },
    augmentation: {},
  });
  clearProjectCache();
  await logActivity(admin.userId, 'admin_roboflow_version_generated', { project: active.project });
  return res;
}

export async function startTraining(admin, { version, speed }) {
  const active = await requireProject();
  const res = await roboflow.train(active.workspace, active.project, version, speed ? { speed } : {});
  clearProjectCache();
  await logActivity(admin.userId, 'admin_roboflow_training_started', { project: active.project, version });
  return res;
}

export function projectUrl(active) {
  return active ? `https://app.roboflow.com/${active.workspace}/${active.project}` : null;
}
