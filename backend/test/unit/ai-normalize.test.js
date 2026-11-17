import test from 'node:test';
import assert from 'node:assert/strict';
import { mapClassToDisease, buildModelCapabilities } from '../../../ai/roboflow/class-map.js';
import { normalizePrediction, summarizeFindings } from '../../../ai/roboflow/normalize.js';

test('class mapping handles aliases, compounds and "abnormal"', () => {
  assert.equal(mapClassToDisease('Cataract'), 'cataract');
  assert.equal(mapClassToDisease('mature-cataract'), 'cataract');
  assert.equal(mapClassToDisease('Pterygium'), 'pterygium');
  assert.equal(mapClassToDisease('pinguecula'), 'pinguecula');
  assert.equal(mapClassToDisease('Glaucoma'), 'glaucoma');
  assert.equal(mapClassToDisease('normal'), 'normal');
  assert.equal(mapClassToDisease('abnormal'), 'other');
  assert.equal(mapClassToDisease('conjunctivitis'), 'other');
});

test('capabilities only mark classes the model really has', () => {
  const cap = buildModelCapabilities(['cataract', 'normal', 'pterygium']);
  assert.deepEqual(cap.supported, { pinguecula: false, cataract: true, glaucoma: false, pterygium: true });
  assert.equal(cap.hasNormalClass, true);
});

test('single-label classification response', () => {
  const raw = { predictions: [{ class: 'cataract', confidence: 0.871 }, { class: 'normal', confidence: 0.1 }, { class: 'pterygium', confidence: 0.029 }], top: 'cataract', confidence: 0.871 };
  const n = normalizePrediction(raw);
  assert.equal(n.kind, 'classification');
  assert.equal(n.classes[0].confidence, 0.871); // passed through unchanged
  const cap = buildModelCapabilities(['cataract', 'normal', 'pterygium']);
  const s = summarizeFindings(n, cap, 0.6);
  assert.equal(s.outcome, 'finding');
  assert.equal(s.primary, 'cataract');
  assert.equal(s.diseases.find((d) => d.disease === 'glaucoma').status, 'not_supported');
  assert.equal(s.diseases.find((d) => d.disease === 'glaucoma').confidence, null);
});

test('classification below threshold is insufficient confidence', () => {
  const n = normalizePrediction({ predictions: [{ class: 'cataract', confidence: 0.45 }, { class: 'normal', confidence: 0.4 }], top: 'cataract' });
  const s = summarizeFindings(n, buildModelCapabilities(['cataract', 'normal']), 0.6);
  assert.equal(s.outcome, 'insufficient_confidence');
  assert.equal(s.primary, 'inconclusive');
});

test('multi-label classification response', () => {
  const n = normalizePrediction({ predictions: { cataract: { confidence: 0.2 }, pterygium: { confidence: 0.9 } }, predicted_classes: ['pterygium'] });
  assert.equal(n.kind, 'multilabel');
  assert.equal(n.classes[0].className, 'pterygium');
});

test('object detection: per-class max confidence, boxes kept', () => {
  const raw = { image: { width: 640, height: 480 }, predictions: [
    { x: 100, y: 100, width: 50, height: 40, class: 'pterygium', confidence: 0.7 },
    { x: 120, y: 110, width: 30, height: 20, class: 'pterygium', confidence: 0.82 },
    { x: 300, y: 200, width: 60, height: 60, class: 'pinguecula', confidence: 0.3 },
  ] };
  const n = normalizePrediction(raw);
  assert.equal(n.kind, 'detection');
  assert.equal(n.detections.length, 3);
  assert.equal(n.classes.find((c) => c.className === 'pterygium').confidence, 0.82);
  const s = summarizeFindings(n, buildModelCapabilities(['pterygium', 'pinguecula']), 0.6);
  assert.equal(s.primary, 'pterygium');
  assert.equal(s.diseases.find((d) => d.disease === 'pinguecula').status, 'below_threshold');
});

test('detection with zero boxes = no finding', () => {
  const n = normalizePrediction({ image: { width: 640, height: 480 }, predictions: [] });
  const s = summarizeFindings(n, buildModelCapabilities(['pterygium']), 0.6);
  assert.equal(s.outcome, 'no_finding');
});

test('invalid response throws', () => {
  assert.throws(() => normalizePrediction(null));
  assert.throws(() => normalizePrediction({ foo: 1 }));
});

