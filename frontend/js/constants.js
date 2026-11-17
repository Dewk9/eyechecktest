export const DISEASES = {
  pinguecula: { th: 'ต้อลม', en: 'Pinguecula', color: '#d9a50b' },
  cataract: { th: 'ต้อกระจก', en: 'Cataract', color: '#2f7fd1' },
  glaucoma: { th: 'ต้อหิน', en: 'Glaucoma', color: '#7a52c7' },
  pterygium: { th: 'ต้อเนื้อ', en: 'Pterygium', color: '#e06a2c' },
};

export const FINDINGS = {
  ...DISEASES,
  normal: { th: 'ไม่พบความผิดปกติ (ปกติ)', en: 'Normal', color: '#2fa77a' },
  no_finding: { th: 'ไม่พบรอยโรคที่โมเดลตรวจจับได้', en: 'No finding', color: '#2fa77a' },
  negative: { th: 'ไม่พบความผิดปกติ', en: 'No abnormality', color: '#2fa77a' },
  inconclusive: { th: 'สรุปไม่ได้', en: 'Inconclusive', color: '#8796a5' },
  other: { th: 'คลาสอื่นของโมเดล', en: 'Other', color: '#8796a5' },
};

export const RISK_LEVELS = {
  low: { th: 'ความเสี่ยงต่ำ', en: 'Low Risk', icon: 'checkCircle' },
  moderate: { th: 'ความเสี่ยงปานกลาง', en: 'Moderate Risk', icon: 'alert' },
  high: { th: 'ความเสี่ยงสูง', en: 'High Risk', icon: 'alert' },
  urgent: { th: 'ส่งต่อพบจักษุแพทย์ด่วน', en: 'Urgent Referral', icon: 'siren' },
  inconclusive: { th: 'สรุปไม่ได้', en: 'Inconclusive', icon: 'info' },
};

export const AI_STATUS = {
  pending: { th: 'รอวิเคราะห์', cls: 'badge-muted' },
  processing: { th: 'กำลังวิเคราะห์', cls: 'badge-primary' },
  completed: { th: 'วิเคราะห์สำเร็จ', cls: 'badge-success' },
  insufficient_confidence: { th: 'ความมั่นใจไม่เพียงพอ', cls: 'badge-warning' },
  failed: { th: 'วิเคราะห์ไม่สำเร็จ', cls: 'badge-danger' },
  not_connected: { th: 'AI ไม่ได้เชื่อมต่อ', cls: 'badge-muted' },
};

export const AGE_GROUPS = [
  { key: 'under_40', label: 'ต่ำกว่า 40 ปี', guide: 'กลุ่มความเสี่ยงต่ำ เน้นคัดกรองต้อลมและต้อเนื้อจากการโดนแดดและลม' },
  { key: '40_59', label: '40–59 ปี', guide: 'เริ่มมีความเสี่ยงโรคต้อหินเรื้อรังและต้อกระจกระยะเริ่มต้น ควรตรวจวัดความดันตา' },
  { key: '60_plus', label: '60 ปีขึ้นไป', guide: 'กลุ่มเสี่ยงสูงต่อโรคต้อกระจกและต้อหิน ควรเข้ารับการตรวจคัดกรองสม่ำเสมอ' },
];

