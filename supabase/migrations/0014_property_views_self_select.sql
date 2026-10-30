-- Fix: "new row violates row-level security policy for table property_views"
-- (42501) when the app records a view.
--
-- 0008 gave property_views an INSERT policy and a SELECT policy that only the
-- listing's owner (and admin) satisfy. A plain INSERT works fine under that.
-- But recordPropertyView() uses upsert(ignoreDuplicates), which PostgREST sends
-- as INSERT ... ON CONFLICT (property_id, viewer_id) DO NOTHING, and that form
-- has to consult the conflicting row through the arbiter index. With RLS on, a
-- row the caller cannot SELECT is not a row it may silently collide with, so
-- Postgres refuses the statement rather than leaking whether it exists -- and
-- it surfaces as a WITH CHECK violation, which points at the INSERT policy and
-- makes the SELECT policy look innocent.
--
-- That is why this passed review and a plain-INSERT test and still failed in
-- the app: the defect lives in the interaction between the conflict clause and
-- the read policy, not in either policy on its own.
--
-- The fix is to let a viewer see their own view rows. That is the minimum the
-- conflict check needs and it gives nothing away: a viewer learns only that
-- they themselves looked at a listing, which they already know. Owners still
-- cannot see each other's data, and no one else gains visibility of who
-- viewed what -- the existing owner/admin policy is left untouched.
--
-- Idempotent: safe to re-run.

drop policy if exists "viewer reads own property views" on public.property_views;

create policy "viewer reads own property views" on public.property_views
  for select to authenticated
  using ((select auth.jwt()->>'sub') = viewer_id);
