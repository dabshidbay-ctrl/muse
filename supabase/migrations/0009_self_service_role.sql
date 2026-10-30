-- Let a user change their own account type from inside the app.
--
-- Until now `role` was pinned by the update policy (0003): the WITH CHECK
-- required the new value to equal the row's existing one, so the only way to
-- become a publisher was an admin running SQL. Signing up as a tenant was a
-- dead end — the "My properties" screens are role-gated, so those users could
-- never publish and had no in-app path to change that.
--
-- SECURITY: 'admin' stays unreachable. The check accepts one of the three
-- self-assignable roles, OR the role the row already has — so an existing
-- admin can still edit their name without the policy rejecting their own
-- unchanged 'admin' value, while nobody can *move* to 'admin'. The subselect
-- reads the pre-update row, which is what makes "unchanged" verifiable.
--
-- This deliberately makes publishing self-serve: anyone with an account can
-- become a property_owner or agency without review. If listings ever need
-- vetting, replace this with a request/approval flow rather than re-pinning
-- the column, so users keep a path that does not require an operator.
--
-- Idempotent: safe to re-run.

drop policy if exists "update own profile" on public.profiles;

create policy "update own profile" on public.profiles
  for update to authenticated
  using ((select auth.jwt()->>'sub') = id)
  with check (
    (select auth.jwt()->>'sub') = id
    and (
      role in ('tenant', 'property_owner', 'agency')
      or role = (select p.role from public.profiles p where p.id = profiles.id)
    )
  );
