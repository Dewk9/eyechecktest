# Database (Supabase PostgreSQL)

Source of truth: `database/migrations/*.sql` (applied in order). `schema.sql` / `policies.sql` are generated snapshots (`npm run db:snapshot`).

## Tables
| Table | Purpose | Key points |
|---|---|---|
| profiles | one row per auth user | `id = auth.users.id` (`auth_user_id` alias); `account_type` personal/staff; `role` user/admin; `status`; trigger blocks clients from changing role/type/status/username; age via `calc_age()` / view `v_profiles` |
| patients | people screened by staff | `owner_id`; unique (owner, name, birth date); age must match birth date (±1, checked in backend) |
| medical_histories | 3-part questionnaire | personal: unique per user (`patient_id is null`); staff: new row per screening |
| vision_tests | 6 tests × left/right (jsonb) | `summary`, `left_eye_result`, `right_eye_result` computed server-side |
| screenings | one image analysis | code `EC-YYYYMMDD-XXXXXX`; `ai_status`, `primary_finding`, `risk_level`, `is_saved` |
| ai_predictions | raw model output | one row per class (classification) or per box (detection), confidence exactly as returned |
| risk_assessments | rules-v1 output | separate `ai_summary`, `medical_history_summary`, `vision_test_summary` snapshots |
| screening_images | image file per screening | `consent_status` |
| dataset_images | consented images for AI | `suggested_class` (AI) vs `disease_class` (reviewer only); review & Roboflow status |
| consent_records | PDPA consents | `data_processing` (at sign-up), `dataset_image_use` (per screening); withdrawable |
| activity_logs | audit + anonymous analytics | no names/health data in `details`; visitor id is an HMAC |
| roboflow_projects | cached Roboflow metadata | one `is_active` row |
| admin_settings | key/value config | `ai_confidence_threshold`, `consent_version`, `active_model` |
| staff_registration_codes | HMAC hash (registration) + AES-256-GCM `code_encrypted` (admin view, migration 006; key from REGISTRATION_CODE_KEY or derived from JWT_SECRET) — never plain text; `expires_at` exact timestamptz | consumed atomically by `consume_staff_registration_code()` (service role only) |

## Security model
- **RLS is enabled on every table.** The backend queries user-owned data with the *user's JWT*, so Postgres enforces ownership on every request in addition to backend checks.
- Users may only insert *pending* screenings and may only update `is_saved/saved_at` (column grants). AI predictions, risk assessments, dataset, logs, settings and codes are written only by the service role.
- `is_admin()` (security definer) grants admins read access; admin writes go through the backend.
- Storage buckets are private with no client policies; the backend issues 10-minute signed URLs after checking ownership (admins: only consented images).
- File names are random UUIDs; EXIF/GPS is stripped by re-encoding.

## Deletion & consent
- Deleting a screening removes its image; a consented dataset copy remains until consent is withdrawn.
- Withdrawing image consent deletes dataset copies immediately; Roboflow ids already uploaded are logged (`consent_withdrawn` → `roboflow_images_to_remove`) for an admin to remove in Roboflow.
- Deleting an account cascades to all rows and removes all stored images.
