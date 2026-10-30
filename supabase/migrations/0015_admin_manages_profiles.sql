-- Give the admin role a moderation surface over profiles.
--
-- Admins could already moderate listings (0004) but not see or manage people:
-- the profiles select policy shows a user their own row plus publishers, so an
-- admin screen listing "all users" would have returned a partial list with no
-- error to explain the gap. The update policy is stricter still -- it only ever
-- matched the caller's own row -- so an admin could not change anyone's role
-- without opening the Supabase dashboard.
--
-- SECURITY: 'admin' remains unreachable from any client. The trigger from 0013
-- already refuses a self-assignment; this migration extends that function so it
-- also refuses an admin granting 'admin' to somebody else. Promotion to admin
-- stays a dashboard action, where there is no JWT and the trigger stands aside.
-- The effect is that an admin may move people between tenant / property_owner /
-- agency and no further -- they cannot mint another admin, and cannot quietly
-- promote themselves by way of a second account.
--
-- Idempotent: safe to re-run.

-- ------------------------------------------------------------------- select
-- Additive: the existing "read own or agent profiles" policy stays as it is.
-- Multiple permissive SELECT policies are OR'd, so this widens what an admin
-- sees without touching what anyone else sees.
drop policy if exists "admin reads all profiles" on public.profiles;

create policy "admin reads all profiles" on public.profiles
  for select to authenticated
  using (public.is_admin());

-- ------------------------------------------------------------------- update
-- Likewise OR'd with "update own profile", so ordinary users are unaffected.
-- The role rules themselves live in the trigger below, not here: putting them
-- in a policy would mean reading profiles from inside a policy on profiles,
-- which is what caused the 42P17 recursion this schema has already been bitten
-- by twice (0009, 0010).
drop policy if exists "admin updates any profile" on public.profiles;

create policy "admin updates any profile" on public.profiles
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ------------------------------------------------------------------ trigger
-- Replaces 0013's version. Same contract, one addition: 'admin' can never be
-- granted from a client, to anyone -- previously the check only stopped a user
-- promoting themselves, which was sufficient only because nobody could edit
-- another user's row at all. The policy above makes that assumption false.
create or replace function public.enforce_role_change()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  claim text := (select auth.jwt()->>'sub');
begin
  if new.role is not distinct from old.role then
    return new;
  end if;

  -- No JWT: the dashboard, a migration, or the service role. Trusted.
  if claim is null then
    return new;
  end if;

  if new.role = 'admin' then
    raise exception 'The admin role can only be granted from the Supabase dashboard.'
      using errcode = 'check_violation';
  end if;

  -- Demoting an existing admin is equally a dashboard action: allowing it from
  -- a client would let one admin strip another, and an account that loses the
  -- role cannot get it back without operator help.
  if old.role = 'admin' then
    raise exception 'An administrator role can only be changed from the Supabase dashboard.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_enforce_role_change on public.profiles;
create trigger profiles_enforce_role_change
  before update of role on public.profiles
  for each row execute function public.enforce_role_change();
