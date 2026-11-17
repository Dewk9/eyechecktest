import { api } from '../api.js';
import { icons } from '../icons.js';
import { qs, esc, renderErrorState, renderState, formatDateTime, riskBadge, findingBadge, todayISO, daysAgoISO, renderPagination } from '../ui.js';
import { DISEASES, FINDINGS } from '../constants.js';
import { diseasePie, trendLine } from '../charts.js';

const stat = (label, value, sub = '', color = '') => `<div class="card stat"><span class="stat-label">${label}</span><span class="stat-value" ${color ? `style="color:${color}"` : ''}>${Number(value ?? 0).toLocaleString('th-TH')}</span><span class="stat-sub">${sub}</span></div>`;

function rangeForm(id, from, to) {
  return `<form class="toolbar card" id="${id}">
    <div class="field"><label for="${id}-from">ตั้งแต่วันที่</label><input class="input" type="date" id="${id}-from" value="${from}"></div>
    <div class="field"><label for="${id}-to">ถึงวันที่</label><input class="input" type="date" id="${id}-to" value="${to}"></div>
    <button class="btn" type="submit">${icons.refresh}แสดงผล</button></form>`;
}

// ---------------------------------------------------------------------
// 12.1 Admin overview
// ---------------------------------------------------------------------
export async function renderOverview(box) {
  let from = daysAgoISO(13);
  let to = todayISO();
  box.innerHTML = `<header><h1>Admin Overview</h1><p class="muted">ภาพรวมระบบจากข้อมูลจริงในฐานข้อมูล</p></header>${rangeForm('ov', from, to)}<div id="ov-body"></div>`;
  const body = qs('#ov-body');
  const load = async () => {
    renderState(body, { type: 'loading', skeleton: 'dashboard' });
    let s;
    try { s = await api.get('/admin/statistics', { from, to }); } catch (err) { renderErrorState(body, err, load); return; }
    const sc = s.screening.summary;
    body.innerHTML = `
      <div class="grid grid-4 mb-4">
        ${stat('จำนวนสมาชิกทั้งหมด', s.members.total, `ส่วนบุคคล ${s.members.personal} · เจ้าหน้าที่ ${s.members.staff}`)}
        ${stat('จำนวนการสมัครสมาชิก', s.members.registrations_in_range, 'ในช่วงที่เลือก')}
        ${stat('จำนวนครั้งที่ตรวจทั้งหมด', s.screening.total_all_time, `ในช่วงที่เลือก ${sc.total_screenings}`)}
        ${stat('จำนวนผู้เข้ารับการตรวจ', s.screening.total_patients, `บุคคลที่ตรวจในช่วงนี้ ${sc.total_persons}`)}
        ${stat('ต้องส่งต่อพบจักษุแพทย์', sc.referrals, 'ความเสี่ยงสูง/ด่วน', 'var(--danger)')}
        ${stat('ผู้สแกนดวงตาวันนี้', s.today.scans, formatDateTime(new Date().toISOString()).split(' ')[0])}
        ${stat('ผู้เข้าใช้งานวันนี้', s.today.visitors, `เข้าสู่ระบบ ${s.today.active_logins} บัญชี`)}
        ${stat('ผู้สมัครสมาชิกวันนี้', s.today.registrations)}
      </div>
      <div class="grid grid-2 mb-4">
        <section class="card"><h2>แนวโน้มผลการตรวจแต่ละประเภท</h2><p class="small muted">${esc(sc.formula)} · ฐาน ${sc.denominator} ผลตรวจ · สรุปไม่ได้ ${sc.inconclusive}</p>
          ${sc.denominator ? '<div class="chart-box"><canvas id="ov-pie"></canvas></div>' : '<p class="muted">ยังไม่มีผลการตรวจที่บันทึกในช่วงนี้</p>'}</section>
        <section class="card"><h2>ผู้เข้าใช้งานและผู้สมัครต่อวัน</h2><div class="chart-box"><canvas id="ov-daily"></canvas></div></section>
      </div>
      <section class="card"><h2>รายการตรวจล่าสุด</h2>
        ${s.screening.recent.length ? `<ul class="recent-list">${s.screening.recent.map((r) => `<li><span class="mono">${esc(r.screening_code)}<br><span class="small muted">${formatDateTime(r.screening_date)}</span></span><span class="row">${findingBadge(r.primary_finding)} ${riskBadge(r.risk_level)} <a class="btn btn-sm" href="#screenings" data-open="${esc(r.id)}">ดู</a></span></li>`).join('')}</ul>` : '<p class="muted">ยังไม่มีการตรวจ</p>'}
      </section>`;
    if (sc.denominator) diseasePie(qs('#ov-pie'), sc.distribution, { countBy: 'screening' });
    trendLine(qs('#ov-daily'), s.daily, [
      { key: 'visitors', label: 'ผู้เข้าชม (ไม่ซ้ำ)', color: '#0b8fd8' },
      { key: 'registrations', label: 'สมัครสมาชิก', color: '#34c38f' },
      { key: 'scans', label: 'สแกนดวงตา', color: '#e06a2c' },
    ]);
    body.querySelectorAll('[data-open]').forEach((a) => a.addEventListener('click', () => sessionStorage.setItem('ec_admin_open', a.dataset.open)));
  };
  qs('#ov').addEventListener('submit', (e) => { e.preventDefault(); from = qs('#ov-from').value; to = qs('#ov-to').value; load(); });
  load();
}

