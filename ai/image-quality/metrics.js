/**
 * Image-quality metrics shared by the browser (live camera guidance) and the
 * backend (authoritative check before an image is sent to the model).
 * Works on an 8-bit grayscale buffer. Pure JS, no dependencies.
 */

export const QUALITY_THRESHOLDS = Object.freeze({
  minShortSide: 480, // px — original image
  analysisMaxSide: 512, // px — images are downscaled to this before metrics
  brightnessMin: 55, // mean luminance 0..255
  brightnessMax: 205,
  overexposedMaxRatio: 0.2, // share of pixels >= 250
  underexposedMaxRatio: 0.35, // share of pixels <= 10
  blurMinVariance: 45, // variance of Laplacian on the downscaled image
  contrastMinStd: 18, // std-dev of luminance
});

/** RGBA (canvas) or RGB/1-channel buffer → grayscale Uint8Array */
export function toGrayscale(data, width, height, channels = 4) {
  const gray = new Uint8Array(width * height);
  if (channels === 1) {
    gray.set(data.subarray ? data.subarray(0, width * height) : data.slice(0, width * height));
    return gray;
  }
  for (let i = 0, j = 0; j < gray.length; i += channels, j++) {
    gray[j] = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
  }
  return gray;
}

export function luminanceStats(gray) {
  let sum = 0;
  let sumSq = 0;
  let over = 0;
  let under = 0;
  for (let i = 0; i < gray.length; i++) {
    const v = gray[i];
    sum += v;
    sumSq += v * v;
    if (v >= 250) over++;
    if (v <= 10) under++;
  }
  const n = gray.length || 1;
  const mean = sum / n;
  const variance = Math.max(0, sumSq / n - mean * mean);
  return { mean, std: Math.sqrt(variance), overRatio: over / n, underRatio: under / n };
}

/** Variance of the 4-neighbour Laplacian — a standard sharpness/blur measure */
export function laplacianVariance(gray, width, height) {
  if (width < 3 || height < 3) return 0;
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = 1; y < height - 1; y++) {
    const row = y * width;
    for (let x = 1; x < width - 1; x++) {
      const i = row + x;
      const lap = gray[i - width] + gray[i + width] + gray[i - 1] + gray[i + 1] - 4 * gray[i];
      sum += lap;
      sumSq += lap * lap;
      n++;
    }
  }
  const mean = sum / n;
  return sumSq / n - mean * mean;
}

/**
 * Heuristic eye-position estimate: inside the central region we look for the
 * darkest compact blob (pupil / iris). This is NOT an eye detector — it only
 * gives framing guidance and is reported as a warning, never as a diagnosis.
 * @returns {{found:boolean, offsetX:number, offsetY:number, sizeRatio:number}}
 */
