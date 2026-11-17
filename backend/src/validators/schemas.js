import { z } from 'zod';
import { REGISTRATION_CODE_RE } from '../utils/helpers.js';

const today = () => new Date().toISOString().slice(0, 10);

export const isoDate = z
  .string({ required_error: 'กรุณาระบุวันที่' })
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'รูปแบบวันที่ต้องเป็น YYYY-MM-DD')
  .refine((s) => !Number.isNaN(new Date(`${s}T00:00:00Z`).getTime()), 'วันที่ไม่ถูกต้อง');

export const birthDate = isoDate
  .refine((s) => s <= today(), 'วันเกิดต้องไม่เป็นวันในอนาคต')
  .refine((s) => s > '1900-01-01', 'วันเกิดไม่ถูกต้อง');

export const uuid = z.string().uuid('รหัสอ้างอิงไม่ถูกต้อง');
export const gender = z.enum(['male', 'female', 'other', 'unspecified'], { errorMap: () => ({ message: 'กรุณาเลือกเพศ' }) });
export const fullName = z.string().trim().min(2, 'ชื่อ-นามสกุลต้องมีอย่างน้อย 2 ตัวอักษร').max(150, 'ชื่อ-นามสกุลยาวเกินไป');
export const username = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9_.]{3,30}$/, 'ชื่อบัญชีต้องเป็น a-z, 0-9, _ หรือ . ความยาว 3–30 ตัว');
export const password = z
  .string()
  .min(8, 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร')
  .max(72, 'รหัสผ่านยาวเกินไป')
  .regex(/[A-Za-z]/, 'รหัสผ่านต้องมีตัวอักษรภาษาอังกฤษ')
  .regex(/[0-9]/, 'รหัสผ่านต้องมีตัวเลข');

const boolish = z.union([z.boolean(), z.enum(['true', 'false', '1', '0', 'on'])]).transform((v) => v === true || v === 'true' || v === '1' || v === 'on');

// ---------------- auth ----------------
const registerBase = {
  full_name: fullName,
  username,
  password,
  confirm_password: z.string(),
  accept_terms: z.literal(true, { errorMap: () => ({ message: 'กรุณายอมรับข้อกำหนดและนโยบายความเป็นส่วนตัว' }) }),
};
export const registerSchema = z
  .discriminatedUnion('account_type', [
    z.object({ account_type: z.literal('personal'), ...registerBase, birth_date: birthDate, gender }),
    z.object({
      account_type: z.literal('staff'),
      ...registerBase,
      position: z.string().trim().min(2, 'กรุณาระบุตำแหน่ง').max(120),
      workplace: z.string().trim().min(2, 'กรุณาระบุสถานที่ทำงาน').max(200),
      registration_code: z.string().trim().min(6, 'กรุณากรอกโค้ดสมัครบัญชีเจ้าหน้าที่').max(64),
    }),
  ], { errorMap: () => ({ message: 'กรุณาเลือกประเภทบัญชี' }) })
  .refine((d) => d.password === d.confirm_password, { message: 'รหัสผ่านทั้งสองช่องไม่ตรงกัน', path: ['confirm_password'] });

export const loginSchema = z.object({
  username,
  password: z.string().min(1, 'กรุณากรอกรหัสผ่าน').max(72),
  remember: z.boolean().optional().default(false),
});

export const changePasswordSchema = z
  .object({ current_password: z.string().min(1, 'กรุณากรอกรหัสผ่านปัจจุบัน'), new_password: password, confirm_password: z.string() })
  .refine((d) => d.new_password === d.confirm_password, { message: 'รหัสผ่านใหม่ทั้งสองช่องไม่ตรงกัน', path: ['confirm_password'] });

export const updateProfileSchema = z
  .object({
    full_name: fullName.optional(),
    birth_date: birthDate.optional(),
    gender: gender.optional(),
    position: z.string().trim().min(2).max(120).optional(),
    workplace: z.string().trim().min(2).max(200).optional(),
  })
  .refine((d) => Object.keys(d).length > 0, 'ไม่มีข้อมูลที่ต้องการแก้ไข');

export const deleteAccountSchema = z.object({
  password: z.string().min(1, 'กรุณากรอกรหัสผ่านเพื่อยืนยัน'),
  confirm: z.literal('DELETE', { errorMap: () => ({ message: 'กรุณาพิมพ์ DELETE เพื่อยืนยัน' }) }),
});

// ---------------- patients ----------------
export const patientSchema = z
  .object({
    full_name: fullName,
    birth_date: birthDate,
    age: z.coerce.number().int('อายุต้องเป็นจำนวนเต็ม').min(0, 'อายุไม่ถูกต้อง').max(130, 'อายุไม่ถูกต้อง'),
    gender,
    notes: z.string().trim().max(1000).optional().nullable(),
  });

export const listQuery = z.object({
  search: z.string().max(100).optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
});

// ---------------- medical history ----------------
export const SYMPTOM_KEYS = ['blurry_cloudy', 'glare_halos', 'peripheral_loss', 'irritation', 'tissue_growth'];
export const medicalHistorySchema = z.object({
  patient_id: uuid.optional().nullable(),
  age_group: z.enum(['under_40', '40_59', '60_plus'], { errorMap: () => ({ message: 'กรุณาเลือกช่วงอายุ' }) }),
  family_glaucoma_history: z.boolean().default(false),
  diabetes: z.boolean().default(false),
  hypertension: z.boolean().default(false),
  steroid_use: z.boolean().default(false),
  outdoor_exposure: z.boolean().default(false),
  high_myopia: z.boolean().default(false),
  eye_injury: z.boolean().default(false),
  eye_symptoms: z.array(z.enum(SYMPTOM_KEYS)).max(5).default([]).transform((a) => [...new Set(a)]),
  emergency_symptoms: z.boolean().default(false),
});

// ---------------- vision tests ----------------
const testStatus = z.enum(['completed', 'skipped', 'not_tested']);
const num = (min, max) => z.number().min(min).max(max).nullable().optional();
const eyeEntry = (shape) => z.object({ status: testStatus, ...shape }).strict();
const perEye = (shape, extra = {}) => z.object({ right: eyeEntry(shape), left: eyeEntry(shape), ...extra }).strict().nullable().optional();

// Calibration used for a size-dependent test: physical screen calibration and viewing
// distance are stored separately, plus the optotype sizes that were drawn.
const visionCalibration = z.object({
  screen: z.object({
    status: z.enum(['calibrated', 'standard']),
    method: z.enum(['card', 'ruler']).nullable(),
    reference_mm: num(1, 1000),
    verified: z.boolean().nullable().optional(),
    px_per_mm: num(0.5, 50),
    dpr: num(0.25, 10),
    screen_w: num(1, 20000),
    screen_h: num(1, 20000),
    viewport_w: num(1, 20000),
    viewport_h: num(1, 20000),
    calibrated_at: z.string().datetime().nullable().optional(),
  }).strict(),
  distance: z.object({
    source: z.enum(['camera', 'manual']),
    distance_cm: num(10, 600),
    target_cm: num(10, 600),
    anchor_cm: num(10, 300),
    sd_cm: num(0, 200),
    anchor_method: z.enum(['tape', 'blind_spot']).nullable().optional(),
    user_confirmed: z.boolean().optional(),
    monitor: z.object({
      samples: num(0, 100000),
      valid: num(0, 100000),
      max_dev_pct: num(0, 1000),
      warnings: num(0, 10000),
      out_of_range_s: num(0, 100000),
      error: z.string().max(40).optional(),
    }).strict().nullable().optional(),
  }).strict(),
  optotypes: z.array(z.object({
    logmar: num(-0.3, 1.5),
    snellen: z.string().max(12),
    height_mm: num(0, 1000),
    height_px: num(0, 10000),
  }).strict()).max(30).optional(),
}).strict();
const distanceSource = z.enum(['camera', 'manual']).optional();

export const visionTestSchema = z.object({
  patient_id: uuid.optional().nullable(),
  visual_acuity: perEye(
    { logmar: num(-0.3, 1.5), snellen: z.string().max(12).nullable().optional(), trials: num(0, 200) },
    { distance_cm: num(30, 600), calibrated: z.boolean().optional(), px_per_mm: num(0.5, 50), position_checked: z.boolean().optional(), distance_source: distanceSource, calibration: visionCalibration.optional() },
  ),
  color_vision: perEye({ correct: num(0, 50), total: num(0, 50), control_passed: z.boolean().nullable().optional() }),
  central_visual_field: perEye({
    sees_center: z.boolean().nullable().optional(),
    lines_straight: z.boolean().nullable().optional(),
    missing_areas: z.boolean().nullable().optional(),
    marked_cells: z.array(z.number().int().min(0).max(399)).max(400).optional(),
  }),
  visual_field: perEye({
    quadrants: z.record(z.enum(['upper_left', 'upper_right', 'lower_left', 'lower_right']), z.object({ shown: z.number().int().min(0).max(50), seen: z.number().int().min(0).max(50) })).optional(),
    catch_trials: num(0, 50),
    false_positives: num(0, 50),
  }),
  near_vision: perEye({ logmar: num(-0.3, 1.5), smallest_size_mm: num(0, 100) }, { distance_cm: num(20, 100), calibrated: z.boolean().optional(), position_checked: z.boolean().optional(), distance_source: distanceSource, calibration: visionCalibration.optional() }),
  contrast_sensitivity: perEye({ logcs: num(0, 2.5) }),
});

// ---------------- screenings ----------------
export const createScreeningSchema = z.object({
  eye_side: z.enum(['left', 'right'], { errorMap: () => ({ message: 'กรุณาเลือกตาข้างที่ตรวจ' }) }),
  patient_id: uuid.optional().nullable().or(z.literal('').transform(() => null)),
  medical_history_id: uuid,
  vision_test_id: uuid.optional().nullable().or(z.literal('').transform(() => null)),
  dataset_consent: boolish.default(false),
  consent_version: z.string().max(20).optional(),
});

export const screeningListQuery = listQuery.extend({
  from: isoDate.optional(),
  to: isoDate.optional(),
  disease: z.enum(['cataract', 'pterygium', 'pinguecula', 'glaucoma', 'normal', 'no_finding', 'inconclusive']).optional(),
  risk: z.enum(['low', 'moderate', 'high', 'urgent', 'inconclusive']).optional(),
  patient_id: uuid.optional(),
  saved: z.enum(['all', 'saved', 'draft']).optional().default('all'),
  sort: z.enum(['screening_date', 'screening_code', 'risk_level', 'primary_finding']).optional().default('screening_date'),
  order: z.enum(['asc', 'desc']).optional().default('desc'),
});

export const analyzeSchema = z.object({ screening_id: uuid });

// ---------------- dashboards ----------------
export const dashboardQuery = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  disease: z.enum(['cataract', 'pterygium', 'pinguecula', 'glaucoma']).optional(),
  count_by: z.enum(['screening', 'person']).optional().default('screening'),
});

