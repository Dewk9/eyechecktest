# AI components

| Folder | What lives here | Used by |
|---|---|---|
| `image-quality/metrics.js` | grayscale conversion, luminance stats, Laplacian-variance blur, exposure, heuristic eye-position, `assessQuality()`, live `guidanceFromFrame()` | browser camera (live guidance) **and** backend (authoritative gate) — identical thresholds |
| `roboflow/class-map.js` | maps model class names → `cataract / pterygium / pinguecula / glaucoma / normal / other`; `buildModelCapabilities()` decides which diseases the active model *really* supports | backend |
| `roboflow/normalize.js` | converts classification / multi-label / detection responses into one shape and derives the outcome with the configured threshold — confidences are never modified | backend |
| `preprocessing/` | see README — preprocessing runs in the backend with `sharp` (EXIF rotation, metadata stripping, JPEG re-encode, downscale for metrics) | backend `services/image-quality.service.js` |
| `inference/` | see README — the inference pipeline is `backend/src/services/ai.service.js` + `backend/src/roboflow/` | backend |

## Pipeline
1. Browser: live quality guidance → capture/upload → client-side quality report (same metrics).
2. Backend `POST /screenings`: magic-byte format check → `sharp().rotate()` + JPEG re-encode (strips EXIF/GPS) → quality gate → private Storage upload.
3. Backend `POST /ai/analyze`: resolve active model (admin setting or `.env`), verify the version has a trained model and at least one supported disease class → Roboflow hosted inference (confidence floor 1 %, timeout) → normalise → apply threshold → store raw predictions.
4. Rule-based risk assessment (`rules-v1`) uses AI *categorical* outcome + history + vision tests; confidence values are never combined into a score.

## Model card template (fill in for each active version)
- Project / version / type (classification or detection)
- Classes and number of training/validation/test images per class
- Data source and consent basis
- Metrics on a held-out test set (precision, recall/sensitivity, specificity, mAP), per class
- Chosen confidence threshold and how it was selected → set it in Admin → ตั้งค่า and tick "validated"
- Known limitations (lighting, skin tone, device, glaucoma cannot be confirmed from external photos)