// ---------------------------------------------------------------------
// Roboflow Workflow (DINOv3) — response shape recorded from the real
// serverless endpoint (terry-dcomet, version 4) on 2026-11-15.
// ---------------------------------------------------------------------
import { extractWorkflowPrediction } from '../../../ai/roboflow/normalize.js';

const realWorkflowResponse = {
  outputs: [{
    predictions: {
      inference_id: '41f89f0e-0826-4aa9-a965-5220b249304f', time: 0.012,
      resolved_model: { model_id: 'terry-dcomet/eye-disease-detection-mncvp-yegs3-4-vit_small_patch16_dinov3.lvd1689m-t1', backend: 'onnx' },
      image: { width: 224, height: 224 },
      predictions: {
        Pterygium: { confidence: 0.0021251440048217773, class_id: 0 },
        Unlabeled: { confidence: 0.0, class_id: 1 },
        cataract: { confidence: 0.9997174143791199, class_id: 2 },
        glaucoma: { confidence: 0.012024223804473877, class_id: 3 },
        normal: { confidence: 4.410743713378906e-6, class_id: 4 },
      },
      predicted_classes: ['cataract'],
      prediction_type: 'classification',
    },
    model_id: 'terry-dcomet/eye-disease-detection-mncvp-yegs3-4-vit_small_patch16_dinov3.lvd1689m-t1',
  }],
  profiler_trace: [],
};

test('workflow: extracts the model prediction and model id from outputs', () => {
  const { prediction, modelId, predictionType } = extractWorkflowPrediction(realWorkflowResponse);
  assert.equal(predictionType, 'classification');
  assert.match(modelId, /dinov3/);
  const n = normalizePrediction(prediction);
  assert.equal(n.kind, 'multilabel');
  assert.deepEqual(n.predictedClasses, ['cataract']);
  assert.equal(n.classes.find((c) => c.className === 'cataract').confidence, 0.9997174143791199); // unchanged
});

test('workflow: capabilities come from the real output classes (no pinguecula class → not supported)', () => {
  const { prediction } = extractWorkflowPrediction(realWorkflowResponse);
  const n = normalizePrediction(prediction);
  const cap = buildModelCapabilities(n.classes.map((c) => c.className));
  assert.deepEqual(cap.supported, { pinguecula: false, cataract: true, glaucoma: true, pterygium: true });
  const s = summarizeFindings(n, cap, 0.6);
  assert.equal(s.outcome, 'finding');
  assert.equal(s.primary, 'cataract');
  assert.equal(s.diseases.find((d) => d.disease === 'pinguecula').status, 'not_supported');
  assert.equal(s.otherClasses[0].className, 'Unlabeled');
});

test('multilabel: several diseases above threshold are all reported, highest first', () => {
  const n = normalizePrediction({ predictions: { cataract: { confidence: 0.7 }, glaucoma: { confidence: 0.9 }, normal: { confidence: 0.1 } }, predicted_classes: ['cataract', 'glaucoma'] });
  const s = summarizeFindings(n, buildModelCapabilities(['cataract', 'glaucoma', 'normal']), 0.6);
  assert.equal(s.primary, 'glaucoma');
  assert.deepEqual(s.diseases.filter((d) => d.status === 'detected').map((d) => d.disease).sort(), ['cataract', 'glaucoma']);
});

test('multilabel: nothing above threshold → insufficient confidence; normal above → normal', () => {
  const cap = buildModelCapabilities(['cataract', 'normal']);
  const low = summarizeFindings(normalizePrediction({ predictions: { cataract: { confidence: 0.4 }, normal: { confidence: 0.3 } } }), cap, 0.6);
  assert.equal(low.outcome, 'insufficient_confidence');
  const norm = summarizeFindings(normalizePrediction({ predictions: { cataract: { confidence: 0.1 }, normal: { confidence: 0.95 } } }), cap, 0.6);
  assert.equal(norm.outcome, 'normal');
});

test('workflow: empty / prediction-less outputs throw (never produce a result)', () => {
  assert.throws(() => extractWorkflowPrediction({ outputs: [] }));
  assert.throws(() => extractWorkflowPrediction({ outputs: [{ some_block: { value: 1 } }] }));
  assert.throws(() => extractWorkflowPrediction({}));
});
