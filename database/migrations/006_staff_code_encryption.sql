-- =====================================================================
-- EYE Check — 006 Viewable staff registration codes + exact expiry time
-- ---------------------------------------------------------------------
-- * code_encrypted: AES-256-GCM ciphertext of the code (encrypted by the backend,
--   key never stored in the DB). Lets an authorised admin show / copy the code later.
--   Codes created before this migration only have code_hash → they keep working for
--   registration but cannot be shown (the original value was never stored).
-- * Registration still matches code_hash (HMAC) — nothing about the old flow changes.
-- * updated_at: last admin edit.
-- * expires_at already is timestamptz → full date + time (Asia/Bangkok converted to UTC
--   by the backend). 'expired' is derived from expires_at vs now() (database clock),
--   so a code expires automatically at the exact minute without a scheduled job.
-- * Table stays service-role only (RLS on, no policies).
-- =====================================================================

alter table public.staff_registration_codes
  add column if not exists code_encrypted text,
  add column if not exists updated_at timestamptz;

-- Re-create the consume function with explicit server-side checks (same signature / result).
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
revoke execute on function public.consume_staff_registration_code(text) from public, anon, authenticated;
grant execute on function public.consume_staff_registration_code(text) to service_role;
