# Preprocessing

Image preprocessing needs native image decoding, so it runs in the backend with `sharp`
(`backend/src/services/image-quality.service.js`):

1. Decode and verify the real format from file bytes (JPEG / PNG / WEBP only, ≤ 50 MP).
2. `rotate()` — apply EXIF orientation.
3. Re-encode to JPEG (quality 92) — removes all EXIF/GPS/device metadata before storage.
4. For quality metrics only: downscale to max 512 px, grayscale, raw buffer → `ai/image-quality/metrics.js`.

The image sent to Roboflow is the normalised JPEG; Roboflow applies the preprocessing
configured in the dataset version (e.g. resize) on its side.
