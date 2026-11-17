-- =====================================================================
-- EYE Check — 003 Supabase Storage buckets
-- Both buckets are PRIVATE. No storage.objects policies are created for
-- the authenticated/anon roles, so files can only be written/read by the
-- backend (service role). Browsers receive short-lived Signed URLs only
-- after the backend has checked ownership / consent.
--
-- Layout
--   screening-images/<user_id>/<uuid>.<ext>
--   eye-datasets/pending-review/<uuid>.<ext>
--   eye-datasets/approved/<class>/<uuid>.<ext>   (class = pinguecula|cataract|glaucoma|pterygium|normal|other)
--   eye-datasets/rejected/<uuid>.<ext>
-- File names are always random UUIDs — never names or personal data.
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('screening-images', 'screening-images', false, 10485760, array['image/jpeg','image/png','image/webp']),
  ('eye-datasets',     'eye-datasets',     false, 10485760, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
