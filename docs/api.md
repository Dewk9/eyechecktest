# REST API

Base URL `/api`. All responses:
```json
{ "success": true, "data": … }
{ "success": false, "error": { "code": "VALIDATION_ERROR", "message": "ข้อความภาษาไทย", "details": [{ "field": "...", "message": "..." }], "requestId": "…" } }
```
- Auth: httpOnly cookies `ec_at` / `ec_rt` (set by `/auth/login`). No tokens in JS.
- CSRF: every non-GET request must send `X-Requested-With: EyeCheck`; foreign `Origin` is rejected.
- Rate limits: 300 req/min/IP global; 20/15 min for login/register/password; 40/10 min per user for screening upload + analysis.
- All input is validated with zod (`backend/src/validators/schemas.js`); `:id` params must be UUIDs.

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | /auth/register | – | personal or staff (staff requires valid `registration_code`); role is never accepted |
| POST | /auth/login | – | `{username,password,remember}` |
| POST | /auth/logout | – | revokes the Supabase session |
| GET | /auth/me | – | `null` when signed out |
| POST | /auth/change-password | user | |
| GET/PUT/DELETE | /profiles/me | user | DELETE = erase account + all data (`{password, confirm:"DELETE"}`) |
| GET/POST | /patients | staff | search + pagination |
| GET/PUT/DELETE | /patients/:id | staff (owner) | DELETE cascades screenings + images |
| POST | /medical-history | user | personal: once (409 afterwards); staff: `patient_id` required, every screening |
| GET | /medical-history/me | personal | |
| GET | /medical-history/:patientId | staff | list per patient |
| GET | /medical-history/record/:id | user | |
| PUT | /medical-history/:id | user | |
| GET | /vision-tests/criteria | – | documented cut-offs |
| POST/GET | /vision-tests | user | summary computed server-side |
| GET | /vision-tests/:id · /vision-tests/screening/:screeningId | user | |
| POST | /screenings | user | multipart `image` (+ `eye_side, medical_history_id, patient_id?, vision_test_id?, dataset_consent`). Server re-checks file type by bytes, strips EXIF, runs quality gate (422 `IMAGE_QUALITY_FAILED` with details) |
| GET | /screenings | user | `search, from, to, disease, risk, patient_id, saved, sort, order, page, pageSize` |
| GET/DELETE | /screenings/:id | user | |
| POST | /ai/analyze | user | `{screening_id}` → Roboflow inference + rule-based assessment. `ai_status`: completed / insufficient_confidence / not_connected / failed |
| GET | /ai/status | – | connection, active model, supported diseases (no secrets) |
| GET | /ai/models | user | |
| GET | /results/:screeningId | user | full result (signed image URL, predictions, separated assessments) |
| POST | /results/:screeningId/save | user | |
| GET | /consents · /consents/version | user / – | |
| POST | /consents/:id/withdraw | user | deletes consented dataset copies |
| GET | /dashboard/personal · /dashboard/staff | personal / staff | `from, to, disease, count_by=screening|person` |
| POST | /activity/track | – | anonymous `page_view` / `page_leave` |

### Admin (`/api/admin/*`, administrator only)
| Method | Path | Notes |
|---|---|---|
| GET | /statistics · /health · /dashboard | overview, daily visitors/registrations/scans, system health |
| GET | /users · /users/:id | filters `account_type, role, status, search` |
| PATCH | /users/:id/status · /users/:id/role | suspend also bans in Supabase Auth; cannot act on self |
| GET | /activity | audit log |
| GET | /screenings · /screenings/:id | image only if consent granted |
| GET/POST/PATCH/DELETE | /registration-codes[/:id] | create: `expires_at` (ISO date-time with offset, e.g. `2026-11-30T23:59:00+07:00`, or legacy `YYYY-MM-DD` = 23:59 Bangkok) or `expires_in_days` (1/7/30/90), optional `code` (from /new-code), `status`; rows include server-derived `state` (active/expired/disabled/fully_used) and `has_code` |
| GET | /registration-codes/new-code | system-generated code for the create dialog |
| GET | /registration-codes/:id/reveal | decrypts the stored code (AES-256-GCM, needs migration 006); every reveal is written to activity_logs |
| GET/PUT | /settings | confidence threshold (+ validated flag) |
| GET | /roboflow/status · workspaces · projects · datasets · models · versions/:v | live Roboflow data |
| PUT | /roboflow/active-model | only versions with a trained model |
| GET/DELETE | /roboflow/images[/:imageId] | search / detail / delete (501 if Roboflow API refuses) |
| POST | /roboflow/upload · generate-version · train | upstream response returned as-is |
| GET/POST | /datasets · /datasets/summary | consented images only |
| GET/PUT/DELETE | /datasets/:id | PUT = re-classify approved image |
| POST | /datasets/:id/approve · reject · send-to-roboflow | class set only by reviewer |
