# Setup & Deployment

## 1. Requirements
- Node.js ≥ 20.10 (tested on 24)
- A Supabase project (free tier works) — use **separate projects** for development/testing and production
- A Roboflow workspace with a project containing the eye-disease classes and at least one **trained** version (optional; without it AI reports *Not Connected*)

## 2. Supabase
1. Create a project → **Project Settings → API**: copy `Project URL`, `anon` key, `service_role` key.
2. **Project Settings → Database → Connection string (URI)** → `SUPABASE_DB_URL` (only needed for `npm run db:migrate`).
3. Apply the migrations (choose one):
   - `cd backend && npm run db:migrate` (tracked in `public.schema_migrations`), or
   - paste `database/migrations/001…004` into the SQL Editor **in order**.
4. Authentication → Providers → Email: keep enabled. E-mail confirmation can stay on — the backend creates users with `email_confirm: true` and never sends mail. Usernames map to `username@AUTH_EMAIL_DOMAIN`.
5. Storage: the migration creates two **private** buckets `screening-images` and `eye-datasets`. Do not make them public.

## 3. Roboflow
**Workflow models (e.g. DINOv3) — recommended / current setup**
1. Roboflow → your Workflow → **Deploy → Cloud API** → copy the URL exactly → `ROBOFLOW_WORKFLOW_URL`
   (format `https://serverless.roboflow.com/<workspace>/workflows/<workflow-id>`; never substitute `api.roboflow.com`).
2. `ROBOFLOW_API_KEY` = Private API Key. The backend sends it as `Authorization: Bearer …` with `{ "inputs": { "image": { "type": "base64", … } } }`.
3. `ROBOFLOW_TIMEOUT_MS=30000`. Keep `ROBOFLOW_WORKSPACE / PROJECT / MODEL_VERSION` for dataset/admin pages.
4. Verify: `npm run test:roboflow` (live; add `-- --image path/to/eye.jpg` to test a real photo). Status codes:
   `CONNECTED`, `API_KEY_INVALID`, `WORKFLOW_NOT_FOUND`, `INFERENCE_FAILED`, `TIMEOUT`, `CONFIG_MISSING`.
5. Supported diseases are taken from the classes the deployed model really returns (not from the project class list).
   Roboflow's REST API reports `model: null` for Workflow-deployed versions — this does not mean "untrained".

**Legacy hosted models (no Workflow URL)**
1. Workspace → **Settings → API Keys** → copy the *Private API Key* → `ROBOFLOW_API_KEY`.
2. `ROBOFLOW_WORKSPACE` = workspace URL slug, `ROBOFLOW_PROJECT` = project slug, `ROBOFLOW_MODEL_VERSION` = trained version number.
3. Class names should contain `cataract`, `pterygium`, `pinguecula`, `glaucoma` (Thai names also work) and optionally `normal`. Other classes are shown as *Other / Unknown*. Mapping: `ai/roboflow/class-map.js`.
4. After start-up an admin can switch project/version in **Admin → Roboflow Connection** (only versions with a trained model can be activated).

## 4. Environment
```bash
cd backend
cp .env.example .env              # development
cp .env.example .env.test         # integration tests (separate Supabase project!)
cp .env.example .env.production   # production
```
Load order: `.env.<NODE_ENV>.local` → `.env.<NODE_ENV>` → `.env` (first value wins). The server **refuses to start** if required values are missing/invalid; `npm run check-config` additionally tests live connectivity.

Generate `JWT_SECRET`:
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

## 5. First accounts
```bash
npm run create-admin -- --username admin01 --name "ผู้ดูแลระบบ" --password "Strong-Pass-2026"
npm run create-admin -- --username somchai --promote     # promote an existing account
npm run create-staff-code -- --label "รพ.สต. บ้านหนองบัว" --limit 20 --expires 2026-12-31
```
Admins can also create/disable staff codes in **Admin → โค้ดสมัครเจ้าหน้าที่**. Nobody can self-register as admin.

## 6. Run
```bash
npm run dev    # watch mode
npm start
```
The backend serves the frontend (same origin) at `http://localhost:3000`. Camera access requires **HTTPS or localhost**.

## 7. Production deployment
- `NODE_ENV=production`, `COOKIE_SECURE=true`, `FORCE_HTTPS=true`, `TRUST_PROXY=true` (behind a reverse proxy / PaaS), `FRONTEND_URL=https://your-domain`.
- Terminate TLS at the proxy (Nginx, Caddy, Render, Railway, Fly.io…). HSTS is enabled automatically with `FORCE_HTTPS`.
- Run with a process manager (`pm2 start src/server.js --name eyecheck`) or the platform's Node runtime; `npm ci --omit=dev`.
- Example Nginx block:
  ```nginx
  server {
    listen 443 ssl http2; server_name eyecheck.example.org;
    client_max_body_size 10m;
    location / { proxy_pass http://127.0.0.1:3000; proxy_set_header Host $host;
                 proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for; proxy_set_header X-Forwarded-Proto $scheme; }
  }
  ```
- Rotate the Supabase service-role key and Roboflow key if they are ever exposed. Back up the database (Supabase PITR / scheduled dumps).
- Fill in the data-controller / DPO details in `frontend/pages/privacy.html` before going live.

## 8. Tests
```bash
npm test                    # 40 unit/HTTP tests, no external services
NODE_ENV=test npm run test:integration   # RLS isolation against the .env.test Supabase project
```
