-- Fix: infinite recursion detected in policy for relation "profiles" (42P17).
--
-- The "update own profile" policy compared the incoming role against the row's
-- current one with an inline subquery:
--
--   role = (select p.role from public.profiles p where p.id = profiles.id)
--
-- That subquery reads public.profiles from inside a policy *on* public.profiles,
-- so evaluating the policy re-enters RLS on the same table and Postgres aborts.
-- It fires on any profile update, and ensureProfile() updates the row on every
-- load, so the whole app fails as soon as a user signs in.
--
-- 0003 shipped the same self-reference; 0009 kept it while widening the policy,
-- which is what made it hit every session instead of lying dormant.
--
-- The fix is the pattern already used by is_admin()/is_agent(): read the role
-- through a SECURITY DEFINER function. That runs as the function owner and so
-- bypasses RLS on profiles, which breaks the cycle. The function is the reason
-- those helpers never recursed even though they select from profiles too.
--
-- Idempotent: safe to re-run.

-- --------------------------------------------------------------- role helper
-- Dropped and recreated rather than CREATE OR REPLACE'd: a later migration
-- (0011) redefines this to return the user_role enum, and replaying this file
-- against that schema fails with 42P13 "cannot change return type of existing
-- function". The policy below is dropped first because it depends on the
-- function, so the drop would otherwise be refused.
--
-- STABLE, not VOLATILE: it is called per-row during policy evaluation and the
-- role cannot change mid-statement, so the planner may cache it.
drop policy if exists "update own profile" on public.profiles;
drop function if exists public.my_current_role();

create function public.my_current_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select p.role::text
  from public.profiles p
  where p.id = (select auth.jwt()->>'sub')
$$;

revoke all on function public.my_current_role() from public;
grant execute on function public.my_current_role() to authenticated;

-- --------------------------------------------------------------- the policy
-- Same intent as 0009: a user may move between the three self-assignable roles,
-- or keep whatever role they already hold. 'admin' is therefore reachable only
-- by someone who is already an admin, so it cannot be granted from the client —
-- while an admin editing their name still passes the check with role unchanged.
create policy "update own profile" on public.profiles
  for update to authenticated
  using ((select auth.jwt()->>'sub') = id)
  with check (
    (select auth.jwt()->>'sub') = id
    and (
      role in ('tenant', 'property_owner', 'agency')
      or role::text = public.my_current_role()
    )
  );
