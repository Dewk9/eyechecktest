export function renderFooter() {
  const el = document.getElementById('site-footer');
  if (!el) return;
  el.className = 'site-footer';
  el.innerHTML = `
    <div class="container">
      <div class="footer-grid">
        <div>
          <h4>EYE Check</h4>
          <p>ระบบตรวจคัดกรองโรคต้อในดวงตาด้วยปัญญาประดิษฐ์ (AI Eye Disease Screening System)</p>
          <p class="small">ผลการวิเคราะห์เป็นเพียงการคัดกรองเบื้องต้น ไม่ใช่การวินิจฉัยทางการแพทย์ หากมีอาการผิดปกติควรพบจักษุแพทย์</p>
        </div>
        <div>
          <h4>เมนู</h4>
          <ul>
            <li><a href="/pages/medical-history.html">เริ่มตรวจคัดกรอง</a></li>
            <li><a href="/pages/history.html">ประวัติการตรวจ</a></li>
            <li><a href="/pages/dashboard.html">แดชบอร์ด</a></li>
            <li><a href="/pages/guide.html">คู่มือการใช้งาน</a></li>
          </ul>
        </div>
        <div>
          <h4>ข้อมูลและความเป็นส่วนตัว</h4>
          <ul>
            <li><a href="/pages/privacy.html">นโยบายความเป็นส่วนตัว (PDPA)</a></li>
            <li><a href="/pages/terms.html">ข้อกำหนดการใช้งาน</a></li>
            <li><a href="/pages/profile.html#consents">จัดการความยินยอม</a></li>
          </ul>
        </div>
      </div>
      <div class="footer-bottom">© ${new Date().getFullYear()} EYE Check · ไม่ใช้แทนการวินิจฉัยโดยจักษุแพทย์</div>
    </div>`;
}
