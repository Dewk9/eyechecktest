import { api } from '../api.js';
import { icons } from '../icons.js';
import { qs, esc, toast, renderErrorState, renderState, formatDateTime, formatDate, renderPagination } from '../ui.js';
import { ACCOUNT_TYPES, GENDERS } from '../constants.js';
import { openModal, confirmDialog, promptDialog } from '../../components/modal.js';
import { getCurrentUser } from '../auth.js';

// 12.2 User management
export async function render(box) {
  const me = await getCurrentUser();
  const q = { page: 1, pageSize: 20 };
  box.innerHTML = `<header><h1>จัดการสมาชิก</h1><p class="muted">ค้นหา กรอง ดูรายละเอียด ระงับ/เปิดใช้งานบัญชี และจัดการสิทธิ์</p></header>
    <form class="toolbar card" id="u-f">
      <div class="field grow"><label for="u-search">ค้นหา</label><input class="input" id="u-search" type="search" placeholder="ชื่อบัญชี ชื่อ-นามสกุล หรือสถานที่ทำงาน"></div>
      <div class="field"><label for="u-type">ประเภทบัญชี</label><select class="select" id="u-type"><option value="">ทั้งหมด</option><option value="personal">ส่วนบุคคล</option><option value="staff">อสม./เจ้าหน้าที่</option></select></div>
      <div class="field"><label for="u-role">สิทธิ์</label><select class="select" id="u-role"><option value="">ทั้งหมด</option><option value="user">ผู้ใช้</option><option value="admin">ผู้ดูแลระบบ</option></select></div>
      <div class="field"><label for="u-status">สถานะ</label><select class="select" id="u-status"><option value="">ทั้งหมด</option><option value="active">ใช้งาน</option><option value="suspended">ระงับ</option></select></div>
    </form><div id="u-list"></div><div class="pagination" id="u-pager"></div>`;

  const list = qs('#u-list');
  const load = async () => {
    renderState(list, { type: 'loading', skeleton: 'table', rows: 8 });
    let d;
    try { d = await api.get('/admin/users', q); } catch (err) { renderErrorState(list, err, load); return; }
    if (!d.items.length) { renderState(list, { type: 'empty', message: 'ไม่พบสมาชิก' }); qs('#u-pager').innerHTML = ''; return; }
    list.innerHTML = `<div class="table-wrap"><table class="table stack-sm"><thead><tr><th>สมาชิก</th><th>ประเภท</th><th>สิทธิ์</th><th>สถานะ</th><th>วันที่สมัคร</th><th>เข้าสู่ระบบล่าสุด</th><th></th></tr></thead><tbody>
      ${d.items.map((u) => `<tr>
        <td data-label="สมาชิก"><strong>${esc(u.full_name)}</strong><br><span class="small muted">@${esc(u.username)}</span></td>
        <td data-label="ประเภท">${esc(ACCOUNT_TYPES[u.account_type])}</td>
        <td data-label="สิทธิ์">${u.role === 'admin' ? '<span class="badge badge-primary">ผู้ดูแลระบบ</span>' : 'ผู้ใช้'}</td>
        <td data-label="สถานะ">${u.status === 'active' ? '<span class="badge badge-success">ใช้งาน</span>' : '<span class="badge badge-danger">ระงับ</span>'}</td>
        <td data-label="สมัคร">${formatDate(u.created_at)}</td>
        <td data-label="ล่าสุด">${u.last_login_at ? formatDateTime(u.last_login_at) : '-'}</td>
        <td class="actions"><button class="btn btn-sm" data-view="${esc(u.id)}">รายละเอียด</button>
          ${u.id === me.id ? '' : u.status === 'active'
            ? `<button class="btn btn-sm btn-outline-danger" data-suspend="${esc(u.id)}" data-name="${esc(u.username)}">ระงับ</button>`
            : `<button class="btn btn-sm" data-activate="${esc(u.id)}" data-name="${esc(u.username)}">เปิดใช้งาน</button>`}</td></tr>`).join('')}
    </tbody></table></div>`;
    renderPagination(qs('#u-pager'), d, (p) => { q.page = p; load(); });
  };

  list.onclick = async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.view) showUser(b.dataset.view, me, load);
    if (b.dataset.suspend) {
      const reason = await promptDialog({ title: `ระงับบัญชี @${b.dataset.name}`, label: 'เหตุผลในการระงับ (บันทึกใน Audit Log)', confirmText: 'ระงับบัญชี', danger: true });
      if (reason === null) return;
      try { await api.patch(`/admin/users/${b.dataset.suspend}/status`, { status: 'suspended', reason }); toast('ระงับบัญชีแล้ว', 'success'); load(); } catch (err) { toast(err.message, 'error'); }
    }
    if (b.dataset.activate) {
      if (!(await confirmDialog({ title: 'เปิดใช้งานบัญชี', message: `เปิดใช้งานบัญชี @${b.dataset.name} อีกครั้ง?` }))) return;
      try { await api.patch(`/admin/users/${b.dataset.activate}/status`, { status: 'active' }); toast('เปิดใช้งานบัญชีแล้ว', 'success'); load(); } catch (err) { toast(err.message, 'error'); }
    }
  };
  let t;
  qs('#u-search').addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => { q.search = e.target.value.trim() || undefined; q.page = 1; load(); }, 350); });
  qs('#u-f').addEventListener('change', (e) => {
    if (e.target.id === 'u-search') return;
    q.account_type = qs('#u-type').value || undefined;
    q.role = qs('#u-role').value || undefined;
    q.status = qs('#u-status').value || undefined;
    q.page = 1;
    load();
  });
  qs('#u-f').addEventListener('submit', (e) => e.preventDefault());
  load();
}

