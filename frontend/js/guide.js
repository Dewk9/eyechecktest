import { icons } from './icons.js';
import { qs, qsa } from './ui.js';

const CAUTIONS = [
  'ผลการวิเคราะห์เป็นการคัดกรองเบื้องต้น ไม่ใช่การวินิจฉัยทางการแพทย์',
  'หากมีอาการปวดตารุนแรง ตาแดง ตามัวเฉียบพลัน หรือคลื่นไส้อาเจียน ให้ไปพบจักษุแพทย์/ห้องฉุกเฉินทันที',
  'ผลทดสอบสายตาผ่านหน้าจอขึ้นกับอุปกรณ์ ความสว่าง และระยะ ไม่ใช่การตรวจมาตรฐาน',
  'ถ่ายภาพในที่สว่าง ไม่ใช้แฟลชส่องตาโดยตรง และไม่ถ่ายภาพขณะขับขี่',
  'อย่าแชร์รหัสผ่าน และออกจากระบบทุกครั้งเมื่อใช้เครื่องสาธารณะ',
  'เจ้าหน้าที่ต้องขอความยินยอมจากผู้เข้ารับการตรวจก่อนบันทึกข้อมูลและถ่ายภาพ',
];

export function init() {
  // illustrations (inline icons) + table of contents
  qsa('[data-icon]').forEach((el) => { el.innerHTML = icons[el.dataset.icon] ?? ''; });
  qs('#cautions').innerHTML = CAUTIONS.map((c) => `<li>${icons.alert}<span>${c}</span></li>`).join('');
  const sections = qsa('.guide-section[data-title]');
  qs('#toc').innerHTML = sections.map((s) => `<li><a href="#${s.id}">${s.dataset.title}</a></li>`).join('');
}
