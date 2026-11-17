/**
 * Converts the different Roboflow inference response shapes into one
 * structure and derives the screening finding. Confidence values are passed
 * through exactly as the model returned them — never invented or adjusted.
 *
 * Supported response shapes:
 *  - Single-label classification: { predictions: [{ class, confidence }], top, confidence }
 *  - Multi-label classification:  { predictions: { cls: { confidence } }, predicted_classes: [] }
 *  - Object detection / segmentation: { predictions: [{ x, y, width, height, class, confidence }], image }
 */
import { mapClassToDisease, DISEASE_KEYS } from './class-map.js';

const clamp01 = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.min(1, Math.max(0, n));
};

export function normalizePrediction(raw) {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Empty or invalid model response');
  }
  const out = {
    kind: 'unknown',
    classes: [], // [{ className, disease, confidence }]
    detections: [], // [{ className, disease, confidence, box }]
    image: raw.image && typeof raw.image === 'object'
      ? { width: Number(raw.image.width) || null, height: Number(raw.image.height) || null }
      : null,
    inferenceTime: raw.time ?? raw.inference_time ?? null,
  };

  const preds = raw.predictions;

  if (Array.isArray(preds) && preds.length > 0 && preds.some((p) => p && 'x' in p && 'width' in p)) {
    out.kind = 'detection';
    for (const p of preds) {
      const confidence = clamp01(p.confidence);
      if (confidence === null) continue;
      out.detections.push({
        className: String(p.class),
        disease: mapClassToDisease(p.class),
        confidence,
        box: {
          x: Number(p.x), y: Number(p.y), width: Number(p.width), height: Number(p.height),
          ...(Array.isArray(p.points) ? { points: p.points } : {}),
        },
      });
    }
    // per-class max confidence over boxes
    const byClass = new Map();
    for (const d of out.detections) {
      const prev = byClass.get(d.className);
      if (!prev || d.confidence > prev.confidence) byClass.set(d.className, d);
    }
    out.classes = [...byClass.values()].map(({ className, disease, confidence }) => ({ className, disease, confidence }));
  } else if (Array.isArray(preds)) {
    // single-label classification (or a detection response with zero boxes)
    const looksLikeDetection = preds.length === 0 && (raw.image || raw.inference_id) && !('top' in raw);
    out.kind = looksLikeDetection ? 'detection' : 'classification';
    for (const p of preds) {
      const confidence = clamp01(p.confidence);
      if (confidence === null) continue;
      out.classes.push({ className: String(p.class), disease: mapClassToDisease(p.class), confidence });
    }
  } else if (preds && typeof preds === 'object') {
    out.kind = 'multilabel';
    for (const [className, v] of Object.entries(preds)) {
      const confidence = clamp01(v?.confidence);
      if (confidence === null) continue;
      out.classes.push({ className, disease: mapClassToDisease(className), confidence });
    }
    // classes the model itself selected (kept for transparency; EYE Check applies its own threshold)
    out.predictedClasses = Array.isArray(raw.predicted_classes) ? raw.predicted_classes.map(String) : [];
  } else {
    throw new Error('Unrecognised model response format');
  }

  out.classes.sort((a, b) => b.confidence - a.confidence);
  return out;
}

/**
 * Derive per-disease status and the overall outcome.
 * @param {ReturnType<typeof normalizePrediction>} normalized
 * @param {{ supported: Record<string, boolean>, hasNormalClass: boolean }} capabilities
 * @param {number} threshold 0..1 — below this a result is "insufficient confidence"
 */
export function summarizeFindings(normalized, capabilities, threshold) {
  const t = clamp01(threshold) ?? 0.6;
  const best = (key) => {
    const list = normalized.classes.filter((c) => c.disease === key);
    return list.length ? list.reduce((a, b) => (b.confidence > a.confidence ? b : a)) : null;
  };

  const diseases = DISEASE_KEYS.map((key) => {
    const supported = Boolean(capabilities?.supported?.[key]);
    const top = best(key);
    let status;
    if (!supported) status = 'not_supported';
    else if (!top) status = 'not_detected';
    else if (top.confidence >= t) status = 'detected';
    else status = 'below_threshold';
    return {
      disease: key,
      supported,
      className: top?.className ?? null,
      confidence: supported && top ? top.confidence : null,
      status,
      // external photos can never confirm glaucoma
      requiresSpecialistConfirmation: key === 'glaucoma',
    };
  });

  const normal = best('normal');
  const detected = diseases.filter((d) => d.status === 'detected').sort((a, b) => b.confidence - a.confidence);
  const top = normalized.classes[0] ?? null;

  let outcome;
  let primary = null;
  if (normalized.kind === 'detection') {
    if (detected.length) { outcome = 'finding'; primary = detected[0].disease; }
    else if (normalized.classes.length === 0) { outcome = 'no_finding'; primary = 'no_finding'; }
    else { outcome = 'insufficient_confidence'; primary = 'inconclusive'; }
  } else if (normalized.kind === 'multilabel') {
    // multi-label: every class has an independent confidence — each supported disease ≥ threshold counts
    const normalHit = normal && normal.confidence >= t;
    if (detected.length) { outcome = 'finding'; primary = detected[0].disease; }
    else if (normalHit) { outcome = 'normal'; primary = 'normal'; }
    else { outcome = 'insufficient_confidence'; primary = 'inconclusive'; }
  } else {
    // classification: the top class decides
    if (!top || top.confidence < t) { outcome = 'insufficient_confidence'; primary = 'inconclusive'; }
    else if (DISEASE_KEYS.includes(top.disease) && capabilities?.supported?.[top.disease]) { outcome = 'finding'; primary = top.disease; }
    else if (top.disease === 'normal') { outcome = 'normal'; primary = 'normal'; }
    else { outcome = 'unrecognized'; primary = 'inconclusive'; }
  }

  return {
    threshold: t,
    kind: normalized.kind,
    outcome,
    primary,
    diseases,
    normal: normal ? { className: normal.className, confidence: normal.confidence } : null,
    otherClasses: normalized.classes.filter((c) => c.disease === 'other'),
    detections: normalized.detections,
    predictedClasses: normalized.predictedClasses ?? null,
  };
}

/**
 * Roboflow Workflow responses wrap model output: { outputs: [ { <block_name>: { predictions, prediction_type, … } } ] }.
 * Returns the first model-prediction object found (the block name differs per workflow)
 * plus the model id actually used, or throws if the workflow produced no prediction.
 */
export function extractWorkflowPrediction(response) {
  const outputs = response?.outputs;
  if (!Array.isArray(outputs) || outputs.length === 0) {
    throw new Error('Workflow response has no outputs');
  }
  const isPrediction = (o) => o && typeof o === 'object' && 'predictions' in o
    && (typeof o.predictions === 'object') && ('prediction_type' in o || 'image' in o || 'top' in o || 'predicted_classes' in o);
  const seen = new Set();
  const find = (node, depth = 0) => {
    if (!node || typeof node !== 'object' || depth > 6 || seen.has(node)) return null;
    seen.add(node);
    if (isPrediction(node)) return node;
    for (const v of Array.isArray(node) ? node : Object.values(node)) {
      const hit = find(v, depth + 1);
      if (hit) return hit;
    }
    return null;
  };
  const prediction = find(outputs[0]);
  if (!prediction) throw new Error('Workflow output contains no model prediction');
  const modelId = prediction.resolved_model?.model_id ?? outputs[0]?.model_id ?? prediction.model_id ?? null;
  return { prediction, modelId, predictionType: prediction.prediction_type ?? null };
}
