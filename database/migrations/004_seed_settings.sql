-- =====================================================================
-- EYE Check — 004 Default settings (no fake data — configuration only)
-- =====================================================================

insert into public.admin_settings (setting_key, setting_value) values
  ('ai_confidence_threshold', jsonb_build_object(
      'value', 0.6,
      'validated', false,
      'note', 'ค่าเริ่มต้น ต้องประเมินกับชุดข้อมูลทดสอบของโมเดลจริงก่อนใช้งานจริง')),
  ('consent_version', jsonb_build_object('value', '1.0')),
  ('active_model', 'null'::jsonb)
on conflict (setting_key) do nothing;
