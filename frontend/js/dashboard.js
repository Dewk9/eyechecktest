import { api } from './api.js';
import { icons } from './icons.js';
import { qs, esc, renderErrorState, renderState, formatDateTime, riskBadge, findingBadge, todayISO, daysAgoISO } from './ui.js';
import { requireUser } from './auth.js';
import { DISEASES, FINDINGS, ACCOUNT_TYPES } from './constants.js';
import { diseasePie, trendLine, chartAvailable } from './charts.js';

const root = () => qs('#page-root');
const REFRESH_MS = 60 * 1000;
let user;
let timer;
const q = { from: daysAgoISO(29), to: todayISO(), disease: '', count_by: 'screening' };

export async function init() {
  try { user = await requireUser(); } catch (err) { renderErrorState(root(), err); return; }
  const staff = user.account_type === 'staff';

  root().innerHTML = `
    <div class="page-head row-between">
      <div class="row" style="gap:14px">
        <img src="/assets/logo.svg" alt="EYE Check" width="52" height="52">
        <div><h1 class="mb-0">แดชบอร์ด</h1><p class="mb-0 muted">EYE Check · ระบบตรวจคัดกรองโรคต้อในดวงตา — ${esc(ACCOUNT_TYPES[user.account_type])}</p></div>
      </div>
      <a class="btn btn-primary btn-lg" href="/pages/medical-history.html">${icons.eye}เริ่มตรวจคัดกรอง</a>
    </div>
    <form class="toolbar card" id="dash-filters" aria-label="ตัวกรองแดชบอร์ด">
      <div class="field"><label for="d-from">ตั้งแต่วันที่</label><input class="input" type="date" id="d-from" value="${q.from}"></div>
      <div class="field"><label for="d-to">ถึงวันที่</label><input class="input" type="date" id="d-to" value="${q.to}"></div>
      <div class="field"><label for="d-disease">ประเภทโรค</label><select class="select" id="d-disease"><option value="">ทุกประเภท</option>
        ${Object.entries(DISEASES).map(([k, v]) => `<option value="${k}">${v.th}</option>`).join('')}</select></div>
      ${staff ? `<div class="field"><label for="d-countby">วิธีนับ</label><select class="select" id="d-countby"><option value="screening">นับตามจำนวนผลตรวจ</option><option value="person">นับตามจำนวนบุคคล</option></select></div>` : ''}
      <span class="small muted grow" id="d-updated" aria-live="polite"></span>
      <button type="button" class="btn" id="d-refresh">${icons.refresh}รีเฟรช</button>
    </form>
    <div id="dash-body"></div>`;

  const f = qs('#dash-filters');
  f.addEventListener('change', () => {
    q.from = qs('#d-from').value || daysAgoISO(29);
    q.to = qs('#d-to').value || todayISO();
    q.disease = qs('#d-disease').value;
    q.count_by = qs('#d-countby')?.value ?? 'screening';
    load();
  });
  qs('#d-refresh').addEventListener('click', () => load());
  // auto-update with new results (polling while the tab is visible)
  document.addEventListener('visibilitychange', () => { if (!document.hidden) load(true); });
  timer = setInterval(() => { if (!document.hidden) load(true); }, REFRESH_MS);
  window.addEventListener('pagehide', () => clearInterval(timer));
  load();
}