/** Section 2 — options exactly as in the specification; some map to two DB fields */
export const RISK_OPTIONS = [
  { key: 'family_glaucoma_history', label: 'มีบุคคลสายตรงในครอบครัว (พ่อ แม่ พี่น้อง) เป็นโรคต้อหิน', guide: 'เสี่ยงต้อหินสูงกว่าคนทั่วไป 4–9 เท่า' },
  { key: 'chronic_disease', label: 'มีโรคประจำตัว เบาหวาน หรือความดันโลหิตสูง', guide: 'อาจเพิ่มความเสี่ยงต่อการเกิดต้อกระจกและต้อหินแทรกซ้อน', sub: [{ key: 'diabetes', label: 'เบาหวาน' }, { key: 'hypertension', label: 'ความดันโลหิตสูง' }] },
  { key: 'steroid_use', label: 'ใช้ยาหยอดตาหรือยารับประทานกลุ่มสเตียรอยด์ (Steroid) หรือยาชุดต่อเนื่อง', guide: 'อาจกระตุ้นให้ความดันตาสูง เสี่ยงต้อหินจากยาและต้อกระจกก่อนวัย' },
  { key: 'outdoor_exposure', label: 'ทำงานกลางแจ้ง โดนแสงแดด รังสี UV ลม ฝุ่น หรือควันเป็นประจำ', guide: 'เป็นปัจจัยเสี่ยงต่อการเกิดต้อลม ต้อเนื้อ และอาจเกี่ยวข้องกับต้อกระจก' },
  { key: 'myopia_injury', label: 'สายตาสั้นมาก (เกิน 600) หรือเคยได้รับอุบัติเหตุกระทบกระเทือนทางดวงตา', guide: 'อาจเพิ่มความเสี่ยงต้อหินและต้อกระจก', sub: [{ key: 'high_myopia', label: 'สายตาสั้นมาก (เกิน 600)' }, { key: 'eye_injury', label: 'เคยได้รับอุบัติเหตุทางดวงตา' }] },
];

export const SYMPTOMS = [
  { key: 'blurry_cloudy', label: 'ตามัวเหมือนมองผ่านกระจกฝ้า หรือหมอกขาว ค่อย ๆ มัวลงเรื่อย ๆ ไม่เจ็บปวด', guide: 'อาจบ่งชี้ต้อกระจก (เลนส์แก้วตาขุ่น)' },
  { key: 'glare_halos', label: 'แพ้แสงจ้า มองไฟหน้ารถตอนกลางคืนแล้วแสงแตกกระจาย หรือเห็นรุ้งรอบดวงไฟ', guide: 'อาจสัมพันธ์กับต้อกระจกหรือความดันตาสูง (ต้อหิน)' },
  { key: 'peripheral_loss', label: 'เดินชนสิ่งของด้านข้างบ่อย รู้สึกมุมมองภาพด้านข้างแคบลง', guide: 'เป็นสัญญาณเตือนที่อาจพบในต้อหินเรื้อรัง' },
  { key: 'irritation', label: 'ระคายเคืองตา แสบตา น้ำตาไหล ตาแดงง่ายเมื่อโดนลมหรือแสงแดด', guide: 'อาจบ่งชี้ต้อลมหรือต้อเนื้อระยะเริ่มต้น' },
  { key: 'tissue_growth', label: 'สังเกตเห็นติ่งเนื้อหรือแผ่นเยื่อสีขาวอมชมพูยื่นจากหัวตาเข้าหาตาดำ', guide: 'อาจบ่งชี้ต้อเนื้อ' },
];

export const EMERGENCY = {
  key: 'emergency_symptoms',
  label: 'อาการเตือนฉุกเฉิน: ปวดตาตุบ ๆ รุนแรง ปวดศีรษะข้างเดียว ตาแดงคลั่ง หรือคลื่นไส้อาเจียน',
  guide: 'สงสัยต้อหินเฉียบพลัน ต้องส่งพบจักษุแพทย์ด่วนที่สุด',
};

export const GENDERS = { male: 'ชาย', female: 'หญิง', other: 'อื่น ๆ', unspecified: 'ไม่ระบุ' };
export const ACCOUNT_TYPES = { personal: 'บัญชีส่วนบุคคล', staff: 'บัญชี อสม./เจ้าหน้าที่' };
export const EYE_SIDES = { left: 'ตาซ้าย', right: 'ตาขวา' };

export const DISCLAIMER = 'ผลการวิเคราะห์นี้เป็นเพียงการคัดกรองเบื้องต้น ไม่ใช่การวินิจฉัยทางการแพทย์ หากมีอาการผิดปกติหรือสงสัยว่าเป็นโรคต้อ ควรเข้ารับการตรวจจากจักษุแพทย์';
export const CONSENT_VERSION_FALLBACK = '1.0';
