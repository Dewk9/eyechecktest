/**
 * Video tutorials shown on the user manual page (js/guide.js).
 *
 * To publish a video, fill in `url` (and optionally `poster` and `duration`) — no other code change:
 *   url:      a YouTube link (https://www.youtube.com/watch?v=ID, https://youtu.be/ID, …/embed/ID, …/shorts/ID)
 *             or an MP4/WebM file (e.g. '/assets/videos/intro.mp4' or a full https:// URL)
 *   poster:   thumbnail image shown before playing (YouTube falls back to the video's own thumbnail)
 *   duration: display text, e.g. '3:45'
 *
 * Entries without a `url` are shown as "กำลังจัดเตรียม" (no play button, nothing is loaded).
 * Nothing autoplays: a player is only created after the user presses Play.
 */
export const VIDEOS = [
  { id: 'intro', category: 'แนะนำระบบ', title: 'แนะนำระบบ EYE Check', description: 'ภาพรวมของระบบตรวจคัดกรองโรคต้อในดวงตาด้วย AI และขั้นตอนการใช้งานตั้งแต่ต้นจนจบ', section: 'g1', url: '', poster: '', duration: '' },
  { id: 'account', category: 'เริ่มต้นใช้งาน', title: 'วิธีสมัครสมาชิกและเข้าสู่ระบบ', description: 'เลือกประเภทบัญชี กรอกข้อมูลสมัครสมาชิก และเข้าสู่ระบบอย่างปลอดภัย', section: 'g1', url: '', poster: '', duration: '' },
  { id: 'personal', category: 'เริ่มต้นใช้งาน', title: 'วิธีใช้งานบัญชีส่วนบุคคล', description: 'ซักประวัติสุขภาพครั้งแรก เริ่มตรวจคัดกรอง และจัดการข้อมูลส่วนตัว', section: 'g3', url: '', poster: '', duration: '' },
  { id: 'staff', category: 'เริ่มต้นใช้งาน', title: 'วิธีใช้งานบัญชี อสม./เจ้าหน้าที่', description: 'จัดการรายชื่อผู้เข้ารับการตรวจ ตรวจให้ผู้อื่น และเปรียบเทียบผลรายบุคคล', section: 'g4', url: '', poster: '', duration: '' },
  { id: 'history', category: 'ขั้นตอนการตรวจ', title: 'วิธีซักประวัติสุขภาพ', description: 'กรอกช่วงอายุ ปัจจัยเสี่ยง และอาการทางดวงตาให้ครบถ้วน', section: 'g5', url: '', poster: '', duration: '' },
  { id: 'vision', category: 'ขั้นตอนการตรวจ', title: 'วิธีทดสอบการมองเห็น', description: 'ปรับเทียบหน้าจอและระยะ แล้วทดสอบสายตาทีละข้าง', section: 'g6', url: '', poster: '', duration: '' },
  { id: 'camera', category: 'ขั้นตอนการตรวจ', title: 'วิธีถ่ายภาพดวงตา', description: 'เปิดกล้อง จัดตำแหน่งแบบ Real-time และถ่ายภาพให้ผ่านเกณฑ์คุณภาพ', section: 'g7', url: '', poster: '', duration: '' },
  { id: 'upload', category: 'ขั้นตอนการตรวจ', title: 'วิธีอัปโหลดภาพดวงตา', description: 'เลือกไฟล์ภาพที่ถูกต้องและตรวจคุณภาพภาพก่อนส่งวิเคราะห์', section: 'g8', url: '', poster: '', duration: '' },
  { id: 'ai', category: 'ขั้นตอนการตรวจ', title: 'วิธีวิเคราะห์โรคด้วย AI', description: 'ติดตามสถานะการวิเคราะห์ และวิธีจัดการเมื่อวิเคราะห์ไม่สำเร็จ', section: 'g9', url: '', poster: '', duration: '' },
  { id: 'result', category: 'ผลการตรวจ', title: 'วิธีดูและบันทึกผลการตรวจ', description: 'อ่านผลการตรวจแต่ละส่วน ระดับความเสี่ยง และบันทึกผล', section: 'g10', url: '', poster: '', duration: '' },
  { id: 'dashboard', category: 'ผลการตรวจ', title: 'วิธีดู Dashboard และรายงาน', description: 'อ่านสถิติภาพรวม ปรับตัวกรอง และพิมพ์รายงาน', section: 'g13', url: '', poster: '', duration: '' },
];
