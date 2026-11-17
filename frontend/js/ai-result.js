/**
 * Screening result page. AI model confidence, medical-history risk,
 * vision-test summary and the overall recommendation are shown as SEPARATE
 * sections with their source labelled — nothing is blended or invented.
 */
import { api } from './api.js';
import { icons } from './icons.js';
import { qs, esc, toast, setBusy, renderErrorState, renderState, formatDateTime, pct, param, aiStatusBadge } from './ui.js';
import { requireUser } from './auth.js';
import { getWorkflow, setWorkflow, resetWorkflow, renderStepper } from './workflow.js';
import { DISEASES, FINDINGS, RISK_LEVELS, EYE_SIDES, GENDERS } from './constants.js';

const root = () => qs('#page-root');

export async function init() {
  try { await requireUser(); } catch (err) { renderErrorState(root(), err); return; }
  const id = param('id') || getWorkflow().screeningId;
  if (!id) {
    renderState(root(), { type: 'empty', title: 'ยังไม่มีผลการตรวจ', message: 'กรุณาทำการตรวจคัดกรองก่อน หรือเลือกดูจากประวัติการตรวจ', action: { href: '/pages/history.html', label: 'ดูประวัติการตรวจ' } });
    return;
  }
  await load(id);
}

async function load(id) {
  renderState(root(), { type: 'loading', message: 'กำลังโหลดผลการตรวจ...' });
  let r;
  try { r = await api.get(`/results/${encodeURIComponent(id)}`); } catch (err) { renderErrorState(root(), err, () => load(id)); return; }
  render(r);
}

