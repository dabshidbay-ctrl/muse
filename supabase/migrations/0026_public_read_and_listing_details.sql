-- Public (signed-out) reading + the listing-detail columns from 0024.
--
-- WHY THIS FILE EXISTS
-- --------------------
-- The app made Home / Explore / property detail public in code, but the
-- database never did: every read policy on properties, galleries, reviews
-- and amenities is `to authenticated`, and search_properties is granted only
-- to authenticated. So a signed-out visitor gets 0 listings on Home and
-- nothing on a detail page, even though a signed-in owner sees all 10.
-- Code cannot change database policies — run this file in the Supabase SQL
-- editor (it is idempotent, safe to re-run), then reload the site.
--
-- It also re-applies the two columns from 0024 (living_rooms, floor_number)
-- with `if not exists`, because a live database that never ran 0024 fails
-- every publish with PGRST204 "Could not find the 'floor_number' column".
-- The app already retries inserts/updates without those columns, so this
-- is not required for publishing — but it is required for living rooms and
-- floor numbers to actually be stored and shown.
--
-- No phone numbers, emails or secrets are touched: profile_contacts stays
-- self-or-admin only, and nothing here grants write access to anyone new.

-- ================================================= 1. public reads
drop policy if exists "properties are publicly readable" on public.properties;
create policy "properties are publicly readable"
  on public.properties for select to anon, authenticated using (true);

drop policy if exists "galleries are publicly readable" on public.galleries;
create policy "galleries are publicly readable"
  on public.galleries for select to anon, authenticated using (true);

drop policy if exists "reviews are publicly readable" on public.reviews;
create policy "reviews are publicly readable"
  on public.reviews for select to anon, authenticated using (true);

drop policy if exists "amenities are publicly readable" on public.amenities;
create policy "amenities are publicly readable"
  on public.amenities for select to anon, authenticated using (true);

-- search_properties is SECURITY INVOKER, so RLS above is what gates it;
-- it only needs execute permission for anonymous callers as well.
grant execute on function public.search_properties(
  text, text, text, numeric, numeric, integer, integer, integer
) to anon, authenticated;

-- ================================================= 2. listing-detail columns (from 0024)
alter table public.properties
  add column if not exists living_rooms integer not null default 0
    check (living_rooms >= 0);

alter table public.properties
  add column if not exists floor_number integer
    check (floor_number >= 0);

-- Ask PostgREST to re-read the schema, so the new columns and policies
-- take effect without waiting for its cache to expire.
notify pgrst, 'reload schema';