async function load(silent = false) {
  const body = qs('#dash-body');
  if (!silent) renderState(body, { type: 'loading', skeleton: 'dashboard' });
  const staff = user.account_type === 'staff';
  let d;
  try {
    d = await api.get(staff ? '/dashboard/staff' : '/dashboard/personal', { from: q.from, to: q.to, disease: q.disease || undefined, count_by: staff ? q.count_by : undefined });
  } catch (err) {
    if (!silent) renderErrorState(body, err, () => load());
    return;
  }
  qs('#d-updated').textContent = `อัปเดตล่าสุด ${formatDateTime(d.generated_at)} (อัปเดตอัตโนมัติทุก 1 นาที)`;
  const s = d.summary;
  const unit = s.count_by === 'person' ? 'คน' : 'ครั้ง';
  const hasData = s.total_screenings > 0;

  body.innerHTML = `
    <div class="grid grid-4 mb-5">
      <div class="card stat"><span class="stat-label">จำนวนครั้งที่ตรวจทั้งหมด</span><span class="stat-value">${d.total_all_time.toLocaleString('th-TH')}</span><span class="stat-sub">ในช่วงที่เลือก ${s.total_screenings.toLocaleString('th-TH')} ครั้ง</span></div>
      ${staff ? `<div class="card stat"><span class="stat-label">จำนวนผู้เข้ารับการตรวจ</span><span class="stat-value">${(d.total_patients ?? 0).toLocaleString('th-TH')}</span><span class="stat-sub">ตรวจในช่วงที่เลือก ${s.total_persons.toLocaleString('th-TH')} คน</span></div>` : ''}
      <div class="card stat"><span class="stat-label">ต้องส่งต่อพบจักษุแพทย์</span><span class="stat-value" style="color:var(--danger)">${s.referrals.toLocaleString('th-TH')}</span><span class="stat-sub">ระดับความเสี่ยงสูง/ด่วน (${unit})</span></div>
      <div class="card stat"><span class="stat-label">ผลที่สรุปไม่ได้</span><span class="stat-value">${s.inconclusive.toLocaleString('th-TH')}</span><span class="stat-sub">ไม่นำมารวมเป็นโรคใด (${unit})</span></div>
      ${staff ? '' : `<div class="card stat"><span class="stat-label">ผลที่สรุปได้</span><span class="stat-value">${s.denominator.toLocaleString('th-TH')}</span><span class="stat-sub">ใช้คำนวณเปอร์เซ็นต์</span></div>`}
    </div>
    <div class="grid grid-2 mb-5">
      <section class="card" aria-labelledby="h-pie">
        <h2 id="h-pie">แนวโน้มผลการตรวจแยกตามประเภทโรค</h2>
        <p class="small muted">${s.count_by === 'person' ? 'นับตามจำนวนบุคคล (1 คนอาจถูกนับมากกว่า 1 ประเภท หากพบหลายโรคในช่วงที่เลือก)' : 'นับตามจำนวนผลตรวจ (ผลตรวจแต่ละครั้งนับ 1 ครั้ง)'} · ${esc(s.formula)} · ฐานการคำนวณ ${s.denominator.toLocaleString('th-TH')} ${unit}</p>
        ${hasData && s.denominator ? '<div class="chart-box"><canvas id="pie" role="img" aria-label="กราฟวงกลมแสดงสัดส่วนผลการตรวจแยกตามประเภทโรค"></canvas></div>' : ''}
        <ul class="legend-list mt-4" aria-label="ตารางข้อมูลกราฟ">
          ${s.distribution.map((x) => `<li><span class="sw" style="background:${DISEASES[x.key]?.color ?? FINDINGS.negative.color}"></span><span>${esc(DISEASES[x.key]?.th ?? FINDINGS.negative.th)}</span><span class="num">${x.count.toLocaleString('th-TH')} ${unit}</span><span class="num">${x.percent}%</span></li>`).join('')}
          <li><span class="sw" style="background:#c5d0dc"></span><span>สรุปไม่ได้ (ไม่นำมาคำนวณ)</span><span class="num">${s.inconclusive.toLocaleString('th-TH')} ${unit}</span><span class="num">-</span></li>
        </ul>
        ${!hasData ? '<p class="muted mt-3 mb-0">ยังไม่มีผลการตรวจที่บันทึกในช่วงที่เลือก</p>' : ''}
      </section>
      <section class="card" aria-labelledby="h-trend">
        <h2 id="h-trend">แนวโน้มการตรวจ${staff ? 'ของผู้เข้ารับการตรวจทั้งหมด' : 'ทั้งหมด'}</h2>
        <p class="small muted">จำนวนการตรวจต่อวัน และจำนวนที่ต้องส่งต่อพบจักษุแพทย์</p>
        <div class="chart-box"><canvas id="trend" role="img" aria-label="กราฟเส้นแนวโน้มการตรวจรายวัน"></canvas></div>
      </section>
    </div>
    <section class="card" aria-labelledby="h-recent">
      <div class="row-between"><h2 id="h-recent" class="mb-0">รายการตรวจล่าสุด</h2><a href="/pages/history.html">ดูประวัติทั้งหมด</a></div>
      ${d.recent.length ? `<ul class="recent-list mt-3">${d.recent.map((r) => `<li>
        <span><a class="mono" href="/pages/result.html?id=${esc(r.id)}">${esc(r.screening_code)}</a> ${r.subject_name ? `· ${esc(r.subject_name)}` : ''}<br><span class="small muted">${formatDateTime(r.screening_date)}${r.is_saved ? '' : ' · ยังไม่บันทึก'}</span></span>
        <span class="row">${findingBadge(r.primary_finding)} ${riskBadge(r.risk_level)}</span></li>`).join('')}</ul>`
        : `<div class="state">${icons.clipboard}<h3>ยังไม่มีการตรวจ</h3><a class="btn btn-primary" href="/pages/medical-history.html">เริ่มตรวจคัดกรอง</a></div>`}
    </section>
    <p class="small muted mt-4">${esc(d.note)}</p>
    ${chartAvailable() ? '' : '<div class="alert alert-warning mt-4">ไม่สามารถโหลดไลบรารีกราฟได้ แสดงข้อมูลเป็นตารางแทน</div>'}`;

  if (hasData && s.denominator && qs('#pie')) diseasePie(qs('#pie'), s.distribution, { countBy: s.count_by });
  trendLine(qs('#trend'), d.trend);
}
