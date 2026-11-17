-- =====================================================================
-- EYE Check — 001 Initial schema
-- Target: Supabase PostgreSQL (auth schema provided by Supabase)
-- All primary keys are UUID. All timestamps are timestamptz.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Helper functions
-- ---------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Age in full years from a birth date (computed at query time, never stored stale)
create or replace function public.calc_age(p_birth date)
returns integer language sql stable as $$
  select case when p_birth is null then null
              else date_part('year', age(current_date, p_birth))::int end;
$$;

-- ---------------------------------------------------------------------
-- 1. profiles — one row per Supabase auth user
--    id == auth.users.id ; auth_user_id kept as an explicit alias column
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  auth_user_id  uuid generated always as (id) stored unique,
  full_name     text not null check (char_length(full_name) between 2 and 150),
  username      text not null unique check (username ~ '^[a-z0-9_.]{3,30}$'),
  birth_date    date check (birth_date is null or (birth_date > date '1900-01-01' and birth_date <= current_date)),
  gender        text check (gender is null or gender in ('male','female','other','unspecified')),
  account_type  text not null check (account_type in ('personal','staff')),
  position      text check (position is null or char_length(position) <= 120),
  workplace     text check (workplace is null or char_length(workplace) <= 200),
  role          text not null default 'user' check (role in ('user','admin')),
  status        text not null default 'active' check (status in ('active','suspended')),
  last_login_at timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint personal_requires_identity check (account_type <> 'personal' or (birth_date is not null and gender is not null)),
  constraint staff_requires_workplace  check (account_type <> 'staff' or (position is not null and workplace is not null))
);
create index if not exists idx_profiles_account_type on public.profiles(account_type);
create index if not exists idx_profiles_created_at on public.profiles(created_at desc);
create trigger trg_profiles_updated before update on public.profiles
  for each row execute function public.set_updated_at();

-- Block privilege escalation from client sessions: role / account_type / status / username
-- can only be changed by the service role (backend) or a direct DB admin.
create or replace function public.protect_profile_privileged_columns()
returns trigger language plpgsql as $$
begin
  if coalesce(auth.role(), '') in ('authenticated', 'anon') then
    if new.role is distinct from old.role
       or new.account_type is distinct from old.account_type
       or new.status is distinct from old.status
       or new.username is distinct from old.username then
      raise exception 'Not allowed to change privileged profile columns' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
create trigger trg_profiles_protect before update on public.profiles
  for each row execute function public.protect_profile_privileged_columns();

-- Convenience view with computed age
create or replace view public.v_profiles with (security_invoker = true) as
  select p.*, public.calc_age(p.birth_date) as age from public.profiles p;

-- ---------------------------------------------------------------------
-- 2. patients — people screened by staff accounts
-- ---------------------------------------------------------------------
create table if not exists public.patients (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references public.profiles(id) on delete cascade,
  full_name   text not null check (char_length(full_name) between 2 and 150),
  birth_date  date not null check (birth_date > date '1900-01-01' and birth_date <= current_date),
  age         integer not null check (age between 0 and 130),
  gender      text not null check (gender in ('male','female','other','unspecified')),
  notes       text check (notes is null or char_length(notes) <= 1000),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint uq_patient_per_owner unique (owner_id, full_name, birth_date)
);
create index if not exists idx_patients_owner on public.patients(owner_id);
create index if not exists idx_patients_name on public.patients(owner_id, full_name);
create trigger trg_patients_updated before update on public.patients
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- 3. medical_histories
--    personal: one editable row per user (patient_id is null)
--    staff: a new row for every screening (patient_id required)
-- ---------------------------------------------------------------------
create table if not exists public.medical_histories (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  uuid not null references public.profiles(id) on delete cascade,
  patient_id               uuid references public.patients(id) on delete cascade,
  age_group                text not null check (age_group in ('under_40','40_59','60_plus')),
  family_glaucoma_history  boolean not null default false,
  diabetes                 boolean not null default false,
  hypertension             boolean not null default false,
  steroid_use              boolean not null default false,
  outdoor_exposure         boolean not null default false,
  high_myopia              boolean not null default false,
  eye_injury               boolean not null default false,
  eye_symptoms             text[] not null default '{}'
    check (eye_symptoms <@ array['blurry_cloudy','glare_halos','peripheral_loss','irritation','tissue_growth']::text[]),
  emergency_symptoms       boolean not null default false,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);
