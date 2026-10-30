-- Removes the last self-reference from the policies on `profiles`, which is the
-- only remaining way this table can raise 42P17 (infinite recursion detected in
-- policy for relation "profiles").
--
-- 0009 compared the incoming role against the current one with an inline
-- subquery on profiles, from inside a policy on profiles -- unambiguously
-- recursive. 0010 moved that lookup into my_current_role(), a SECURITY DEFINER
-- function, and the error stopped locally. That reasoning was shakier than it
-- looked: SECURITY DEFINER does not exempt a query from RLS. It only changes
-- which role runs the body; RLS still applies to that role, and is skipped only
-- when the role owns the table or holds BYPASSRLS.
--
-- Honest status: the user still saw 42P17 after 0010, and this was NOT
-- reproducible locally -- not even with `force row level security`, which
-- removes the owner exemption. So the precise mechanism on their instance is
-- unconfirmed, and this migration is not a fix for a diagnosed cause.
--
-- What it does instead is remove the whole category of failure: the policy
-- becomes a plain ownership test with no subquery and no function call, so
-- there is nothing left on this table for RLS to re-enter, under any ownership
-- or grant arrangement. The rule about which role transitions are permitted
-- moves into a BEFORE UPDATE trigger, which sees OLD and NEW directly and
-- needs no second lookup. Triggers also run regardless of RLS, so the
-- protection is stronger than the policy clause it replaces, not weaker.
--
-- Idempotent: safe to re-run.

-- ------------------------------------------------------------- the policy
-- Plain ownership. Note this no longer constrains `role` at all; the trigger
-- below is what stops a client granting itself admin, and it cannot be
-- bypassed by any client because triggers run regardless of RLS.
drop policy if exists "update own profile" on public.profiles;

create policy "update own profile" on public.profiles
  for update to authenticated
  using ((select auth.jwt()->>'sub') = id)
  with check ((select auth.jwt()->>'sub') = id);

-- Nothing references it now, and leaving it invites the same mistake again.
drop function if exists public.my_current_role();

-- ------------------------------------------------------------- the trigger
-- Enforces the role rules that used to live in the policy's WITH CHECK.
--
-- The `claim is null` branch is what keeps the Supabase dashboard and the
-- service_role key working: those carry no `sub`, so they are trusted and may
-- set any role, including admin. Requests from the app always carry a sub and
-- are held to the three self-assignable roles.
-- SECURITY DEFINER with a pinned search_path: a trigger body runs as the
-- *calling* role by default, and that role is not guaranteed USAGE on the auth
-- schema, which would make auth.jwt() fail with "permission denied for schema
-- auth" and block the update. Caught by testing the trigger as a real
-- non-superuser rather than as the owner.
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
    raise exception 'The admin role cannot be self-assigned.'
      using errcode = 'check_violation';
  end if;

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
