-- =====================================================================
-- EYE Check — 005 Link staff accounts to the registration code they used
-- ---------------------------------------------------------------------
-- * One row per account (user_id is the primary key) → an account can never be counted twice.
-- * Deleting a code keeps the account and this row: code_id becomes NULL, while
--   code_ref / code_label keep a snapshot so admins can still trace which code was used.
-- * Deleting an account removes its link row (and nothing else).
-- * Service role only (RLS on, no policies) — same as staff_registration_codes.
-- Accounts registered before this migration have no link: the old flow did not record it.
-- =====================================================================

create table if not exists public.staff_code_registrations (
  user_id     uuid primary key references public.profiles(id) on delete cascade,
  code_id     uuid references public.staff_registration_codes(id) on delete set null,
  code_ref    uuid not null,  -- original code id, kept after the code is deleted
  code_label  text check (code_label is null or char_length(code_label) <= 120),
  used_at     timestamptz not null default now()
);
create index if not exists idx_staff_code_registrations_code on public.staff_code_registrations(code_id, used_at desc);
create index if not exists idx_staff_code_registrations_ref on public.staff_code_registrations(code_ref);

alter table public.staff_code_registrations enable row level security;
-- no policies → anon / authenticated clients cannot read or write; the backend uses the service role
revoke all on public.staff_code_registrations from anon, authenticated;
