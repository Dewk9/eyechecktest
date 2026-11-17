import { getServiceClient } from '../config/supabase.js';
import { AppError, unwrap } from '../utils/app-error.js';
import { logger } from '../utils/logger.js';
import { roboflow, RoboflowError, runWorkflow, WORKFLOW_STATUS } from '../roboflow/client.js';
import { getActiveModel } from '../roboflow/roboflow.service.js';
import { normalizePrediction, summarizeFindings, extractWorkflowPrediction } from '../../../ai/roboflow/normalize.js';
import { getConfidenceThreshold } from './settings.service.js';
import { downloadScreeningImage } from './storage.service.js';
import { loadOwned, buildResult } from './screening.service.js';
import { summarizeMedicalHistory, summarizeVisionTest } from './assessment/summaries.js';
import { assessRisk } from './assessment/risk-engine.js';
import { logActivity } from './activity.service.js';
import { calcAge } from '../utils/helpers.js';

/**
 * Run the real Roboflow model on a screening image, then build the separate
 * rule-based risk assessment. Nothing is faked: if the model is not reachable
 * the screening is marked "not_connected"/"failed" and no AI result is shown.
 */
export async function analyzeScreening(auth, screeningId) {
  const s = await loadOwned(auth, screeningId);
  if (s.image_quality_status !== 'passed') throw new AppError(422, 'INVALID_IMAGE', 'ภาพนี้ไม่ผ่านการตรวจสอบคุณภาพ');
  const stale = Date.now() - new Date(s.updated_at).getTime() > 5 * 60 * 1000;
  if (s.ai_status === 'processing' && !stale) throw new AppError(409, 'AI_IN_PROGRESS', 'กำลังวิเคราะห์ภาพนี้อยู่ กรุณารอสักครู่');
  if (['completed', 'insufficient_confidence'].includes(s.ai_status)) {
    return buildResult(auth.db, s, { viewerProfile: auth.profile }); // idempotent
  }

  const svc = getServiceClient();
  unwrap(await svc.from('screenings').update({ ai_status: 'processing', ai_error: null }).eq('id', s.id));
  try {
    return await runAnalysis(auth, s, svc);
  } catch (err) {
    // never leave a screening stuck in "processing"
    await svc.from('screenings').update({ ai_status: 'failed', ai_error: 'การวิเคราะห์ไม่สำเร็จ กรุณาลองใหม่' }).eq('id', s.id);
    throw err;
  }
}