export function renderAiSection(r) {
  const s = r.screening;
  const ai = r.ai;
  if (!ai || ['not_connected', 'failed', 'pending', 'processing'].includes(s.ai_status)) {
    return `<div class="alert ${s.ai_status === 'not_connected' ? 'alert-warning' : 'alert-danger'}">${icons.alert}<div>
      <strong>${s.ai_status === 'not_connected' ? 'AI Not Connected' : s.ai_status === 'failed' ? 'การวิเคราะห์ด้วย AI ไม่สำเร็จ' : 'ยังไม่ได้วิเคราะห์ด้วย AI'}</strong>
      ${esc(s.ai_error ?? 'ไม่มีผลจากโมเดล จึงไม่แสดงค่าความมั่นใจใด ๆ')}</div></div>`;
  }
  const outcomeText = {
    finding: `ผลที่พบ: <strong>${esc(FINDINGS[ai.primary]?.th ?? ai.primary)}</strong>`,
    normal: '<strong>โมเดลจัดภาพนี้อยู่ในกลุ่มปกติ</strong>',
    no_finding: '<strong>ไม่พบรอยโรคที่โมเดลตรวจจับได้</strong>',
    insufficient_confidence: `<strong>Insufficient Confidence</strong> — ค่าความมั่นใจต่ำกว่าเกณฑ์ ${pct(ai.threshold)} จึงสรุปผลจากภาพไม่ได้`,
    unrecognized: '<strong>Inconclusive</strong> — ผลลัพธ์อยู่นอกคลาสโรคที่ระบบรองรับ',
  }[ai.outcome] ?? '';

  const rows = (ai.diseases ?? []).map((d) => {
    const label = `${DISEASES[d.disease].th} <span class="small muted">(${DISEASES[d.disease].en})</span>`;
    if (d.status === 'not_supported') return `<div class="conf-row"><span>${label}</span><span class="small muted">Not Supported — โมเดลนี้ไม่มีคลาสนี้</span><span class="conf-val">-</span></div>`;
    if (d.status === 'not_detected') return `<div class="conf-row"><span>${label}</span><span class="small muted">ไม่พบการตรวจจับจากโมเดล</span><span class="conf-val">-</span></div>`;
    const color = d.status === 'detected' ? DISEASES[d.disease].color : '#9aa9b8';
    return `<div class="conf-row"><span>${label}${d.status === 'detected' ? ' <span class="badge badge-warning">เกินเกณฑ์</span>' : ''}</span>
      <div class="conf-bar" role="img" aria-label="ความมั่นใจ ${pct(d.confidence)}"><span style="width:${(d.confidence * 100).toFixed(1)}%;background:${color}"></span></div>
      <span class="conf-val">${pct(d.confidence)}</span></div>`;
  }).join('');
  const glaucoma = (ai.diseases ?? []).find((d) => d.disease === 'glaucoma');

  return `
    <p>${outcomeText}</p>
    <div class="mb-3">${rows}
      ${ai.normal ? `<div class="conf-row"><span>ปกติ <span class="small muted">(${esc(ai.normal.className)})</span></span><div class="conf-bar"><span style="width:${(ai.normal.confidence * 100).toFixed(1)}%;background:#2fa77a"></span></div><span class="conf-val">${pct(ai.normal.confidence)}</span></div>` : ''}
      ${(ai.otherClasses ?? []).map((o) => `<div class="conf-row"><span>Other / Unknown <span class="small muted">(${esc(o.className)})</span></span><div class="conf-bar"><span style="width:${(o.confidence * 100).toFixed(1)}%;background:#9aa9b8"></span></div><span class="conf-val">${pct(o.confidence)}</span></div>`).join('')}
    </div>
    ${ai.kind === 'multilabel' ? `<p class="small muted">โมเดลแบบ Multi-label: ค่าความมั่นใจของแต่ละคลาสคำนวณแยกกัน จึงไม่จำเป็นต้องรวมกันได้ 100%${ai.predictedClasses?.length ? ` · คลาสที่โมเดลเลือก: ${ai.predictedClasses.map(esc).join(', ')}` : ''}</p>` : ''}
    ${glaucoma && glaucoma.supported ? `<div class="alert alert-info mb-3">${icons.info}<div><strong>หมายเหตุเรื่องต้อหิน</strong>ต้อหินไม่สามารถยืนยันหรือวินิจฉัยจากภาพถ่ายภายนอกของดวงตาได้ ต้องตรวจความดันตา ขั้วประสาทตา และลานสายตาโดยจักษุแพทย์</div></div>` : ''}
    <p class="small muted mb-0">ค่าความมั่นใจเป็นค่าจริงจากโมเดล ${esc(ai.model?.model_id ?? `${ai.model?.project ?? ''} เวอร์ชัน ${ai.model?.version ?? ''}`)} (${esc(ai.kind)}${ai.model?.mode === 'workflow' ? ', Roboflow Workflow' : ''}) ·
      เกณฑ์ความมั่นใจ ${pct(ai.threshold)}${ai.threshold_validated ? '' : ' (ยังไม่ผ่านการประเมินกับชุดข้อมูลทดสอบ)'} · วิเคราะห์เมื่อ ${formatDateTime(ai.analyzed_at)}</p>`;
}

function imageWithBoxes(r) {
  if (!r.image_url) return `<div class="state" style="padding:24px;color:#cbd5e1">${icons.lock}<p class="small">${esc(r.image_hidden_reason ?? 'ไม่มีภาพ')}</p></div>`;
  const ai = r.ai;
  const W = ai?.image?.width;
  const H = ai?.image?.height;
  const boxes = ai?.kind === 'detection' && W && H ? (ai.detections ?? []).filter((d) => d.confidence >= ai.threshold).map((d) => {
    const left = ((d.box.x - d.box.width / 2) / W) * 100;
    const top = ((d.box.y - d.box.height / 2) / H) * 100;
    return `<div class="box" style="left:${left}%;top:${top}%;width:${(d.box.width / W) * 100}%;height:${(d.box.height / H) * 100}%"><span>${esc(FINDINGS[d.disease]?.th ?? d.className)} ${pct(d.confidence)}</span></div>`;
  }).join('') : '';
  return `<img src="${esc(r.image_url)}" alt="ภาพดวงตาที่ใช้ตรวจ">${boxes}`;
}