// ---------------- activity ----------------
export const trackSchema = z.object({
  event: z.enum(['page_view', 'page_leave']),
  path: z.string().max(200).regex(/^\/[\w\-./]*$/, 'invalid path'),
});

// ---------------- admin ----------------
export const adminUsersQuery = listQuery.extend({
  account_type: z.enum(['personal', 'staff']).optional(),
  role: z.enum(['user', 'admin']).optional(),
  status: z.enum(['active', 'suspended']).optional(),
});
export const userStatusSchema = z.object({ status: z.enum(['active', 'suspended']), reason: z.string().max(300).optional() });
export const userRoleSchema = z.object({ role: z.enum(['user', 'admin']) });
export const activityQuery = listQuery.extend({ from: isoDate.optional(), to: isoDate.optional(), action: z.string().max(60).optional() });
export const statsQuery = z.object({ from: isoDate.optional(), to: isoDate.optional() });

// Expiry: "YYYY-MM-DD" (old clients → 23:59:59 Asia/Bangkok that day) or an exact ISO date-time
// with an explicit offset, e.g. "2026-11-30T23:59:00+07:00". "Not in the past" is checked in the
// service with the server clock (never trust the browser clock).
const expiryDateTime = z.string().trim()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/, 'รูปแบบวันเวลาหมดอายุไม่ถูกต้อง')
  .refine((s) => !Number.isNaN(new Date(s).getTime()), 'วันเวลาหมดอายุไม่ถูกต้อง');
