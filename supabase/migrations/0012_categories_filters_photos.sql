-- ---------------------------------------------------------------- replay note
-- Run the migrations once, in order (0001 -> 0012). Afterwards only
-- 0001, 0005, 0007, 0009, 0011 and 0012 can be replayed safely.
--
-- 0002 and 0008 recreate search_properties comparing `type` to text, which no
-- longer has an operator now that the column is the property_type enum.
-- 0003, 0004 and 0006 still reference the retired 'user'/'agent' role strings.
-- 0010 cannot restore my_current_role()'s old text return type.
--
-- This is inherent to converting a column's type, not a defect: verified by
-- applying every migration to a real Postgres (PGlite) and then re-running each
-- one individually against the migrated database.

-- Property categories become a real enum, search gains price/bedroom filters,
-- galleries gain a photo cap and storage, and booked dates become readable
-- without exposing whose booking they are.
--
-- Follows the shape of 0011 (profiles.role text -> enum), including its
-- gotchas: Postgres refuses to alter a column's type while a policy references
-- it, CREATE OR REPLACE cannot change a function's return type or signature,
-- and `language sql` bodies are parsed at creation so any function reading the
-- retyped column has to be rebuilt afterwards.
--
-- Idempotent: safe to re-run on an already-migrated database.

-- ============================================================== 1. the enum
-- Four categories, lowercase, so the Supabase table editor renders a dropdown
-- and the client never has to title-case a value to match the DB.
do $$ begin
  if not exists (select 1 from pg_type where typname = 'property_type') then
    create type public.property_type as enum ('villa', 'apartment', 'room', 'bnb');
  end if;
end $$;

-- ------------------------------------------------- drop what depends on type
-- search_properties compares p.type against a text parameter. `language sql`
-- bodies are parsed and stored at creation time, so the stored plan would
-- still reference the old text column; and its argument list changes below
-- anyway (CREATE OR REPLACE cannot add parameters when that would change the
-- signature). Drop it explicitly rather than leaving a second overload behind,
-- which would make every 2-argument call ambiguous.
drop function if exists public.search_properties(text, text, integer, integer);
drop function if exists public.search_properties(text, text, numeric, numeric, integer, integer, integer);

-- --------------------------------------------------------- the conversion
-- Mapping from the eight retired text values to the four categories:
--
--   Villa                      -> villa       (unchanged in meaning)
--   House, Townhouse, Duplex   -> villa       whole self-contained dwellings;
--                                             `villa` is this taxonomy's
--                                             standalone-home category
--   Apartment, Condo, Studio   -> apartment   units inside a larger building
--   Other                      -> room        the catch-all becomes the
--                                             smallest, least-committal
--                                             category rather than claiming a
--                                             whole home
--
-- Nothing maps to `bnb`: it describes how a listing is rented (see
-- properties.rental_mode = 'short_term'), and no existing row asserted that
-- through `type`, so inventing it here would be a guess. New listings pick it.
--
-- No row is deleted and none is left null: the CASE has an ELSE.
--
-- Guarded on the column still being `text` so a re-run is a no-op instead of
-- comparing enum values against retired labels, which would error.
do $$ begin
  if (
    select data_type from information_schema.columns
    where table_schema = 'public' and table_name = 'properties' and column_name = 'type'
  ) = 'text' then
    -- The default is a text expression and would not survive the retype; the
    -- CHECK goes too, because the enum now *is* the constraint.
    execute 'alter table public.properties alter column type drop default';
    execute 'alter table public.properties drop constraint if exists properties_type_check';
    execute $conv$
      alter table public.properties
        alter column type type public.property_type
        using (case type
                 when 'Villa'     then 'villa'
                 when 'House'     then 'villa'
                 when 'Townhouse' then 'villa'
                 when 'Duplex'    then 'villa'
                 when 'Apartment' then 'apartment'
                 when 'Condo'     then 'apartment'
                 when 'Studio'    then 'apartment'
                 else 'room'
               end)::public.property_type
    $conv$;
  end if;
end $$;

alter table public.properties
  alter column type set default 'apartment'::public.property_type;

-- ======================================================== 2. search + filters
-- Rebuilt against the enum column and widened with price/bedroom filters.
-- SECURITY INVOKER (the default) is deliberate: the caller's RLS still applies.
create function public.search_properties(
  search_query  text default null,
  property_type text default null,
  min_price     numeric default null,
  max_price     numeric default null,
  min_bedrooms  integer default null,
  result_limit  integer default 20,
  result_offset integer default 0
)
returns setof public.properties
language sql
stable
security invoker
set search_path = public
as $$
  select p.*
  from public.properties p
  where (
      -- 'all' (and null/'') means no type filter. The parameter stays `text`
      -- so PostgREST can pass a plain JSON string; it is cast to the enum only
      -- once it is known to name a real category.
      property_type is null
      or property_type = ''
      or lower(property_type) = 'all'
      or p.type = property_type::public.property_type
    )
    and (min_price is null or p.price >= min_price)
    and (max_price is null or p.price <= max_price)
    and (min_bedrooms is null or p.bedrooms >= min_bedrooms)
    and (
      search_query is null
      or search_query = ''
      or p.name          ilike '%' || search_query || '%'
      or p.address       ilike '%' || search_query || '%'
      or p.type::text    ilike '%' || search_query || '%'
    )
  order by p.created_at desc
  -- Clamp so a client cannot ask for an unbounded page.
  limit  greatest(0, least(coalesce(result_limit, 20), 100))
  offset greatest(0, coalesce(result_offset, 0));