function historySection(h) {
  if (!h?.available) return '<p class="muted">Insufficient Data — ไม่มีข้อมูลซักประวัติ</p>';
  return `<dl class="kv">
    <dt>ช่วงอายุ</dt><dd>${esc(h.age_group?.label ?? '-')}<br><span class="small muted">${esc(h.age_group?.guidance ?? '')}</span></dd>
    <dt>ปัจจัยเสี่ยง</dt><dd>${h.risk_factors?.length ? `<ul class="mb-0">${h.risk_factors.map((f) => `<li>${esc(f.label)}<br><span class="small muted">${esc(f.guidance)}</span></li>`).join('')}</ul>` : 'ไม่พบ'}</dd>
    <dt>อาการที่สัมพันธ์กับโรค</dt><dd>${h.symptoms?.length ? `<ul class="mb-0">${h.symptoms.map((f) => `<li>${esc(f.label)}<br><span class="small muted">${esc(f.guidance)}</span></li>`).join('')}</ul>` : 'ไม่มีอาการ'}</dd>
    ${h.emergency ? `<dt>อาการฉุกเฉิน</dt><dd><span class="badge risk-urgent">${icons.siren}พบ</span> ${esc(h.emergency.guidance)}</dd>` : ''}
    <dt>ซักประวัติเมื่อ</dt><dd>${formatDateTime(h.recorded_at)}</dd>
  </dl>`;
}

function visionSection(v) {
  if (!v?.available) return '<p class="muted">Insufficient Data — ไม่ได้ทดสอบการมองเห็นในการตรวจครั้งนี้</p>';
  const cell = (e) => `${e.abnormal === true ? '<span class="badge badge-warning">เกินเกณฑ์</span> ' : e.abnormal === false ? '<span class="badge badge-success">ผ่าน</span> ' : ''}${esc(e.text)}`;
  return `<div class="table-wrap"><table class="table stack-sm"><thead><tr><th>การทดสอบ</th><th>ตาขวา</th><th>ตาซ้าย</th></tr></thead><tbody>
    ${Object.values(v.tests).map((t) => `<tr><td data-label="การทดสอบ">${esc(t.label)}</td><td data-label="ตาขวา">${cell(t.right)}</td><td data-label="ตาซ้าย">${cell(t.left)}</td></tr>`).join('')}
  </tbody></table></div>
  <p class="small muted mt-2 mb-0">ทดสอบผ่านหน้าจอ ไม่ใช่การตรวจสายตามาตรฐาน · เกณฑ์ ${esc(v.criteria_version)} · ทดสอบเมื่อ ${formatDateTime(v.tested_at)}</p>`;
}