create unique index if not exists uq_personal_history on public.medical_histories(user_id) where patient_id is null;
create index if not exists idx_mh_patient on public.medical_histories(patient_id, created_at desc);
create index if not exists idx_mh_user on public.medical_histories(user_id, created_at desc);
create trigger trg_mh_updated before update on public.medical_histories
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- 4. vision_tests — each test column stores { left: {...}, right: {...} }
-- ---------------------------------------------------------------------
create table if not exists public.vision_tests (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references public.profiles(id) on delete cascade,
  patient_id            uuid references public.patients(id) on delete cascade,
  left_eye_result       jsonb not null default '{}'::jsonb,
  right_eye_result      jsonb not null default '{}'::jsonb,
  visual_acuity         jsonb,
  color_vision          jsonb,
  central_visual_field  jsonb,
  visual_field          jsonb,
  near_vision           jsonb,
  contrast_sensitivity  jsonb,
  summary               jsonb not null default '{}'::jsonb,
  created_at            timestamptz not null default now()
);
create index if not exists idx_vt_user on public.vision_tests(user_id, created_at desc);
create index if not exists idx_vt_patient on public.vision_tests(patient_id, created_at desc);

-- ---------------------------------------------------------------------
-- 5. screenings
-- ---------------------------------------------------------------------
create table if not exists public.screenings (
  id                    uuid primary key default gen_random_uuid(),
  screening_code        text not null unique check (screening_code ~ '^EC-[0-9]{8}-[A-Z0-9]{6}$'),
  user_id               uuid not null references public.profiles(id) on delete cascade,
  patient_id            uuid references public.patients(id) on delete cascade,
  medical_history_id    uuid references public.medical_histories(id) on delete set null,
  vision_test_id        uuid references public.vision_tests(id) on delete set null,
  screening_date        timestamptz not null default now(),
  eye_side              text not null check (eye_side in ('left','right')),
  screening_type        text not null default 'external_eye_photo' check (screening_type in ('external_eye_photo')),
  image_path            text,
  image_quality_status  text not null default 'pending' check (image_quality_status in ('pending','passed','failed')),
  image_quality         jsonb,
  ai_status             text not null default 'pending'
    check (ai_status in ('pending','processing','completed','insufficient_confidence','failed','not_connected')),
  ai_error              text,
  model_project         text,
  model_version         text,
  primary_finding       text check (primary_finding is null or primary_finding in
    ('cataract','pterygium','pinguecula','glaucoma','normal','no_finding','inconclusive')),
  risk_level            text check (risk_level is null or risk_level in ('low','moderate','high','urgent','inconclusive')),
  dataset_consent       boolean not null default false,
  is_saved              boolean not null default false,
  saved_at              timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index if not exists idx_scr_user_date on public.screenings(user_id, screening_date desc);
create index if not exists idx_scr_patient_date on public.screenings(patient_id, screening_date desc);
create index if not exists idx_scr_finding on public.screenings(primary_finding);
create index if not exists idx_scr_risk on public.screenings(risk_level);
create index if not exists idx_scr_date on public.screenings(screening_date desc);
create trigger trg_scr_updated before update on public.screenings
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- 6. ai_predictions — one row per class returned by the model
-- ---------------------------------------------------------------------
create table if not exists public.ai_predictions (
  id                uuid primary key default gen_random_uuid(),
  screening_id      uuid not null references public.screenings(id) on delete cascade,
  predicted_class   text not null,
  disease_key       text not null check (disease_key in ('cataract','pterygium','pinguecula','glaucoma','normal','other')),
  confidence_score  numeric(6,5) not null check (confidence_score between 0 and 1),
  prediction_data   jsonb,
  bounding_box      jsonb,
  model_version     text not null,
  created_at        timestamptz not null default now()
);
create index if not exists idx_pred_screening on public.ai_predictions(screening_id);

-- ---------------------------------------------------------------------
-- 7. risk_assessments — one per screening, rule-based (versioned)
-- ---------------------------------------------------------------------
create table if not exists public.risk_assessments (
  id                       uuid primary key default gen_random_uuid(),
  screening_id             uuid not null unique references public.screenings(id) on delete cascade,
  medical_history_summary  jsonb not null default '{}'::jsonb,
  vision_test_summary      jsonb not null default '{}'::jsonb,
  ai_summary               jsonb not null default '{}'::jsonb,
  risk_level               text not null check (risk_level in ('low','moderate','high','urgent','inconclusive')),
  risk_factors             jsonb not null default '[]'::jsonb,
  recommendation           jsonb not null default '{}'::jsonb,
  assessment_version       text not null,
  created_at               timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 8. screening_images
-- ---------------------------------------------------------------------
create table if not exists public.screening_images (
  id              uuid primary key default gen_random_uuid(),
  screening_id    uuid not null references public.screenings(id) on delete cascade,
  storage_path    text not null unique,
  image_type      text not null default 'original' check (image_type in ('original','annotated')),
  consent_status  text not null default 'denied' check (consent_status in ('granted','denied','withdrawn')),
  created_at      timestamptz not null default now()
);
create index if not exists idx_simg_screening on public.screening_images(screening_id);

-- ---------------------------------------------------------------------
-- 10. consent_records (created before dataset_images because of FK)
-- ---------------------------------------------------------------------
create table if not exists public.consent_records (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.profiles(id) on delete cascade,
  patient_id       uuid references public.patients(id) on delete cascade,
  screening_id     uuid references public.screenings(id) on delete set null,
  consent_type     text not null check (consent_type in ('data_processing','dataset_image_use')),
  consent_status   text not null check (consent_status in ('granted','denied','withdrawn')),
  consent_version  text not null,
  consent_date     timestamptz not null default now(),
  withdrawn_at     timestamptz
);
create index if not exists idx_consent_user on public.consent_records(user_id, consent_date desc);
create index if not exists idx_consent_patient on public.consent_records(patient_id);

-- ---------------------------------------------------------------------
-- 9. dataset_images — images collected WITH consent for AI training
--    disease_class is only set by an admin reviewer (never automatically)
-- ---------------------------------------------------------------------
create table if not exists public.dataset_images (
  id                 uuid primary key default gen_random_uuid(),
  image_id           uuid not null unique default gen_random_uuid(),
  source             text not null check (source in ('screening','admin_upload')),
  screening_id       uuid references public.screenings(id) on delete set null,
  owner_user_id      uuid references public.profiles(id) on delete cascade,
  subject_patient_id uuid references public.patients(id) on delete cascade,
  consent_record_id  uuid references public.consent_records(id) on delete set null,
  suggested_class    text check (suggested_class is null or suggested_class in ('cataract','pterygium','pinguecula','glaucoma','normal','other')),
  disease_class      text check (disease_class is null or disease_class in ('cataract','pterygium','pinguecula','glaucoma','normal','other')),
  storage_path       text not null unique,
  consent_status     text not null check (consent_status in ('granted','withdrawn')),
  consent_date       timestamptz,
  review_status      text not null default 'pending' check (review_status in ('pending','approved','rejected')),
  dataset_status     text not null default 'local' check (dataset_status in ('local','uploaded_to_roboflow','upload_failed')),
  reject_reason      text,
  roboflow_image_id  text,
  roboflow_error     text,
  uploaded_at        timestamptz not null default now(),
  reviewed_at        timestamptz,
  reviewed_by        uuid references public.profiles(id) on delete set null,
  constraint approved_requires_class check (review_status <> 'approved' or disease_class is not null),
  constraint rejected_requires_reason check (review_status <> 'rejected' or reject_reason is not null)
);
create index if not exists idx_ds_review on public.dataset_images(review_status, uploaded_at desc);
create index if not exists idx_ds_class on public.dataset_images(disease_class);

-- ---------------------------------------------------------------------
-- 11. activity_logs — minimal, non-identifying analytics + audit trail
-- ---------------------------------------------------------------------
create table if not exists public.activity_logs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references public.profiles(id) on delete set null,
  action      text not null check (char_length(action) <= 60),
  details     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists idx_activity_action_date on public.activity_logs(action, created_at desc);
create index if not exists idx_activity_user on public.activity_logs(user_id, created_at desc);

-- ---------------------------------------------------------------------
-- 12. roboflow_projects — cached project/model metadata from the Roboflow API
-- ---------------------------------------------------------------------
create table if not exists public.roboflow_projects (
  id                 uuid primary key default gen_random_uuid(),
  workspace_name     text not null,
  project_name       text not null,
  project_id         text not null unique,
  project_type       text,
  model_version      text,
  classes            jsonb not null default '[]'::jsonb,
  is_active          boolean not null default false,
  connection_status  text not null default 'unknown' check (connection_status in ('connected','error','unknown')),
  last_error         text,
  updated_at         timestamptz not null default now()
);
create unique index if not exists uq_roboflow_active on public.roboflow_projects(is_active) where is_active;

-- ---------------------------------------------------------------------
-- 13. admin_settings
-- ---------------------------------------------------------------------
create table if not exists public.admin_settings (
  id             uuid primary key default gen_random_uuid(),
  setting_key    text not null unique check (setting_key ~ '^[a-z0-9_]{2,60}$'),
  setting_value  jsonb not null,
  updated_by     uuid references public.profiles(id) on delete set null,
  updated_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 14. staff_registration_codes — only HMAC hashes are stored
-- ---------------------------------------------------------------------
create table if not exists public.staff_registration_codes (
  id           uuid primary key default gen_random_uuid(),
  code_hash    text not null unique,
  label        text check (label is null or char_length(label) <= 120),
  status       text not null default 'active' check (status in ('active','disabled','exhausted')),
  expires_at   timestamptz,
  usage_limit  integer check (usage_limit is null or usage_limit > 0),
  usage_count  integer not null default 0 check (usage_count >= 0),
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now()
);

-- Atomically consume a registration code. Returns the code id, or NULL if invalid.
create or replace function public.consume_staff_registration_code(p_code_hash text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  update public.staff_registration_codes
     set usage_count = usage_count + 1,
         status = case when usage_limit is not null and usage_count + 1 >= usage_limit then 'exhausted' else status end
   where code_hash = p_code_hash
     and status = 'active'
     and (expires_at is null or expires_at > now())
     and (usage_limit is null or usage_count < usage_limit)
  returning id into v_id;
  return v_id;
end;
$$;

-- Give back a use if account creation failed after the code was consumed.
create or replace function public.release_staff_registration_code(p_code_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.staff_registration_codes
     set usage_count = greatest(usage_count - 1, 0),
         status = case when status = 'exhausted' then 'active' else status end
   where id = p_code_id;
end;
$$;

revoke execute on function public.consume_staff_registration_code(text) from public, anon, authenticated;
revoke execute on function public.release_staff_registration_code(uuid) from public, anon, authenticated;
grant execute on function public.consume_staff_registration_code(text) to service_role;
grant execute on function public.release_staff_registration_code(uuid) to service_role;