const expiresAt = z.union([isoDate, expiryDateTime]);
// presets are computed on the server from the server clock
const expiresInDays = z.union([z.literal(1), z.literal(7), z.literal(30), z.literal(90)]);
const oneExpiryField = (v) => !(v.expires_at !== undefined && v.expires_in_days !== undefined);
const oneExpiryMsg = { message: 'ระบุวันหมดอายุได้เพียงแบบเดียว (expires_at หรือ expires_in_days)' };

export const regCodeListQuery = z.object({ q: z.string().trim().max(80).optional() });
export const regCodeSchema = z.object({
  label: z.string().trim().max(120).optional(),
  // optional: the code previewed in the create dialog (system generated); omitted → generated now
  code: z.string().trim().toUpperCase().regex(REGISTRATION_CODE_RE, 'รูปแบบโค้ดไม่ถูกต้อง').optional(),
  usage_limit: z.number().int().min(1).max(10000).nullable().optional(),
  expires_at: expiresAt.nullable().optional(),
  expires_in_days: expiresInDays.optional(),
  status: z.enum(['active', 'disabled']).optional(),
}).refine(oneExpiryField, oneExpiryMsg);
// all fields optional (the old "status only" request still works); at least one is required
export const regCodeUpdateSchema = z.object({
  label: z.string().trim().max(120).nullable().optional(),
  usage_limit: z.number().int().min(1).max(10000).nullable().optional(),
  expires_at: expiresAt.nullable().optional(),
  expires_in_days: expiresInDays.optional(),
  status: z.enum(['active', 'disabled']).optional(),
}).strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'ไม่มีข้อมูลที่ต้องแก้ไข' })
  .refine(oneExpiryField, oneExpiryMsg);

