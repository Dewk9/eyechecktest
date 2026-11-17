import { api } from './api.js';
import { icons } from './icons.js';
import { qs, esc, toast, setBusy, clearFieldErrors, showFieldErrors, formToObject, calcAge, formatDateTime, formatDate, renderErrorState, renderState } from './ui.js';
import { login, register, getCurrentUser, requireUser, safeNext, clearCurrentUser } from './auth.js';
import { GENDERS, ACCOUNT_TYPES } from './constants.js';
import { confirmDialog, promptDialog } from '../components/modal.js';

const root = () => qs('#page-root');

function passwordHint() {
  return 'อย่างน้อย 8 ตัวอักษร ประกอบด้วยตัวอักษรภาษาอังกฤษและตัวเลข';
}

const genderOptions = (sel = '') => `<option value="">-- เลือกเพศ --</option>${Object.entries(GENDERS).map(([k, v]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${v}</option>`).join('')}`;

// =====================================================================
// Login
// =====================================================================
export async function initLogin() {
  const user = await getCurrentUser().catch(() => null);
  if (user) { location.replace(safeNext()); return; }

  root().innerHTML = `
    <div class="auth-wrap narrow">
      <div class="card fade-up">
        <div class="center mb-4">
          <img src="/assets/logo.svg" alt="" width="56" height="56" style="margin:0 auto 8px">
          <h1 class="mb-0" style="font-size:1.6rem">เข้าสู่ระบบ</h1>
          <p class="muted">EYE Check · ระบบตรวจคัดกรองโรคต้อด้วย AI</p>
        </div>
        <div id="login-alert"></div>
        <form id="login-form" novalidate class="stack">
          <div class="field">
            <label for="username" class="required">ชื่อบัญชี (Username)</label>
            <input class="input" id="username" name="username" autocomplete="username" required autocapitalize="none" spellcheck="false">
            <span class="field-error" data-error-for="username"></span>
          </div>
          <div class="field">
            <label for="password" class="required">รหัสผ่าน</label>
            <input class="input" id="password" name="password" type="password" autocomplete="current-password" required>
            <span class="field-error" data-error-for="password"></span>
          </div>
          <label class="check-inline"><input type="checkbox" name="remember" id="remember"> จดจำฉันในอุปกรณ์นี้</label>
          <p class="small muted mb-0">หากเลือก ระบบจะคงสถานะเข้าสู่ระบบไว้สูงสุด 30 วัน ไม่ควรเลือกบนเครื่องสาธารณะ</p>
          <button class="btn btn-primary btn-lg w-full" type="submit">เข้าสู่ระบบ</button>
        </form>
        <p class="center mt-4 mb-0">ยังไม่มีบัญชี? <a href="/pages/register.html">สมัครสมาชิก</a></p>
      </div>
    </div>`;

  const form = qs('#login-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearFieldErrors(form);
    qs('#login-alert').innerHTML = '';
    const v = formToObject(form);
    const errs = [];
    if (!v.username) errs.push({ field: 'username', message: 'กรุณากรอกชื่อบัญชี' });
    if (!v.password) errs.push({ field: 'password', message: 'กรุณากรอกรหัสผ่าน' });
    if (errs.length) { showFieldErrors(form, errs); return; }
    const btn = qs('button[type="submit"]', form);
    setBusy(btn, true);
    try {
      await login(v.username.toLowerCase(), qs('#password').value, qs('#remember').checked);
      location.replace(safeNext());
    } catch (err) {
      qs('#login-alert').innerHTML = `<div class="alert alert-danger mb-4" role="alert">${icons.xCircle}<div>${esc(err.message)}</div></div>`;
      if (err.details) showFieldErrors(form, err.details);
    } finally {
      setBusy(btn, false);
    }
  });
}

// =====================================================================
// Register (personal / staff)
// =====================================================================
export async function initRegister() {
  const user = await getCurrentUser().catch(() => null);
  if (user) { location.replace('/pages/dashboard.html'); return; }
  const initialType = new URLSearchParams(location.search).get('type') === 'staff' ? 'staff' : 'personal';

  root().innerHTML = `
    <div class="auth-wrap">
      <div class="page-head center">
        <h1>สมัครสมาชิก EYE Check</h1>
        <p class="muted" style="margin:0 auto">เลือกประเภทบัญชีที่เหมาะกับการใช้งานของคุณ</p>
      </div>
      <div class="card fade-up">
        <form id="reg-form" novalidate>
          <fieldset class="fieldset">
            <legend>ประเภทบัญชี</legend>
            <div class="account-type-grid">
              <label class="choice account-type"><input type="radio" name="account_type" value="personal" ${initialType === 'personal' ? 'checked' : ''}>
                <span><span class="choice-title">${icons.user.replace('<svg', '<svg width="18" height="18" style="display:inline;vertical-align:-3px"')} บัญชีส่วนบุคคล</span>
                <span class="choice-guide">สำหรับประชาชนทั่วไปที่ต้องการตรวจคัดกรองดวงตาของตนเอง</span></span></label>
              <label class="choice account-type"><input type="radio" name="account_type" value="staff" ${initialType === 'staff' ? 'checked' : ''}>
                <span><span class="choice-title">${icons.users.replace('<svg', '<svg width="18" height="18" style="display:inline;vertical-align:-3px"')} บัญชี อสม./เจ้าหน้าที่</span>
                <span class="choice-guide">ตรวจคัดกรองให้ประชาชนหลายคน ต้องมีโค้ดสมัครจากหน่วยงาน</span></span></label>
            </div>
          </fieldset>
          <div id="reg-alert"></div>
          <div class="form-grid">
            <div class="field full">
              <label for="full_name" class="required">ชื่อ-นามสกุล</label>
              <input class="input" id="full_name" name="full_name" autocomplete="name" required maxlength="150">
              <span class="field-error" data-error-for="full_name"></span>
            </div>
            <div class="field full">
              <label for="username" class="required">ชื่อบัญชี (Username)</label>
              <input class="input" id="username" name="username" autocomplete="username" required maxlength="30" autocapitalize="none" spellcheck="false" pattern="[a-z0-9_.]{3,30}">
              <span class="hint">a-z, 0-9, _ หรือ . ความยาว 3–30 ตัว</span>
              <span class="field-error" data-error-for="username"></span>
            </div>
            <div class="field personal-only">
              <label for="birth_date" class="required">วัน/เดือน/ปีเกิด</label>
              <input class="input" id="birth_date" name="birth_date" type="date" required>
              <span class="hint" id="age-out">อายุ: -</span>
              <span class="field-error" data-error-for="birth_date"></span>
            </div>
            <div class="field personal-only">
              <label for="gender" class="required">เพศ</label>
              <select class="select" id="gender" name="gender" required>${genderOptions()}</select>
              <span class="field-error" data-error-for="gender"></span>
            </div>
            <div class="field staff-only">
              <label for="position" class="required">ตำแหน่ง</label>
              <input class="input" id="position" name="position" maxlength="120" placeholder="เช่น อสม., พยาบาลวิชาชีพ">
              <span class="field-error" data-error-for="position"></span>
            </div>
            <div class="field staff-only">
              <label for="workplace" class="required">สถานที่ทำงาน</label>
              <input class="input" id="workplace" name="workplace" maxlength="200" placeholder="เช่น รพ.สต. ...">
              <span class="field-error" data-error-for="workplace"></span>
            </div>
            <div class="field">
              <label for="password" class="required">รหัสผ่าน</label>
              <input class="input" id="password" name="password" type="password" autocomplete="new-password" required minlength="8">
              <span class="hint">${passwordHint()}</span>
              <span class="field-error" data-error-for="password"></span>
            </div>
            <div class="field">
              <label for="confirm_password" class="required">ยืนยันรหัสผ่าน</label>
              <input class="input" id="confirm_password" name="confirm_password" type="password" autocomplete="new-password" required>
              <span class="field-error" data-error-for="confirm_password"></span>
            </div>
            <div class="field full staff-only">
              <label for="registration_code" class="required">โค้ดสำหรับสมัครบัญชีเจ้าหน้าที่</label>
              <input class="input" id="registration_code" name="registration_code" autocomplete="off" maxlength="64" placeholder="STAFF-XXXX-XXXX-XXXX" style="text-transform:uppercase">
              <span class="hint">รับโค้ดจากผู้ดูแลระบบหรือหน่วยงานต้นสังกัด ระบบจะตรวจสอบโค้ดกับเซิร์ฟเวอร์</span>
              <span class="field-error" data-error-for="registration_code"></span>
            </div>
            <div class="field full">
              <label class="check-inline"><input type="checkbox" name="accept_terms" id="accept_terms" required>
                <span>ข้าพเจ้ายอมรับ <a href="/pages/terms.html" target="_blank" rel="noopener">ข้อกำหนดการใช้งาน</a> และ <a href="/pages/privacy.html" target="_blank" rel="noopener">นโยบายความเป็นส่วนตัว</a> และยินยอมให้ประมวลผลข้อมูลสุขภาพเพื่อการตรวจคัดกรอง</span></label>
              <span class="field-error" data-error-for="accept_terms"></span>
            </div>
          </div>
          <button class="btn btn-primary btn-lg w-full mt-5" type="submit">สมัครสมาชิก</button>
          <p class="center mt-4 mb-0">มีบัญชีอยู่แล้ว? <a href="/pages/login.html">เข้าสู่ระบบ</a></p>
        </form>
      </div>
    </div>`;

  const form = qs('#reg-form');
  const birth = qs('#birth_date');
  birth.max = new Date().toISOString().slice(0, 10);
  birth.addEventListener('change', () => {
    const a = calcAge(birth.value);
    qs('#age-out').textContent = `อายุ: ${a ?? '-'} ปี (คำนวณจากวันเกิดอัตโนมัติ)`;
  });

  const applyType = () => {
    const type = form.account_type.value;
    form.querySelectorAll('.personal-only').forEach((el) => el.classList.toggle('hidden', type !== 'personal'));
    form.querySelectorAll('.staff-only').forEach((el) => el.classList.toggle('hidden', type !== 'staff'));
  };
  form.querySelectorAll('[name="account_type"]').forEach((r) => r.addEventListener('change', applyType));
  applyType();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearFieldErrors(form);
    qs('#reg-alert').innerHTML = '';
    const v = formToObject(form);
    const type = v.account_type;
    const payload = {
      account_type: type,
      full_name: v.full_name,
      username: (v.username || '').toLowerCase(),
      password: qs('#password').value,
      confirm_password: qs('#confirm_password').value,
      accept_terms: qs('#accept_terms').checked,
      ...(type === 'personal' ? { birth_date: v.birth_date, gender: v.gender } : { position: v.position, workplace: v.workplace, registration_code: (v.registration_code || '').toUpperCase() }),
    };
    // client-side validation (server validates again)
    const errs = [];
    if (!payload.full_name || payload.full_name.length < 2) errs.push({ field: 'full_name', message: 'กรุณากรอกชื่อ-นามสกุล' });
    if (!/^[a-z0-9_.]{3,30}$/.test(payload.username)) errs.push({ field: 'username', message: 'ชื่อบัญชีไม่ถูกต้อง' });
    if (type === 'personal' && !payload.birth_date) errs.push({ field: 'birth_date', message: 'กรุณาระบุวันเกิด' });
    if (type === 'personal' && !payload.gender) errs.push({ field: 'gender', message: 'กรุณาเลือกเพศ' });
    if (type === 'staff' && !payload.position) errs.push({ field: 'position', message: 'กรุณาระบุตำแหน่ง' });
    if (type === 'staff' && !payload.workplace) errs.push({ field: 'workplace', message: 'กรุณาระบุสถานที่ทำงาน' });
    if (type === 'staff' && !payload.registration_code) errs.push({ field: 'registration_code', message: 'กรุณากรอกโค้ดสมัครบัญชีเจ้าหน้าที่' });
    if (payload.password.length < 8 || !/[A-Za-z]/.test(payload.password) || !/\d/.test(payload.password)) errs.push({ field: 'password', message: passwordHint() });
    if (payload.password !== payload.confirm_password) errs.push({ field: 'confirm_password', message: 'รหัสผ่านทั้งสองช่องไม่ตรงกัน' });
    if (!payload.accept_terms) errs.push({ field: 'accept_terms', message: 'กรุณายอมรับข้อกำหนดและนโยบาย' });
    if (errs.length) { showFieldErrors(form, errs); return; }

    const btn = qs('button[type="submit"]', form);
    setBusy(btn, true);
    try {
      await register(payload);
      await login(payload.username, payload.password, false);
      toast('สมัครสมาชิกสำเร็จ', 'success');
      location.replace(type === 'personal' ? '/pages/medical-history.html' : '/pages/patients.html');
    } catch (err) {
      qs('#reg-alert').innerHTML = `<div class="alert alert-danger mb-4" role="alert">${icons.xCircle}<div>${esc(err.message)}</div></div>`;
      if (err.code === 'INVALID_REGISTRATION_CODE') showFieldErrors(form, [{ field: 'registration_code', message: err.message }]);
      if (err.code === 'USERNAME_TAKEN') showFieldErrors(form, [{ field: 'username', message: err.message }]);
      if (err.details) showFieldErrors(form, err.details);
    } finally {
      setBusy(btn, false);
    }
  });
}

// =====================================================================
// Profile: edit info, change password, consents, delete account
// =====================================================================
export async function initProfile() {
  let user;
  try { user = await requireUser(); } catch (err) { renderErrorState(root(), err); return; }
  const isPersonal = user.account_type === 'personal';

  root().innerHTML = `
    <div class="page-head"><h1>ข้อมูลส่วนตัว</h1><p>จัดการข้อมูลบัญชี รหัสผ่าน และความยินยอมในการใช้ข้อมูล</p></div>
    <div class="grid grid-2">
      <section class="card" aria-labelledby="h-info">
        <div class="card-title"><div class="icon-bubble">${icons.user}</div><h2 id="h-info">ข้อมูลบัญชี</h2></div>
        <dl class="kv mb-4">
          <dt>ชื่อบัญชี</dt><dd>${esc(user.username)}</dd>
          <dt>ประเภทบัญชี</dt><dd>${esc(ACCOUNT_TYPES[user.account_type])}${user.role === 'admin' ? ' · <span class="badge badge-primary">ผู้ดูแลระบบ</span>' : ''}</dd>
          <dt>สมัครเมื่อ</dt><dd>${formatDate(user.created_at)}</dd>
        </dl>
        <form id="profile-form" novalidate class="stack">
          <div class="field"><label for="full_name" class="required">ชื่อ-นามสกุล</label>
            <input class="input" id="full_name" name="full_name" value="${esc(user.full_name)}" required maxlength="150">
            <span class="field-error" data-error-for="full_name"></span></div>
          ${isPersonal ? `
          <div class="form-grid">
            <div class="field"><label for="birth_date" class="required">วันเกิด</label>
              <input class="input" id="birth_date" name="birth_date" type="date" value="${esc(user.birth_date ?? '')}" required>
              <span class="hint" id="age-out">อายุ ${esc(user.age ?? '-')} ปี</span>
              <span class="field-error" data-error-for="birth_date"></span></div>
            <div class="field"><label for="gender" class="required">เพศ</label>
              <select class="select" id="gender" name="gender">${genderOptions(user.gender)}</select>
              <span class="field-error" data-error-for="gender"></span></div>
          </div>` : `
          <div class="form-grid">
            <div class="field"><label for="position" class="required">ตำแหน่ง</label>
              <input class="input" id="position" name="position" value="${esc(user.position ?? '')}" maxlength="120">
              <span class="field-error" data-error-for="position"></span></div>
            <div class="field"><label for="workplace" class="required">สถานที่ทำงาน</label>
              <input class="input" id="workplace" name="workplace" value="${esc(user.workplace ?? '')}" maxlength="200">
              <span class="field-error" data-error-for="workplace"></span></div>
          </div>`}
          <button class="btn btn-primary" type="submit">${icons.save}บันทึกข้อมูล</button>
        </form>
      </section>

      <section class="card" aria-labelledby="h-pw">
        <div class="card-title"><div class="icon-bubble">${icons.key}</div><h2 id="h-pw">เปลี่ยนรหัสผ่าน</h2></div>
        <form id="pw-form" novalidate class="stack">
          <div class="field"><label for="current_password" class="required">รหัสผ่านปัจจุบัน</label>
            <input class="input" id="current_password" name="current_password" type="password" autocomplete="current-password" required>
            <span class="field-error" data-error-for="current_password"></span></div>
          <div class="field"><label for="new_password" class="required">รหัสผ่านใหม่</label>
            <input class="input" id="new_password" name="new_password" type="password" autocomplete="new-password" required>
            <span class="hint">${passwordHint()}</span>
            <span class="field-error" data-error-for="new_password"></span></div>
          <div class="field"><label for="confirm_password2" class="required">ยืนยันรหัสผ่านใหม่</label>
            <input class="input" id="confirm_password2" name="confirm_password" type="password" autocomplete="new-password" required>
            <span class="field-error" data-error-for="confirm_password"></span></div>
          <button class="btn btn-primary" type="submit">${icons.key}เปลี่ยนรหัสผ่าน</button>
        </form>
        ${isPersonal ? `<hr><a class="btn w-full" href="/pages/medical-history.html?edit=1">${icons.clipboard}ดู/แก้ไขประวัติสุขภาพของฉัน</a>` : `<hr><a class="btn w-full" href="/pages/patients.html">${icons.users}จัดการรายชื่อผู้เข้ารับการตรวจ</a>`}
      </section>
    </div>

    <section class="card mt-5" id="consents" aria-labelledby="h-consent">
      <div class="card-title"><div class="icon-bubble accent">${icons.shield}</div><h2 id="h-consent">ความยินยอมและข้อมูลส่วนบุคคล (PDPA)</h2></div>
      <p class="text-2">คุณสามารถเพิกถอนความยินยอมการใช้ภาพดวงตาเพื่อพัฒนา AI ได้ทุกเมื่อ เมื่อเพิกถอนแล้ว ระบบจะลบภาพออกจากคลังข้อมูลฝึก AI ทันที</p>
      <div id="consent-list"></div>
    </section>

    <section class="card mt-5" aria-labelledby="h-del" style="border-color:#f2b8b8">
      <div class="card-title"><div class="icon-bubble" style="background:var(--danger-50);color:var(--danger)">${icons.trash}</div><h2 id="h-del">ลบบัญชีและข้อมูลทั้งหมด</h2></div>
      <p class="text-2">ลบบัญชี ประวัติสุขภาพ ผลการตรวจ ภาพดวงตา${isPersonal ? '' : ' และรายชื่อผู้เข้ารับการตรวจทั้งหมดที่คุณบันทึก'} อย่างถาวร ไม่สามารถกู้คืนได้</p>
      <button class="btn btn-outline-danger" type="button" id="btn-delete-account">${icons.trash}ลบบัญชีของฉัน</button>
    </section>`;

  // profile
  const pf = qs('#profile-form');
  qs('#birth_date', pf)?.addEventListener('change', (e) => { qs('#age-out').textContent = `อายุ ${calcAge(e.target.value) ?? '-'} ปี`; });
  pf.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearFieldErrors(pf);
    const v = formToObject(pf);
    const btn = qs('button[type="submit"]', pf);
    setBusy(btn, true);
    try {
      await api.put('/profiles/me', v);
      await getCurrentUser({ refresh: true });
      toast('บันทึกข้อมูลส่วนตัวแล้ว', 'success');
    } catch (err) {
      toast(err.message, 'error');
      if (err.details) showFieldErrors(pf, err.details);
    } finally { setBusy(btn, false); }
  });

  // password
  const pw = qs('#pw-form');
  pw.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearFieldErrors(pw);
    const body = { current_password: qs('#current_password').value, new_password: qs('#new_password').value, confirm_password: qs('#confirm_password2').value };
    if (body.new_password !== body.confirm_password) { showFieldErrors(pw, [{ field: 'confirm_password', message: 'รหัสผ่านใหม่ทั้งสองช่องไม่ตรงกัน' }]); return; }
    const btn = qs('button[type="submit"]', pw);
    setBusy(btn, true);
    try {
      await api.post('/auth/change-password', body);
      pw.reset();
      toast('เปลี่ยนรหัสผ่านสำเร็จ', 'success');
    } catch (err) {
      toast(err.message, 'error');
      if (err.code === 'WRONG_PASSWORD') showFieldErrors(pw, [{ field: 'current_password', message: err.message }]);
      if (err.details) showFieldErrors(pw, err.details);
    } finally { setBusy(btn, false); }
  });

  // consents
  const list = qs('#consent-list');
  const loadConsents = async () => {
    renderState(list, { type: 'loading', skeleton: 'table', rows: 3 });
    try {
      const rows = await api.get('/consents');
      if (!rows.length) { renderState(list, { type: 'empty', message: 'ยังไม่มีรายการความยินยอม' }); return; }
      list.innerHTML = `<div class="table-wrap"><table class="table stack-sm"><thead><tr><th>ประเภท</th><th>อ้างอิง</th><th>สถานะ</th><th>วันที่</th><th class="sr-only">การดำเนินการ</th></tr></thead><tbody>
        ${rows.map((c) => `<tr>
          <td data-label="ประเภท">${c.consent_type === 'dataset_image_use' ? 'ใช้ภาพดวงตาเพื่อพัฒนา AI' : 'การประมวลผลข้อมูลเพื่อให้บริการ'} <span class="muted small">v${esc(c.consent_version)}</span></td>
          <td data-label="อ้างอิง">${esc(c.screenings?.screening_code ?? '-')}${c.patients?.full_name ? ` · ${esc(c.patients.full_name)}` : ''}</td>
          <td data-label="สถานะ">${c.consent_status === 'granted' ? '<span class="badge badge-success">ยินยอม</span>' : c.consent_status === 'withdrawn' ? '<span class="badge badge-muted">เพิกถอนแล้ว</span>' : '<span class="badge badge-muted">ไม่ยินยอม</span>'}</td>
          <td data-label="วันที่">${formatDateTime(c.withdrawn_at ?? c.consent_date)}</td>
          <td class="actions">${c.consent_status === 'granted' && c.consent_type === 'dataset_image_use' ? `<button class="btn btn-sm btn-outline-danger" data-withdraw="${esc(c.id)}">เพิกถอน</button>` : ''}</td>
        </tr>`).join('')}</tbody></table></div>`;
    } catch (err) {
      renderErrorState(list, err, loadConsents);
    }
  };
  list.addEventListener('click', async (e) => {
    const id = e.target.closest('[data-withdraw]')?.dataset.withdraw;
    if (!id) return;
    const ok = await confirmDialog({ title: 'เพิกถอนความยินยอม', message: 'ระบบจะลบภาพนี้ออกจากคลังข้อมูลสำหรับพัฒนา AI ทันที (ผลการตรวจของคุณยังคงอยู่) ต้องการดำเนินการหรือไม่?', confirmText: 'เพิกถอน', danger: true });
    if (!ok) return;
    try {
      const r = await api.post(`/consents/${id}/withdraw`);
      toast(`เพิกถอนแล้ว ลบภาพออกจากคลังข้อมูล ${r.dataset_images_removed} ภาพ${r.roboflow_pending_removal ? ' (ภาพที่ส่งไป Roboflow แล้วจะถูกผู้ดูแลระบบลบต่อ)' : ''}`, 'success', 7000);
      loadConsents();
    } catch (err) { toast(err.message, 'error'); }
  });
  loadConsents();

  // delete account
  qs('#btn-delete-account').addEventListener('click', async () => {
    const ok = await confirmDialog({ title: 'ลบบัญชีถาวร', message: 'ข้อมูลทั้งหมดจะถูกลบและไม่สามารถกู้คืนได้', confirmText: 'ดำเนินการต่อ', danger: true, requireText: 'DELETE' });
    if (!ok) return;
    const password = await promptDialog({ title: 'ยืนยันตัวตน', label: 'กรุณากรอกรหัสผ่านเพื่อยืนยันการลบบัญชี', type: 'password', autocomplete: 'current-password', confirmText: 'ลบบัญชีถาวร', danger: true });
    if (!password) return;
    try {
      await api.del('/profiles/me', { password, confirm: 'DELETE' });
      clearCurrentUser();
      sessionStorage.clear();
      alert('ลบบัญชีและข้อมูลทั้งหมดเรียบร้อยแล้ว');
      location.href = '/';
    } catch (err) { toast(err.message, 'error'); }
  });
}
