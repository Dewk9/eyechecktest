/**
 * Maps the class names that a Roboflow model actually returns onto the
 * four disease keys EYE Check knows about. A disease is only "supported"
 * when the active model really contains a matching class — this is how the
 * app avoids showing results for diseases the model was never trained on.
 */

export const DISEASE_KEYS = ['pinguecula', 'cataract', 'glaucoma', 'pterygium'];
export const ALL_KEYS = [...DISEASE_KEYS, 'normal', 'other'];

// Long names may appear inside compound class names (e.g. "cataract_mature").
const DISEASE_ALIASES = {
  cataract: ['cataract', 'cataracts', 'ต้อกระจก'],
  pterygium: ['pterygium', 'pterygia', 'ต้อเนื้อ'],
  pinguecula: ['pinguecula', 'pingueculae', 'pinguecola', 'ต้อลม'],
  glaucoma: ['glaucoma', 'ต้อหิน'],
};
// "normal" must be an exact match ("abnormal" contains "normal").
const NORMAL_ALIASES = ['normal', 'healthy', 'no_disease', 'nodisease', 'normal_eye', 'healthy_eye', 'ปกติ'];

export function normalizeClassName(name) {
  return String(name ?? '')
    .toLowerCase()
    .trim()
    .replace(/[\s\-]+/g, '_');
}

export function mapClassToDisease(name) {
  const n = normalizeClassName(name);
  if (!n) return 'other';
  if (NORMAL_ALIASES.includes(n)) return 'normal';
  for (const [key, aliases] of Object.entries(DISEASE_ALIASES)) {
    if (aliases.some((a) => n === a || n.includes(a))) return key;
  }
  return 'other';
}

/**
 * @param {string[]} classNames classes reported by the Roboflow project/version
 */
export function buildModelCapabilities(classNames = []) {
  const classes = [...new Set(classNames.map(String))].map((name) => ({
    name,
    disease: mapClassToDisease(name),
  }));
  const supported = Object.fromEntries(
    DISEASE_KEYS.map((k) => [k, classes.some((c) => c.disease === k)]),
  );
  return {
    classes,
    supported,
    hasNormalClass: classes.some((c) => c.disease === 'normal'),
    unmappedClasses: classes.filter((c) => c.disease === 'other').map((c) => c.name),
  };
}
