-- Roles, rental modes, amenities and nearby facilities.
--
-- Extends the app from a single "agent" publisher to three distinct roles:
--   * tenant        – browses and books (was "user")
--   * property_owner – publishes listings, can rent short-term (like BnB) or
--                      monthly, and manages bookings on their properties
--   * agency        – publishes listings, monthly rental only, manages bookings
--   * admin         – platform administrator; can delete any property
--
-- Existing 'user' rows are migrated to 'tenant'; existing 'agent' rows become
-- 'property_owner' (the closest match for the old publishing role).

-- ---------------------------------------------------------------- profiles
alter table public.profiles
  drop constraint if exists profiles_role_check;

alter table public.profiles
  add constraint profiles_role_check
  check (role in ('tenant', 'property_owner', 'agency', 'admin'));

-- Migrate legacy roles.
-- `::text` so this still parses after 0011 turns `role` into an enum -- the
-- retired 'user'/'agent' strings are not enum labels, so an uncast
-- comparison errors when the CLI replays this file.
update public.profiles set role = 'tenant'         where role::text = 'user';
update public.profiles set role = 'property_owner' where role::text = 'agent';

-- ---------------------------------------------------------------- is_admin
-- Defined before the RLS policies below, which reference it. SECURITY DEFINER
-- so the policy check does not recurse into profiles' own RLS.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.jwt()->>'sub') and p.role = 'admin'
  )
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

-- ---------------------------------------------------------------- properties
-- How a listing is rented. 'short_term' is BnB-style nightly booking;
-- 'monthly' is a fixed monthly rental. Agencies are restricted to 'monthly'.
alter table public.properties
  add column if not exists rental_mode text not null default 'monthly'
  check (rental_mode in ('monthly', 'short_term'));

-- Free-text list of nearby facilities (e.g. "Elevator", "CCTV Camera",
-- "Balcony", "Security", "Parking"). Kept as text[] like `facilities`.
alter table public.properties
  add column if not exists nearby_facilities text[] not null default '{}';

create index if not exists properties_rental_mode_idx
  on public.properties (rental_mode);

-- ---------------------------------------------------------------- amenities
-- A dedicated amenities table so owners can add/remove amenities per property
-- and the platform admin can delete any amenity. Amenities are the in-unit
-- features (elevator, CCTV camera, balcony, security, parking, ...).
create table if not exists public.amenities (
  id          uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  name        text not null,
  created_at  timestamptz not null default now(),
  unique (property_id, name)
);

create index if not exists amenities_property_idx on public.amenities (property_id);

-- ------------------------------------------------------------- RLS policies
alter table public.amenities enable row level security;

-- Amenities are public (shown on listings) and created by the property owner.
drop policy if exists "read amenities"            on public.amenities;
drop policy if exists "owner inserts amenities"   on public.amenities;
drop policy if exists "owner deletes amenities"   on public.amenities;
drop policy if exists "admin deletes amenities"   on public.amenities;

create policy "read amenities" on public.amenities
  for select to authenticated
  using (true);

create policy "owner inserts amenities" on public.amenities
  for insert to authenticated
  with check (
    exists (
      select 1 from public.properties p
      where p.id = property_id
        and p.owner_id = (select auth.jwt()->>'sub')
    )
  );

create policy "owner deletes amenities" on public.amenities
  for delete to authenticated
  using (
    exists (
      select 1 from public.properties p
      where p.id = property_id
      and p.owner_id = (select auth.jwt()->>'sub')
    )
  );

create policy "admin deletes amenities" on public.amenities
  for delete to authenticated
  using (public.is_admin());

-- Properties: keep the existing owner policies, add an admin delete policy and
-- an admin update policy so the platform can moderate listings.
drop policy if exists "admin deletes properties" on public.properties;
drop policy if exists "admin updates properties" on public.properties;

create policy "admin deletes properties" on public.properties
  for delete to authenticated
  using (public.is_admin());

create policy "admin updates properties" on public.properties
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());