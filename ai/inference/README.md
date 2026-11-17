# Inference

Inference is performed by the backend only (the Roboflow API key never reaches the browser):

- `backend/src/roboflow/client.js` — HTTP client (hosted inference `detect / classify / outline.roboflow.com`, dataset upload, search, versions, generate, train), timeouts and error mapping.
- `backend/src/roboflow/roboflow.service.js` — resolves the active model and its real class list/capabilities.
- `backend/src/services/ai.service.js` — the analysis pipeline (status handling, storing raw predictions, risk assessment).
- `ai/roboflow/normalize.js` — response normalisation and threshold logic (unit-tested in `backend/test/unit/ai-normalize.test.js`).

Outcomes: `finding`, `normal`, `no_finding` (detection with no boxes), `insufficient_confidence`, `unrecognized`.
Screening `ai_status`: `completed`, `insufficient_confidence`, `not_connected`, `failed`.
