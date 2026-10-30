-- Three write paths the client offers but the schema refuses.
--
-- Each is the same shape of bug: a capability was granted for some verbs and
-- not others, so an action half-succeeds or fails with a bare 42501.
--
-- Idempotent: safe to re-run.

-- ------------------------------------------------------- admin publishes
-- 0003's only INSERT policy on properties requires is_agent(), which covers
-- property_owner and agency but NOT admin. `canPublish` in lib/useProfile.ts
-- includes admin, and the profile screen offers them "Add a listing", so an
-- admin pressing Publish hit a row-level security error with nothing to do
-- about it. Admins can already update and delete any listing; creating one was
-- the odd gap.
drop policy if exists "admin inserts properties" on public.properties;

create policy "admin inserts properties" on public.properties
  for insert to authenticated
  with check (public.is_admin());

-- -------------------------------------------------------- admin edits photos
-- 0012 gave galleries owner-insert, owner-delete and admin-delete, but no
-- admin-insert. replacePropertyPhotos() deletes the old rows then inserts the
-- new ones, so an admin editing someone else's listing wiped that listing's
-- photos and then failed — destructive, and the worst possible half-failure.
--
-- This is the identical omission 0006 fixed for amenities.
drop policy if exists "admin inserts galleries" on public.galleries;

create policy "admin inserts galleries" on public.galleries
  for insert to authenticated
  with check (public.is_admin());

-- --------------------------------------------------------- photo ordering
-- galleries had no ordering column, so getPropertyPhotos() fell back to the
-- primary key — a random uuid. The order a seller arranges in PhotoPicker, and
-- therefore which photo is the cover, did not survive a save: the gallery came
-- back shuffled.
--
-- Backfill is deliberately deterministic rather than arbitrary: existing rows
-- are numbered by their uuid so a re-run cannot reshuffle a gallery that a user
-- has already put in order.
alter table public.galleries
  add column if not exists position integer not null default 0;

with ordered as (
  select id, row_number() over (partition by property_id order by id) - 1 as n
  from public.galleries
)
update public.galleries g
   set position = ordered.n
  from ordered
 where ordered.id = g.id
   and g.position is distinct from ordered.n
   and not exists (
     -- Only backfill galleries that were never ordered; leave curated ones be.
     select 1 from public.galleries x
     where x.property_id = g.property_id and x.position <> 0
   );

create index if not exists galleries_property_position_idx
  on public.galleries (property_id, position);
