# EYE Check — AI Eye Disease Screening & Management Platform

ระบบตรวจคัดกรองโรคต้อในดวงตาด้วย AI: ซักประวัติ → ทดสอบการมองเห็น → ถ่ายภาพดวงตา → วิเคราะห์ด้วย Roboflow → แสดงผล/คำแนะนำ → จัดเก็บประวัติ → Dashboard → ระบบผู้ดูแลและ Dataset

> ⚠️ เป็นเครื่องมือ **คัดกรองเบื้องต้น** ไม่ใช่การวินิจฉัยทางการแพทย์

## สถาปัตยกรรม

```
Browser (HTML/CSS/Vanilla JS modules, WebRTC, Chart.js)
   │  fetch + httpOnly cookies + X-Requested-With (CSRF)
   ▼
Backend  Node.js / Express  (backend/)
   ├─ Supabase Auth  (username → synthetic e-mail, password hashing by Supabase)
   ├─ Supabase Postgres (RLS on every table; user JWT for user data)
   ├─ Supabase Storage (private buckets, signed URLs)
   └─ Roboflow API (inference, dataset, versions, training) — API key only on the server
Shared pure JS (ai/) — image-quality metrics & Roboflow response normalisation, used by both sides
```

| โฟลเดอร์ | เนื้อหา |
|---|---|
| `frontend/` | หน้าเว็บทั้งหมด (`index.html`, `pages/`), `css/`, `js/` (โมดูลต่อหน้า), `components/` |
| `backend/src/` | `config/` `routes/` `controllers/` `services/` `middleware/` `validators/` `roboflow/` `utils/` |
| `ai/` | `image-quality/` (blur, brightness, exposure, eye position), `roboflow/` (class mapping, normalisation) |
| `database/` | `migrations/` (แหล่งจริง), `schema.sql` + `policies.sql` (snapshot ที่สร้างอัตโนมัติ) |
| `docs/` | `setup.md`, `api.md`, `database.md`, `user-guide.md` |

## เริ่มต้นใช้งาน (สรุป)

```bash
cd backend
npm install
cp .env.example .env          # กรอกค่า Supabase / Roboflow / JWT_SECRET
npm run db:migrate            # หรือวาง database/migrations/*.sql ใน Supabase SQL Editor ตามลำดับ
npm run check-config          # ตรวจค่าตั้ง + ทดสอบการเชื่อมต่อจริง
npm run create-admin -- --username admin01 --name "ผู้ดูแลระบบ" --password "ChangeMe-2026"
npm run create-staff-code -- --label "รพ.สต. ตัวอย่าง" --limit 20
npm start                     # http://localhost:3000
```

รายละเอียด: [docs/setup.md](docs/setup.md)

## การทดสอบ

```bash
cd backend
npm test                   # unit + HTTP security tests (ไม่ต้องใช้ Supabase)
npm run test:integration   # RLS / data isolation กับ Supabase โปรเจกต์ทดสอบ (.env.test)
```

## สิ่งที่ต้องทราบ (ข้อจำกัดที่เป็นจริง)

- **AI**: ระบบไม่มีผลวิเคราะห์ปลอม หากไม่ได้ตั้งค่า Roboflow หน้าเว็บจะแสดง *AI Not Connected* และประเมินจากซักประวัติเท่านั้น
- **โรคที่รองรับ** ขึ้นกับคลาสที่มีจริงในโปรเจกต์ Roboflow (เช่น ถ้าไม่มีคลาส glaucoma จะแสดง *Not Supported*) และต้อหินมีหมายเหตุเสมอว่าภาพภายนอกยืนยันไม่ได้
- **Risk assessment** เป็นกฎที่เปิดเผยได้ (`rules-v1`, ดู `backend/src/services/assessment/risk-engine.js`) **ยังไม่ผ่านการ validate ทางคลินิก** และไม่ผสมค่า confidence ของ AI
- **Confidence threshold** เริ่มต้น 60% ระบุว่า *ยังไม่ผ่านการประเมิน* จนกว่าผู้ดูแลจะประเมินกับชุดทดสอบจริงและตั้งค่าในหน้า Admin
- **Vision tests** ผ่านหน้าจอเป็นการประมาณ ต้องปรับเทียบหน้าจอ
- **Roboflow**: การลบภาพ/การ Train ผ่าน API ขึ้นกับแพ็กเกจ — ระบบรายงานผลตอบกลับจริงของ Roboflow และแจ้งให้ใช้หน้าเว็บ Roboflow เมื่อ API ไม่รองรับ; ภาพที่ส่งไปจะถูก tag `class:<name>` แต่ **ต้อง Annotate ใน Roboflow** (ระบบไม่สร้าง annotation เอง)
- **Eye position** ฝั่งกล้องเป็น heuristic (หาบริเวณตาดำ) ใช้เป็นคำแนะนำ ไม่ใช่ตัวตรวจจับดวงตา