// ---------------------------------------------------------------------
// 12.3 Website activity monitoring
// ---------------------------------------------------------------------
export async function renderActivity(box) {
  let from = daysAgoISO(13);
  let to = todayISO();
  const lq = { page: 1, pageSize: 20 };
  box.innerHTML = `<header><h1>กิจกรรมเว็บไซต์</h1><p class="muted">สถิติการเข้าชมแบบไม่ระบุตัวตน และบันทึกการกระทำสำคัญ (Audit Log)</p></header>
    ${rangeForm('ac', from, to)}<div id="ac-stats"></div>
    <section class="card mt-4"><div class="row-between"><h2 class="mb-0">Activity Log</h2>
      <div class="row"><label class="sr-only" for="ac-action">ประเภท</label><select class="select" id="ac-action" style="width:auto">
        <option value="">ทุกการกระทำ (ไม่รวมการเข้าชมหน้า)</option>
        ${['login', 'login_failed', 'logout', 'register', 'screening_created', 'screening_analyzed', 'screening_saved', 'screening_deleted', 'consent_withdrawn', 'account_deleted', 'patient_created', 'patient_deleted', 'admin_user_suspended', 'admin_user_activated', 'admin_role_changed', 'admin_dataset_approved', 'admin_dataset_rejected', 'admin_active_model_set', 'admin_viewed_screening', 'page_view', 'page_leave'].map((a) => `<option value="${a}">${a}</option>`).join('')}
      </select><input class="input" id="ac-search" type="search" placeholder="ค้นหาชื่อบัญชี" style="width:200px"></div></div>
      <div id="ac-list" class="mt-3"></div><div class="pagination" id="ac-pager"></div></section>`;

  const stats = qs('#ac-stats');
  const loadStats = async () => {
    renderState(stats, { type: 'loading', skeleton: 'dashboard' });
    let s;
    try { s = await api.get('/admin/statistics', { from, to }); } catch (err) { renderErrorState(stats, err, loadStats); return; }
    const sum = (k) => s.daily.reduce((a, d) => a + d[k], 0);
    stats.innerHTML = `
      <div class="grid grid-4 mb-4">
        ${stat('ผู้เข้าชมวันนี้', s.today.visitors)}
        ${stat('ออกจากเว็บไซต์วันนี้', s.today.leaves, 'จำนวนเหตุการณ์ออกจากหน้า')}
        ${stat('สมัครบัญชี (ช่วงที่เลือก)', sum('registrations'))}
        ${stat('สแกนตาวันนี้', s.today.scans)}
        ${stat('ผู้ใช้ที่เข้าสู่ระบบวันนี้', s.today.active_logins)}
        ${stat('การเปิดหน้าเว็บ (ช่วงที่เลือก)', sum('page_views'))}
      </div>
      <section class="card"><h2>กราฟแนวโน้มการใช้งาน</h2><div class="chart-box tall"><canvas id="ac-chart"></canvas></div>
        <p class="small muted mb-0">${esc(s.notes.visitors)} · ${esc(s.notes.leaves)}</p></section>`;
    trendLine(qs('#ac-chart'), s.daily, [
      { key: 'visitors', label: 'ผู้เข้าชม', color: '#0b8fd8' },
      { key: 'leaves', label: 'ออกจากเว็บไซต์', color: '#8796a5' },
      { key: 'active_logins', label: 'เข้าสู่ระบบ', color: '#7a52c7' },
      { key: 'registrations', label: 'สมัครบัญชี', color: '#34c38f' },
      { key: 'scans', label: 'สแกนตา', color: '#e06a2c' },
    ]);
  };

  const list = qs('#ac-list');
  const loadLog = async () => {
    renderState(list, { type: 'loading', skeleton: 'table', rows: 8 });
    let d;
    try { d = await api.get('/admin/activity', { ...lq, from, to }); } catch (err) { renderErrorState(list, err, loadLog); return; }
    if (!d.items.length) { renderState(list, { type: 'empty', message: 'ไม่มีบันทึกในช่วงนี้' }); qs('#ac-pager').innerHTML = ''; return; }
    list.innerHTML = `<div class="table-wrap"><table class="table stack-sm"><thead><tr><th>เวลา</th><th>การกระทำ</th><th>ผู้ใช้</th><th>รายละเอียด</th></tr></thead><tbody>
      ${d.items.map((a) => `<tr><td data-label="เวลา">${formatDateTime(a.created_at)}</td><td data-label="การกระทำ"><span class="badge">${esc(a.action)}</span></td>
        <td data-label="ผู้ใช้">${esc(a.profiles?.username ?? (a.user_id ? '(ลบแล้ว)' : 'ไม่ระบุตัวตน'))}</td><td data-label="รายละเอียด" class="small mono">${esc(JSON.stringify(a.details)).slice(0, 160)}</td></tr>`).join('')}
    </tbody></table></div>`;
    renderPagination(qs('#ac-pager'), d, (p) => { lq.page = p; loadLog(); });
  };
  qs('#ac').addEventListener('submit', (e) => { e.preventDefault(); from = qs('#ac-from').value; to = qs('#ac-to').value; lq.page = 1; loadStats(); loadLog(); });
  qs('#ac-action').addEventListener('change', (e) => { lq.action = e.target.value || undefined; lq.page = 1; loadLog(); });
  let t;
  qs('#ac-search').addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => { lq.search = e.target.value.trim() || undefined; lq.page = 1; loadLog(); }, 350); });
  loadStats();
  loadLog();
}

export { stat, DISEASES, FINDINGS };