/** Open the member-detail dialog from other admin pages (e.g. registration-code details). */
export async function openUserDetail(id, { onChanged } = {}) {
  let me;
  try { me = await getCurrentUser(); } catch (err) { toast(err.message, 'error'); return; }
  showUser(id, me ?? {}, () => onChanged?.());
}

async function showUser(id, me, reload) {
  const body = document.createElement('div');
  renderState(body, { type: 'loading', skeleton: 'form', rows: 4 });
  const m = openModal({ title: 'รายละเอียดสมาชิก', content: body, wide: true });
  let u;
  try { u = await api.get(`/admin/users/${id}`); } catch (err) { renderErrorState(body, err); return; }
  body.innerHTML = `
    <dl class="kv mb-4">
      <dt>ชื่อ-นามสกุล</dt><dd>${esc(u.full_name)}</dd><dt>ชื่อบัญชี</dt><dd>@${esc(u.username)}</dd>
      <dt>ประเภทบัญชี</dt><dd>${esc(ACCOUNT_TYPES[u.account_type])}</dd>
      ${u.account_type === 'personal' ? `<dt>อายุ / เพศ</dt><dd>${esc(u.age ?? '-')} ปี · ${esc(GENDERS[u.gender] ?? '-')}</dd>` : `<dt>ตำแหน่ง / ที่ทำงาน</dt><dd>${esc(u.position ?? '-')} · ${esc(u.workplace ?? '-')}</dd>`}
      <dt>สถานะ</dt><dd>${u.status === 'active' ? 'ใช้งาน' : 'ระงับ'}</dd><dt>วันที่สมัคร</dt><dd>${formatDateTime(u.created_at)}</dd>
      ${u.registration_code ? `<dt>สมัครด้วยโค้ด</dt><dd>${esc(u.registration_code.code_label ?? '-')} <span class="code-ref">REF-${esc(String(u.registration_code.code_ref).slice(0, 8).toUpperCase())}</span>${u.registration_code.deleted ? ' <span class="badge badge-muted">โค้ดถูกลบแล้ว</span>' : ''} <span class="small muted">· ${formatDateTime(u.registration_code.used_at)}</span></dd>` : ''}
      <dt>จำนวนการตรวจ</dt><dd>${u.screenings_count} ครั้ง${u.account_type === 'staff' ? ` · ผู้เข้ารับการตรวจ ${u.patients_count} คน` : ''}</dd>
      <dt>สิทธิ์</dt><dd>${u.role === 'admin' ? 'ผู้ดูแลระบบ' : 'ผู้ใช้ทั่วไป'}
        ${u.id === me.id ? '<span class="small muted">(บัญชีของคุณ)</span>' : `<button class="btn btn-sm" id="role-btn">${u.role === 'admin' ? 'ถอนสิทธิ์ผู้ดูแล' : 'มอบสิทธิ์ผู้ดูแล'}</button>`}</dd>
    </dl>
    <h3>ประวัติการใช้งานล่าสุด</h3>
    ${u.recent_activity.length ? `<ul class="recent-list">${u.recent_activity.map((a) => `<li><span class="badge">${esc(a.action)}</span><span class="small muted">${formatDateTime(a.created_at)}</span></li>`).join('')}</ul>` : '<p class="muted">ไม่มีประวัติ</p>'}`;
  qs('#role-btn', body)?.addEventListener('click', async () => {
    const role = u.role === 'admin' ? 'user' : 'admin';
    if (!(await confirmDialog({ title: 'เปลี่ยนสิทธิ์', message: role === 'admin' ? `มอบสิทธิ์ผู้ดูแลระบบให้ @${u.username}? ผู้ดูแลระบบเข้าถึงข้อมูลสมาชิกและ Dataset ได้` : `ถอนสิทธิ์ผู้ดูแลระบบของ @${u.username}?`, danger: role === 'admin', requireText: role === 'admin' ? u.username : undefined }))) return;
    try { await api.patch(`/admin/users/${u.id}/role`, { role }); toast('เปลี่ยนสิทธิ์แล้ว', 'success'); m.close(); reload(); } catch (err) { toast(err.message, 'error'); }
  });
}