$$;

revoke all on function
  public.search_properties(text, text, numeric, numeric, integer, integer, integer) from public;
grant execute on function
  public.search_properties(text, text, numeric, numeric, integer, integer, integer) to authenticated;

-- ============================================================== 3. photo cap
-- A property has minimum 2 and maximum 18 photos.
--
-- Only the MAXIMUM is enforced here. The minimum is a *publish-time* rule, not
-- a row-level one: a gallery is built up one photo at a time, so any row-level
-- "at least 2" constraint would reject the very first insert and make it
-- impossible to ever reach two. The minimum therefore lives in the API/UI layer
-- (lib/api.ts exports MIN_PROPERTY_PHOTOS and the form blocks publishing below
-- it), which is the only layer that knows when a listing is considered done.
create or replace function public.enforce_gallery_photo_cap()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  existing integer;
begin
  select count(*) into existing
  from public.galleries g
  where g.property_id = new.property_id;

  if existing >= 18 then
    raise exception
      'A property can have at most 18 photos; this one already has %. Remove one before adding another.',
      existing
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists galleries_photo_cap on public.galleries;
create trigger galleries_photo_cap
  before insert on public.galleries
  for each row execute function public.enforce_gallery_photo_cap();

-- --------------------------------------------------------- gallery writes
-- 0001 gave galleries a read policy only, so nobody could ever add a photo.
-- Writes follow the listing: the property's owner (or the admin) manages it.
drop policy if exists "owner inserts gallery" on public.galleries;
drop policy if exists "owner deletes gallery" on public.galleries;
drop policy if exists "admin deletes gallery" on public.galleries;

create policy "owner inserts gallery" on public.galleries
  for insert to authenticated
  with check (
    exists (
      select 1 from public.properties p
      where p.id = property_id
        and p.owner_id = (select auth.jwt()->>'sub')
    )
  );

create policy "owner deletes gallery" on public.galleries
  for delete to authenticated
  using (
    exists (
      select 1 from public.properties p
      where p.id = property_id
        and p.owner_id = (select auth.jwt()->>'sub')
    )
  );

create policy "admin deletes gallery" on public.galleries
  for delete to authenticated
  using (public.is_admin());

-- ======================================================= 4. storage bucket
-- `property-photos`: public read (the URLs go straight into <Image src>), any
-- authenticated user may upload, and only the uploader may delete their object.
--
-- Wrapped in a DO block that bails out when the storage schema is absent:
-- PGlite (used by the test harness) has no storage schema, and the rest of this
-- migration must still apply there. Every statement goes through EXECUTE so
-- plpgsql never plans them on a database where the tables do not exist.
do $$ begin
  if to_regclass('storage.objects') is null then
    return;
  end if;

  execute $s$
    insert into storage.buckets (id, name, public)
    values ('property-photos', 'property-photos', true)
    on conflict (id) do update set public = true
  $s$;

  execute 'drop policy if exists "property photos are publicly readable" on storage.objects';
  execute 'drop policy if exists "authenticated uploads property photos"  on storage.objects';
  execute 'drop policy if exists "uploader deletes own property photo"    on storage.objects';
  execute 'drop policy if exists "uploader updates own property photo"    on storage.objects';

  execute $s$
    create policy "property photos are publicly readable" on storage.objects
      for select using (bucket_id = 'property-photos')
  $s$;

  execute $s$
    create policy "authenticated uploads property photos" on storage.objects
      for insert to authenticated
      with check (bucket_id = 'property-photos')
  $s$;

  -- `owner` is set by Supabase Storage to the uploading user, so this is the
  -- "only the uploader may delete" rule without a second bookkeeping table.
  execute $s$
    create policy "uploader deletes own property photo" on storage.objects
      for delete to authenticated
      using (
        bucket_id = 'property-photos'
        and owner = (select auth.jwt()->>'sub')::uuid
      )
  $s$;

  execute $s$
    create policy "uploader updates own property photo" on storage.objects
      for update to authenticated
      using (
        bucket_id = 'property-photos'
        and owner = (select auth.jwt()->>'sub')::uuid
      )
  $s$;
end $$;

-- ====================================================== 5. booked date ranges
-- The availability calendar has to grey out dates another guest already took.
-- The bookings RLS restricts SELECT to the guest and the owner — correctly, a
-- booking row names people, dates, prices and a message — so a prospective
-- guest can read none of it.
--
-- SECURITY DEFINER lets this bypass that policy, and it returns *only* the two
-- date columns: no ids, no names, no status, no prices. Dates without
-- identities. That is the entire point of the function, so do not widen the
-- return type to add "just one more" column.
--
-- Only 'pending' and 'confirmed' hold a date; 'declined' and 'cancelled'
-- release it back to the calendar.
drop function if exists public.get_booked_ranges(uuid);

create function public.get_booked_ranges(p_property_id uuid)
returns table (check_in date, check_out date)
language sql
stable
security definer
set search_path = public
as $$
  select b.check_in, b.check_out
  from public.bookings b
  where b.property_id = p_property_id
    and b.status in ('pending', 'confirmed')
  order by b.check_in
$$;

revoke all on function public.get_booked_ranges(uuid) from public;
grant execute on function public.get_booked_ranges(uuid) to authenticated;

-- ------------------------------------------------------------------- index
-- Backs both the function above and the property detail screen's lookup.
create index if not exists bookings_property_active_idx
  on public.bookings (property_id, check_in)
  where status in ('pending', 'confirmed');