export function estimateEyePosition(gray, width, height) {
  const x0 = Math.floor(width * 0.15);
  const x1 = Math.floor(width * 0.85);
  const y0 = Math.floor(height * 0.15);
  const y1 = Math.floor(height * 0.85);
  // histogram of the ROI to find the darkest 6 %
  const hist = new Uint32Array(256);
  let total = 0;
  for (let y = y0; y < y1; y += 2) {
    for (let x = x0; x < x1; x += 2) { hist[gray[y * width + x]]++; total++; }
  }
  let acc = 0;
  let thr = 0;
  for (; thr < 256; thr++) { acc += hist[thr]; if (acc >= total * 0.06) break; }
  thr = Math.min(thr + 8, 120);

  let cx = 0;
  let cy = 0;
  let count = 0;
  let minX = width;
  let maxX = 0;
  let minY = height;
  let maxY = 0;
  for (let y = y0; y < y1; y += 2) {
    for (let x = x0; x < x1; x += 2) {
      if (gray[y * width + x] <= thr) {
        cx += x; cy += y; count++;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }
  if (count < 20) return { found: false, offsetX: 0, offsetY: 0, sizeRatio: 0 };
  cx /= count;
  cy /= count;
  const blobW = maxX - minX;
  const blobH = maxY - minY;
  // a scattered dark area (e.g. shadows everywhere) is not a compact blob
  const compactness = count / Math.max(1, ((blobW / 2) * (blobH / 2)));
  return {
    found: compactness > 0.25,
    offsetX: (cx - width / 2) / width, // -0.5..0.5
    offsetY: (cy - height / 2) / height,
    sizeRatio: Math.max(blobW / width, blobH / height),
  };
}

/**
 * Full assessment. `originalWidth/originalHeight` are the dimensions of the
 * full-size image; `gray` is the downscaled analysis buffer.
 */
export function assessQuality({ gray, width, height, originalWidth, originalHeight }, t = QUALITY_THRESHOLDS) {
  const stats = luminanceStats(gray);
  const blur = laplacianVariance(gray, width, height);
  const eye = estimateEyePosition(gray, width, height);
  const shortSide = Math.min(originalWidth ?? width, originalHeight ?? height);

  const checks = [
    {
      key: 'resolution', label: 'ความละเอียดของภาพ', severity: 'error',
      passed: shortSide >= t.minShortSide,
      value: `${originalWidth ?? width}×${originalHeight ?? height}`,
      message: shortSide >= t.minShortSide ? 'ความละเอียดเพียงพอ' : `ความละเอียดต่ำเกินไป (ด้านสั้นต้องไม่น้อยกว่า ${t.minShortSide}px)`,
    },
    {
      key: 'brightness', label: 'ความสว่าง', severity: 'error',
      passed: stats.mean >= t.brightnessMin && stats.mean <= t.brightnessMax,
      value: Math.round(stats.mean),
      message: stats.mean < t.brightnessMin ? 'ภาพมืดเกินไป กรุณาเปิดไฟหรือเพิ่มแสงสว่าง'
        : stats.mean > t.brightnessMax ? 'ภาพสว่างเกินไป กรุณาลดแสงหรือหลีกเลี่ยงแสงจ้า' : 'ความสว่างเหมาะสม',
    },
    {
      key: 'exposure', label: 'การรับแสง (Exposure)', severity: 'error',
      passed: stats.overRatio <= t.overexposedMaxRatio && stats.underRatio <= t.underexposedMaxRatio,
      value: `${Math.round(stats.overRatio * 100)}% สว่างจัด / ${Math.round(stats.underRatio * 100)}% มืดจัด`,
      message: stats.overRatio > t.overexposedMaxRatio ? 'มีบริเวณสว่างจ้าเกินไป (แสงสะท้อน/แฟลช)'
        : stats.underRatio > t.underexposedMaxRatio ? 'มีบริเวณมืดเกินไป' : 'การรับแสงเหมาะสม',
    },
    {
      key: 'sharpness', label: 'ความคมชัด (Blur)', severity: 'error',
      passed: blur >= t.blurMinVariance,
      value: Math.round(blur),
      message: blur >= t.blurMinVariance ? 'ภาพคมชัด' : 'ภาพยังไม่ชัด กรุณาถือกล้องให้นิ่งแล้วถ่ายใหม่',
    },
    {
      key: 'contrast', label: 'ความแตกต่างของแสง', severity: 'error',
      passed: stats.std >= t.contrastMinStd,
      value: Math.round(stats.std),
      message: stats.std >= t.contrastMinStd ? 'รายละเอียดภาพเพียงพอ' : 'ภาพมีรายละเอียดน้อยเกินไป',
    },
    {
      key: 'eye_position', label: 'ตำแหน่งดวงตา (ประมาณการ)', severity: 'warning',
      passed: eye.found && Math.abs(eye.offsetX) < 0.18 && Math.abs(eye.offsetY) < 0.18,
      value: eye.found ? `เยื้อง ${Math.round(eye.offsetX * 100)}%, ${Math.round(eye.offsetY * 100)}%` : 'ไม่พบ',
      message: !eye.found ? 'ไม่พบบริเวณตาดำในกรอบ กรุณาจัดดวงตาให้อยู่กลางกรอบ'
        : (Math.abs(eye.offsetX) >= 0.18 || Math.abs(eye.offsetY) >= 0.18) ? 'ดวงตาไม่อยู่กลางภาพ' : 'ดวงตาอยู่ในตำแหน่งเหมาะสม',
    },
  ];

  const errors = checks.filter((c) => c.severity === 'error' && !c.passed);
  const warnings = checks.filter((c) => c.severity === 'warning' && !c.passed);
  return {
    passed: errors.length === 0,
    usable: errors.length === 0,
    checks,
    metrics: {
      brightness: stats.mean, contrast: stats.std, overexposed: stats.overRatio,
      underexposed: stats.underRatio, blurVariance: blur, eye,
    },
    errors: errors.map((e) => e.message),
    warnings: warnings.map((w) => w.message),
  };
}

/**
 * Live guidance message for the camera overlay (Thai), based on a quick frame.
 */
export function guidanceFromFrame(result) {
  const m = result.metrics;
  if (m.brightness < QUALITY_THRESHOLDS.brightnessMin) return { code: 'too_dark', text: 'กรุณาเปิดไฟหรือเพิ่มแสงสว่าง' };
  if (m.brightness > QUALITY_THRESHOLDS.brightnessMax || m.overexposed > QUALITY_THRESHOLDS.overexposedMaxRatio) return { code: 'too_bright', text: 'แสงจ้าเกินไป กรุณาลดแสงหรือเปลี่ยนมุม' };
  if (!m.eye.found) return { code: 'no_eye', text: 'กรุณามองตรงมาที่กล้อง และให้ดวงตาอยู่กลางกรอบ' };
  if (m.eye.sizeRatio < 0.12) return { code: 'too_far', text: 'ขยับเข้าใกล้อีกนิด' };
  if (m.eye.sizeRatio > 0.55) return { code: 'too_close', text: 'ถอยกล้องออกเล็กน้อย' };
  if (Math.abs(m.eye.offsetX) >= 0.18 || Math.abs(m.eye.offsetY) >= 0.18) return { code: 'off_center', text: 'กรุณาจัดดวงตาให้อยู่กลางกรอบ' };
  if (m.blurVariance < QUALITY_THRESHOLDS.blurMinVariance) return { code: 'blurry', text: 'ภาพยังไม่ชัด กรุณาถือกล้องให้นิ่ง' };
  return { code: 'ready', text: 'สามารถถ่ายภาพได้แล้ว' };
}