export const settingsSchema = z.object({
  ai_confidence_threshold: z.object({
    value: z.number().min(0.05).max(0.99),
    validated: z.boolean(),
    note: z.string().max(500).optional(),
  }).optional(),
}).strict();

export const activeModelSchema = z.object({
  workspace: z.string().trim().min(1).max(100).regex(/^[\w\-]+$/, 'workspace ไม่ถูกต้อง'),
  project: z.string().trim().min(1).max(100).regex(/^[\w\-]+$/, 'project ไม่ถูกต้อง'),
  version: z.coerce.number().int().min(1).max(100000),
});

const datasetClass = z.enum(['cataract', 'pterygium', 'pinguecula', 'glaucoma', 'normal', 'other']);
export const datasetListQuery = listQuery.extend({
  review_status: z.enum(['pending', 'approved', 'rejected']).optional(),
  disease_class: datasetClass.optional(),
  dataset_status: z.enum(['local', 'uploaded_to_roboflow', 'upload_failed']).optional(),
});
export const datasetCreateSchema = z.object({ suggested_class: datasetClass.optional().nullable().or(z.literal('').transform(() => null)) });
export const datasetUpdateSchema = z.object({ disease_class: datasetClass });
export const datasetApproveSchema = z.object({ disease_class: datasetClass });
export const datasetRejectSchema = z.object({ reason: z.string().trim().min(3, 'กรุณาระบุเหตุผล').max(500) });

export const roboflowImagesQuery = z.object({
  offset: z.coerce.number().int().min(0).optional().default(0),
  limit: z.coerce.number().int().min(1).max(100).optional().default(24),
  class_name: z.string().max(100).optional(),
  tag: z.string().max(100).optional(),
  search: z.string().max(100).optional(),
});
export const roboflowGenerateSchema = z.object({
  resize: z.number().int().min(64).max(2048).optional().default(640),
});
export const roboflowTrainSchema = z.object({
  version: z.number().int().min(1),
  speed: z.enum(['fast', 'accurate']).optional(),
});
