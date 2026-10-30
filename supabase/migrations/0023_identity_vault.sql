-- Identity vault for profiles.
--
-- Lets users (guests / tenants) store their government-issued ID details so
-- property owners can verify identity during check-in.
--
-- Idempotent: safe to re-run.

alter table public.profiles
  add column if not exists identity_type text
    check (identity_type in ('passport', 'national_id', 'driver_license', 'other'));

alter table public.profiles
  add column if not exists identity_number text;