function render(r) {
  const s = r.screening;
  const ra = r.risk_assessment;
  const level = ra?.risk_level ?? 'inconclusive';
  const L = RISK_LEVELS[level];
  const rec = ra?.recommendation ?? {};
  const subj = r.subject;

  root().innerHTML = `
    <div class="print-only" style="margin-bottom:12px"><strong>EYE Check — รายงานผลการตรวจคัดกรองโรคต้อในดวงตา</strong></div>
    <div class="page-head row-between">
      <div><h1 class="mb-0">ผลการตรวจคัดกรอง</h1><p class="mb-0 muted">รหัสการตรวจ <strong class="mono">${esc(s.screening_code)}</strong> ${s.is_saved ? '<span class="badge badge-success">บันทึกแล้ว</span>' : '<span class="badge badge-warning">ยังไม่บันทึก</span>'}</p></div>
    </div>
    <div id="stepper" class="no-print"></div>

    <div class="risk-banner ${level} mb-5" role="status">
      ${icons[L.icon]}
      <div><span class="source-tag" style="color:inherit;opacity:.8">Overall Screening Recommendation</span>
        <h2>${esc(L.th)} <span class="small" style="font-weight:600">(${esc(L.en)})</span></h2>
        <p>${esc(rec.next_step ?? '')}</p></div>
    </div>

    <div class="result-head mb-5">
      <div class="result-image">${imageWithBoxes(r)}</div>
      <section class="card">
        <h2>ข้อมูลการตรวจ</h2>
        <dl class="kv">
          <dt>รหัสการตรวจ</dt><dd class="mono">${esc(s.screening_code)}</dd>
          <dt>วันที่และเวลาที่ตรวจ</dt><dd>${formatDateTime(s.screening_date)}</dd>
          <dt>ชื่อผู้เข้ารับการตรวจ</dt><dd>${esc(subj?.full_name ?? '-')}${subj?.age !== null && subj?.age !== undefined ? ` · อายุ ${esc(subj.age)} ปี` : ''}${subj?.gender ? ` · ${esc(GENDERS[subj.gender] ?? '')}` : ''}</dd>
          <dt>ตาข้างที่ตรวจ</dt><dd>${esc(EYE_SIDES[s.eye_side])}</dd>
          <dt>ประเภทการคัดกรอง</dt><dd>คัดกรองโรคต้อจากภาพถ่ายภายนอกดวงตา + ซักประวัติ${r.vision_test?.available ? ' + ทดสอบการมองเห็น' : ''}</dd>
          <dt>สถานะ AI</dt><dd>${aiStatusBadge(s.ai_status)} ${s.model_version ? `<span class="small muted">Model ${esc(s.model_project)} v${esc(s.model_version)}</span>` : ''}</dd>
        </dl>
      </section>
    </div>

    <div class="grid grid-2 mb-5">
      <section class="card" aria-labelledby="h-ai">
        <span class="source-tag">แหล่งข้อมูล 1 · AI Model Confidence</span>
        <h2 id="h-ai">ผลการวิเคราะห์ภาพด้วย AI</h2>
        ${renderAiSection(r)}
      </section>
      <section class="card" aria-labelledby="h-mh">
        <span class="source-tag">แหล่งข้อมูล 2 · Medical History Risk Assessment</span>
        <h2 id="h-mh">ผลการซักประวัติ</h2>
        ${historySection(r.medical_history)}
      </section>
    </div>

    <section class="card mb-5" aria-labelledby="h-vt">
      <span class="source-tag">แหล่งข้อมูล 3 · Vision Test Summary</span>
      <h2 id="h-vt">ผลการทดสอบการมองเห็น</h2>
      ${visionSection(r.vision_test)}
    </section>

    <section class="card mb-5" aria-labelledby="h-sum">
      <span class="source-tag">สรุปการประเมินประกอบ (แยกแหล่งข้อมูล)</span>
      <h2 id="h-sum">สรุปความเสี่ยง</h2>
      <dl class="kv">
        <dt>ระดับความเสี่ยง</dt><dd><span class="badge risk-${esc(level)}">${icons[L.icon]}${esc(L.th)}</span></dd>
        <dt>การเปรียบเทียบข้อมูล</dt><dd>${esc(rec.consistency?.text ?? '-')}</dd>
        <dt>ปัจจัยที่พบ</dt><dd>${ra?.risk_factors?.length ? `<ul class="mb-0">${ra.risk_factors.map((f) => `<li>${esc(f.label)}</li>`).join('')}</ul>` : 'ไม่พบ'}</dd>
        <dt>หลักเกณฑ์</dt><dd class="small">${esc(ra?.assessment_version ?? '-')} · กฎ ${esc(rec.rule ?? '-')} — เกณฑ์แบบกฎ (rule-based) ที่เปิดเผยได้ ${rec.validated ? '' : '<strong>ยังไม่ผ่านการตรวจสอบความถูกต้องทางคลินิก</strong>'} และไม่ได้นำค่าความมั่นใจของ AI มารวมกับคะแนนซักประวัติ</dd>
      </dl>
    </section>

    <section class="card mb-5" aria-labelledby="h-rec">
      <h2 id="h-rec">คำแนะนำเบื้องต้น</h2>
      <p><strong>${esc(rec.next_step ?? '')}</strong></p>
      ${(rec.diseases ?? []).map((d) => `<div class="mb-4"><h3>${esc(d.label)} <span class="small muted">${d.source === 'ai' ? '(จากผล AI)' : d.source === 'history' ? '(จากข้อมูลซักประวัติ/ทดสอบสายตา)' : '(จากผล AI และข้อมูลซักประวัติ)'}</span></h3>
        <ul class="list-check">${d.items.map((i) => `<li>${icons.check}<span>${esc(i)}</span></li>`).join('')}</ul>
        ${d.note ? `<p class="small muted">${esc(d.note)}</p>` : ''}</div>`).join('')}
      <h3>การดูแลสุขภาพดวงตาทั่วไป</h3>
      <ul class="list-check">${(rec.general ?? []).map((i) => `<li>${icons.check}<span>${esc(i)}</span></li>`).join('')}</ul>
    </section>

    <div class="disclaimer mb-5" role="note"><strong>Medical Disclaimer:</strong> ${esc(r.disclaimer)}</div>

    <details class="card mb-5 no-print"><summary><strong>ข้อมูลดิบจากโมเดล (${r.predictions.length} รายการ)</strong></summary>
      ${r.predictions.length ? `<div class="table-wrap mt-3"><table class="table"><thead><tr><th>Class</th><th>Mapped</th><th>Confidence</th><th>Bounding box</th></tr></thead><tbody>
        ${r.predictions.map((p) => `<tr><td>${esc(p.predicted_class)}</td><td>${esc(p.disease_key)}</td><td>${pct(Number(p.confidence_score))}</td><td class="small mono">${p.bounding_box ? esc(`x${Math.round(p.bounding_box.x)} y${Math.round(p.bounding_box.y)} ${Math.round(p.bounding_box.width)}×${Math.round(p.bounding_box.height)}`) : '-'}</td></tr>`).join('')}
      </tbody></table></div>` : '<p class="muted mt-3 mb-0">ไม่มีข้อมูลจากโมเดล</p>'}
    </details>

    <div class="result-actions no-print">
      <button class="btn btn-primary" id="btn-new">${icons.refresh}ตรวจใหม่</button>
      ${s.is_saved ? '' : `<button class="btn btn-accent" id="btn-save">${icons.save}บันทึกผลการตรวจ</button>`}
      <button class="btn" id="btn-print">${icons.printer}พิมพ์รายงาน</button>
      ${['not_connected', 'failed'].includes(s.ai_status) ? `<a class="btn" href="/pages/analyze.html" id="btn-reanalyze">${icons.cpu}วิเคราะห์ด้วย AI อีกครั้ง</a>` : ''}
      <a class="btn" href="/">${icons.home}กลับหน้าหลัก</a>
      <a class="btn" href="/pages/history.html">${icons.history}ดูประวัติการตรวจ</a>
    </div>`;

  if (getWorkflow().screeningId === s.id) renderStepper(qs('#stepper'), 'result');
  qs('#btn-print').addEventListener('click', () => window.print());
  qs('#btn-new').addEventListener('click', () => {
    const wf = getWorkflow();
    resetWorkflow({ subject: wf.subject });
    location.href = '/pages/medical-history.html';
  });
  qs('#btn-reanalyze')?.addEventListener('click', () => setWorkflow({ screeningId: s.id, analyzed: false }));
  qs('#btn-save')?.addEventListener('click', async (e) => {
    setBusy(e.currentTarget, true);
    try {
      await api.post(`/results/${s.id}/save`);
      if (getWorkflow().screeningId === s.id) setWorkflow({ saved: true });
      toast('บันทึกผลการตรวจแล้ว', 'success');
      load(s.id);
    } catch (err) {
      toast(err.message, 'error');
      setBusy(e.currentTarget, false);
    }
  });
}
