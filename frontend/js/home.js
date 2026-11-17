import { api } from './api.js';
import { icons } from './icons.js';
import { qs, esc } from './ui.js';
import { getCurrentUser } from './auth.js';
import { DISEASES } from './constants.js';

const FEATURES = [
  { icon: 'clipboard', title: 'ระบบซักประวัติสุขภาพ', text: 'แบบฟอร์ม 3 ส่วน: ช่วงอายุ ปัจจัยเสี่ยง และอาการผิดปกติ พร้อมแจ้งเตือนอาการฉุกเฉินทันที' },
  { icon: 'eye', title: 'ระบบทดสอบการมองเห็น', text: 'ความคมชัด การแยกสี ลานสายตา ระยะใกล้ และ Contrast ทดสอบตาซ้าย–ขวาแยกกัน' },
  { icon: 'camera', title: 'ระบบถ่ายภาพดวงตา', text: 'ใช้กล้องโทรศัพท์หรือเว็บแคม มีกรอบเล็ง คำแนะนำด้วยเสียง และตรวจคุณภาพภาพก่อนส่ง' },
  { icon: 'cpu', title: 'ระบบวิเคราะห์ด้วย AI', text: 'ส่งภาพไปยังโมเดล Deep Learning บน Roboflow แสดงค่าความมั่นใจจริงของโมเดล' },
  { icon: 'file', title: 'ระบบแสดงผลการตรวจ', text: 'แยกผล AI ผลซักประวัติ และผลทดสอบสายตา สรุประดับความเสี่ยงและคำแนะนำ พิมพ์รายงานได้' },
  { icon: 'database', title: 'ระบบจัดเก็บประวัติการตรวจ', text: 'ดูผลย้อนหลัง แนวโน้ม และแดชบอร์ด แยกข้อมูลตามสิทธิ์ของแต่ละบัญชี' },
];

const Y = (note = '') => `<span class="cmp-yes">${icons.check}<span class="sr-only">รองรับ</span>${note ? `<span class="cmp-note">${note}</span>` : ''}</span>`;
const N = (note = '') => `<span class="cmp-no" aria-label="ไม่รองรับ">—</span>${note ? `<span class="cmp-note">${note}</span>` : ''}`;

// Factual comparison — the AI system is NOT presented as better than an ophthalmologist.
const ROWS = [
  ['การถ่ายภาพดวงตา', Y('ภาพภายนอกผ่านกล้องมือถือ'), N('โดยทั่วไปใช้การสังเกตด้วยตา'), Y('กล้องตรวจเฉพาะทาง')],
  ['การทดสอบการมองเห็น', Y('ผ่านหน้าจอ ไม่ใช่มาตรฐาน'), Y('แผ่นวัดสายตา'), Y('เครื่องมือมาตรฐาน')],
  ['การซักประวัติสุขภาพ', Y(), Y(), Y()],
  ['การวิเคราะห์ภาพด้วย AI', Y(), N(), N()],
  ['การประเมินความเสี่ยง', Y('เบื้องต้น'), Y('เบื้องต้น'), Y('ครบถ้วน')],
  ['การแสดงผลการคัดกรอง', Y('ทันที'), Y(), Y()],
  ['การบันทึกประวัติการตรวจ', Y('ดิจิทัล'), N('ขึ้นกับหน่วยงาน'), Y('เวชระเบียน')],
  ['การติดตามผลการตรวจ', Y('กราฟแนวโน้ม'), N('ขึ้นกับหน่วยงาน'), Y()],
  ['การตรวจยืนยันโดยจักษุแพทย์', N(), N(), Y('วินิจฉัยได้')],
];
const COLS = ['', 'ระบบตรวจคัดกรองด้วย AI', 'การตรวจคัดกรองทั่วไป', 'การตรวจโดยจักษุแพทย์'];

export async function init() {
  qs('#feature-grid').innerHTML = FEATURES.map((f) => `
    <article class="card card-hover feature-card">
      <div class="icon-bubble">${icons[f.icon]}</div>
      <h3 class="mb-0">${f.title}</h3>
      <p>${f.text}</p>
    </article>`).join('');

  qs('#compare-table tbody').innerHTML = ROWS.map(([label, ...cells]) => `
    <tr><td>${label}</td>${cells.map((c, i) => `<td data-label="${COLS[i + 1]}" class="${i === 0 ? 'col-ai' : ''}">${c}</td>`).join('')}</tr>`).join('');
  qs('#compare-foot').innerHTML = `${icons.alert}<span>"ระบบ AI Eye Screening เป็นเครื่องมือช่วยคัดกรองความเสี่ยงเบื้องต้น ไม่สามารถใช้แทนการวินิจฉัยโดยจักษุแพทย์ได้"</span>`;

  const user = await getCurrentUser().catch(() => null);
  if (!user) qs('#cta-start').href = '/pages/register.html';

  // Real AI connection status from the backend — never assumed
  const chip = qs('#ai-status');
  try {
    const s = await api.get('/ai/status', null, { timeout: 15000 });
    if (s.connected && s.ready) {
      const sup = Object.entries(s.supportedDiseases ?? {}).filter(([, v]) => v).map(([k]) => DISEASES[k]?.th).filter(Boolean);
      chip.innerHTML = `<span class="status-dot ok"></span>AI เชื่อมต่อแล้ว · โมเดล ${esc(s.project)} v${esc(s.modelVersion)}${sup.length ? ` · รองรับ: ${esc(sup.join(', '))}` : ''}`;
    } else if (s.connected) {
      chip.innerHTML = `<span class="status-dot warn"></span>AI เชื่อมต่อแล้วแต่ยังไม่พร้อม: ${esc(s.reason ?? '')}`;
    } else {
      chip.innerHTML = `<span class="status-dot err"></span>AI Not Connected — ${esc(s.reason ?? 'ยังไม่ได้เชื่อมต่อโมเดล')}`;
    }
  } catch {
    chip.innerHTML = '<span class="status-dot err"></span>ไม่สามารถตรวจสอบสถานะ AI ได้ (Backend ไม่ตอบสนอง)';
  }
}