async function runAnalysis(auth, s, svc) {

  // ---- context for the separate history/vision assessment
  const [historyRow, visionRow, patientRow] = await Promise.all([
    s.medical_history_id ? auth.db.from('medical_histories').select('*').eq('id', s.medical_history_id).maybeSingle().then(unwrap) : null,
    s.vision_test_id ? auth.db.from('vision_tests').select('*').eq('id', s.vision_test_id).maybeSingle().then(unwrap) : null,
    s.patient_id ? auth.db.from('patients').select('birth_date').eq('id', s.patient_id).maybeSingle().then(unwrap) : null,
  ]);
  const subjectAge = patientRow ? calcAge(patientRow.birth_date) : auth.profile.age;
  const history = summarizeMedicalHistory(historyRow, subjectAge);
  const vision = summarizeVisionTest(visionRow);

  // ---- AI inference
  let aiStatus;
  let aiError = null;
  let aiSummary;
  let model = null;
  let normalized = null;
  const threshold = await getConfidenceThreshold();

  let errorCode = null;
  try {
    model = await getActiveModel();
    if (!model.versionFound) throw new RoboflowError(503, 'AI_NOT_CONFIGURED', `ไม่พบเวอร์ชัน ${model.version} ในโปรเจกต์ ${model.project}`);
    if (!model.hasTrainedModel) {
      throw new RoboflowError(503, 'AI_NOT_CONFIGURED', `Roboflow REST API ไม่รายงานโมเดลของเวอร์ชัน ${model.version} — หากเป็นโมเดลแบบ Workflow (เช่น DINOv3) ให้ตั้งค่า ROBOFLOW_WORKFLOW_URL`);
    }
    if (!Object.values(model.capabilities.supported).some(Boolean)) {
      throw new RoboflowError(503, 'AI_NOT_CONFIGURED', 'โมเดลที่ใช้งานไม่มีคลาสโรคต้อที่ระบบรองรับ');
    }

    const image = await downloadScreeningImage(s.image_path);
    let raw;
    if (model.mode === 'workflow') {
      // Real Workflow call with this screening's image (base64, as the Cloud API expects)
      const { body } = await runWorkflow({ imageBase64: image.toString('base64'), requestId: s.id });
      let extracted;
      try { extracted = extractWorkflowPrediction(body); } catch (e) {
        throw new RoboflowError(502, WORKFLOW_STATUS.INFERENCE_FAILED, `Workflow ไม่ได้ส่งผลการทำนายของโมเดลกลับมา (${e.message})`);
      }
      raw = extracted.prediction;
      if (extracted.modelId) model = { ...model, modelId: extracted.modelId };
    } else {
      raw = await roboflow.infer({
        projectType: model.projectType,
        project: model.project,
        version: model.version,
        imageBase64: image.toString('base64'),
      });
    }
    normalized = normalizePrediction(raw);
    const findings = summarizeFindings(normalized, model.capabilities, threshold.value);
    aiStatus = ['insufficient_confidence', 'unrecognized'].includes(findings.outcome) ? 'insufficient_confidence' : 'completed';
    aiSummary = {
      status: aiStatus,
      ...findings,
      threshold_validated: threshold.validated,
      image: normalized.image, // dimensions the boxes refer to
      model: {
        mode: model.mode, workspace: model.workspace, project: model.project, name: model.projectName, type: model.projectType,
        version: model.version, model_id: model.modelId ?? null, workflow: model.workflow ?? null, classes: model.capabilities.classes,
      },
      analyzed_at: new Date().toISOString(),
    };
  } catch (err) {
    if (err instanceof RoboflowError) {
      // configuration / auth / missing workflow → "not connected"; timeouts & inference errors → "failed"
      const notConnected = ['AI_NOT_CONNECTED', 'AI_NOT_CONFIGURED', 'AI_AUTH_FAILED', 'AI_NOT_FOUND',
        WORKFLOW_STATUS.CONFIG_MISSING, WORKFLOW_STATUS.API_KEY_INVALID, WORKFLOW_STATUS.WORKFLOW_NOT_FOUND];
      aiStatus = notConnected.includes(err.code) ? 'not_connected' : 'failed';
      aiError = err.message;
      errorCode = err.code;
      logger.warn('AI analysis unavailable', { screening: s.id, code: err.code, upstream: err.upstreamStatus });
    } else if (err instanceof AppError) {
      aiStatus = 'failed';
      aiError = err.message;
    } else {
      aiStatus = 'failed';
      aiError = 'ไม่สามารถประมวลผลผลลัพธ์จากโมเดลได้';
      logger.error('AI analysis error', { screening: s.id, error: err });
    }
    aiSummary = { status: aiStatus, error: aiError, error_code: errorCode ?? 'INFERENCE_FAILED', outcome: null, primary: null, diseases: [], analyzed_at: new Date().toISOString(),
      model: model ? { mode: model.mode, project: model.project, version: model.version, workflow: model.workflow ?? null } : null };
  }

  // ---- persist raw predictions exactly as returned (one row per class / per box)
  if (normalized && model) {
    const rows = normalized.kind === 'detection'
      ? normalized.detections.map((d) => ({ predicted_class: d.className, disease_key: d.disease, confidence_score: d.confidence, bounding_box: d.box, prediction_data: { kind: 'detection' } }))
      : normalized.classes.map((c) => ({ predicted_class: c.className, disease_key: c.disease, confidence_score: c.confidence, bounding_box: null, prediction_data: { kind: normalized.kind } }));
    if (rows.length) {
      unwrap(await svc.from('ai_predictions').delete().eq('screening_id', s.id));
      const modelVersion = model.modelId ?? `${model.project}/${model.version}`; // the model id Roboflow reports it actually ran
      unwrap(await svc.from('ai_predictions').insert(rows.map((r) => ({
        ...r,
        screening_id: s.id,
        model_version: modelVersion,
        prediction_data: { ...r.prediction_data, ...(normalized.predictedClasses ? { model_predicted_classes: normalized.predictedClasses } : {}) },
      }))));
    }
  }

  // ---- separate, rule-based risk assessment (AI confidence is NOT mixed in)
  const risk = assessRisk({ history, vision, ai: { status: aiStatus, summary: aiSummary } });
  unwrap(await svc.from('risk_assessments').upsert({
    screening_id: s.id,
    medical_history_summary: history,
    vision_test_summary: vision,
    ai_summary: aiSummary,
    risk_level: risk.risk_level,
    risk_factors: risk.risk_factors,
    recommendation: { ...risk.recommendation, rule: risk.rule, consistency: risk.consistency, validated: risk.validated, ai_findings: risk.ai_findings },
    assessment_version: risk.assessment_version,
  }, { onConflict: 'screening_id' }));

  const primary = aiStatus === 'completed' ? aiSummary.primary : 'inconclusive';
  const updated = unwrap(await svc.from('screenings').update({
    ai_status: aiStatus,
    ai_error: aiError,
    model_project: model?.project ?? null,
    model_version: model?.version ?? null,
    primary_finding: primary,
    risk_level: risk.risk_level,
  }).eq('id', s.id).select('*').single());

  // AI suggestion is stored separately — an admin must still review/assign the class
  if (s.dataset_consent && aiStatus === 'completed' && aiSummary.primary && !['no_finding', 'inconclusive'].includes(aiSummary.primary)) {
    await svc.from('dataset_images').update({ suggested_class: aiSummary.primary }).eq('screening_id', s.id).eq('review_status', 'pending');
  }

  await logActivity(auth.userId, 'screening_analyzed', { screening_id: s.id, ai_status: aiStatus, risk_level: risk.risk_level });
  return buildResult(auth.db, updated, { viewerProfile: auth.profile });
}
