-- Mogadishu (Banadir) districts: a real enum so the Supabase table editor gives
-- a dropdown, a nullable column on properties, and a search filter.
--
-- Idempotent AND replay-safe: `supabase db push` re-applies the whole folder,
-- so this file has to survive running against an already-migrated database and
-- has to leave the end state correct no matter what the earlier files did on
-- their way past. See section 3 for the overload trap that motivates most of
-- the care here.

-- ============================================================== 1. the enum
-- 20 values, snake_case, matching constants/data.ts `District` exactly. The
-- labels the user sees live in TypeScript; the database stores the identifier.
--
-- Created in one shot inside a guard rather than with `alter type ... add
-- value`: ADD VALUE cannot be used later in the same transaction that adds it,
-- and the CLI applies each migration in a transaction, so the column definition
-- below would have no usable type to reference on a fresh database.
do $$ begin
  if not exists (
    select 1 from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'mogadishu_district'
  ) then
    create type public.mogadishu_district as enum (
      'abdiaziz', 'bondhere', 'daynile', 'dharkenley', 'garasbaaley',
      'hamar_jajab', 'hamar_weyne', 'heliwa', 'hodan', 'howlwadag',
      'karan', 'kaxda', 'shangani', 'shibis', 'waberi', 'wadajir',
      'wardhigley', 'yaqshid', 'darusalam', 'gubadley'
    );
  end if;
end $$;

-- ========================================================== 2. the column
-- NULLABLE on purpose: every listing created before this migration has no
-- district, and "not specified" stays a valid answer for new ones too. A NOT
-- NULL with a made-up default would silently assert a neighbourhood nobody
-- chose.
alter table public.properties
  add column if not exists district public.mogadishu_district;

-- It is a filter (search_properties below, and the explore screen's chips), so
-- it gets an index. Plain btree: the column is a handful of distinct values
-- compared with equality, never a pattern.
create index if not exists properties_district_idx
  on public.properties (district);

-- ================================================= 3. search_properties (v3)
-- Adds `district` after `property_type`, per the client contract.
--
-- Three things this repo has been bitten by, all of which apply again:
--
--  a) The function returns `setof public.properties`. Section 2 just added a
--     column to that table, so the function must be recreated for its result
--     shape (and PostgREST's cached schema) to include `district`.
--  b) `type` is the property_type enum, so a text parameter needs an explicit
--     cast — and only once the value is known to name a real category.
--  c) Every parameter has a default, so leaving an older, shorter overload in
--     place makes `search_properties()` ambiguous and every call fails with
--     42725. The previous versions must be DROPPED, not replaced.
--
-- (c) is also why the drop is a loop rather than a list of signatures. On a
-- replay of the whole folder, 0002/0006/0008 each re-create the 4-argument
-- version and 0012 re-creates the 7-argument one; by the time this file runs
-- again, up to three overloads can exist. Dropping *every* overload found in
-- pg_proc and then creating exactly one leaves a single, unambiguous function
-- regardless of which earlier migrations ran and in what order. This migration
-- is the last in the folder, so its end state is the database's end state.
do $$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'search_properties'
  loop
    execute format('drop function if exists %s', fn.sig);
  end loop;
end $$;

-- SECURITY INVOKER (the default) is deliberate: the caller's RLS still applies.
create function public.search_properties(
  search_query  text default null,
  property_type text default null,
  district      text default null,
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
      property_type is null
      or property_type = ''
      or lower(property_type) = 'all'
      or p.type = property_type::public.property_type
    )
    and (
      -- Same 'all'/null/'' convention as the type filter, so the client can
      -- pass whichever chip is selected without translating it.
      --
      -- The parameter is qualified with the function name because it shares a
      -- name with the column added above. Unqualified, the COLUMN wins, so
      -- `district = ''` becomes properties.district = ''::mogadishu_district,
      -- which fails at CREATE time (`language sql` bodies are parsed then, and
      -- the empty string is not an enum label). The contract fixes the
      -- parameter name, so qualifying is the fix, not renaming.
      --
      -- Note what this does NOT do: when no district is asked for, rows with a
      -- null district are still returned. Only an explicit district excludes
      -- them, which is what "not specified" has to mean for the listings that
      -- predate this column.
      search_properties.district is null
      or search_properties.district = ''
      or lower(search_properties.district) = 'all'
      or p.district = search_properties.district::public.mogadishu_district
    )
    and (min_price is null or p.price >= min_price)
    and (max_price is null or p.price <= max_price)
    and (min_bedrooms is null or p.bedrooms >= min_bedrooms)
    and (
      search_query is null
      or search_query = ''
      or p.name           ilike '%' || search_query || '%'
      or p.address        ilike '%' || search_query || '%'
      or p.type::text     ilike '%' || search_query || '%'
      -- Typing "hodan" into the search box should find Hodan listings. The
      -- enum label is the snake_case identifier, so underscores are swapped
      -- for spaces first: "hamar weyne" matches hamar_weyne.
      or replace(p.district::text, '_', ' ') ilike '%' || search_query || '%'
    )
  order by p.created_at desc
  -- Clamp so a client cannot ask for an unbounded page.
  limit  greatest(0, least(coalesce(result_limit, 20), 100))
  offset greatest(0, coalesce(result_offset, 0));
$$;

revoke all on function public.search_properties(
  text, text, text, numeric, numeric, integer, integer, integer
) from public;
grant execute on function public.search_properties(
  text, text, text, numeric, numeric, integer, integer, integer
) to authenticated;
