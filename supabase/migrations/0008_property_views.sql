-- Property view tracking.
--
-- Opening a property detail page records a view. The owner of the listing (and
-- the platform admin) can then see how many people looked at it.
--
-- COUNTING SEMANTIC: **unique viewers**, not total opens.
--   `property_views` carries a unique (property_id, viewer_id) constraint, so a
--   viewer who reopens the same listing ten times still contributes exactly 1.
--   That is the number an owner actually wants ("how many people saw this?"),
--   it makes the write idempotent — the client can fire it on every mount and
--   let the database de-duplicate — and it keeps the table bounded by
--   viewers x listings instead of growing with every navigation.
--   The UI must therefore label it "viewers"/"people", never "opens".
--
-- The owner viewing their own listing is never counted: a BEFORE INSERT trigger
-- silently drops that row rather than raising, so the detail screen does not
-- have to special-case it and no error surfaces to the user.
--
-- Reading a count is a single column read on `properties` (`views_count`,
-- maintained by an AFTER INSERT trigger), so the listings screen showing many
-- rows never touches `property_views` at all.
--
-- Idempotent throughout: the earlier migrations may already be applied.

-- ----------------------------------------------------------- property_views
-- viewer_id is the Supabase auth user id (TEXT in this schema, like
-- favorites.user_id and profiles.id), compared against auth.jwt()->>'sub'.
create table if not exists public.property_views (
  id          uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  viewer_id   text not null,
  created_at  timestamptz not null default now(),
  -- The dedupe rule that makes views_count "unique viewers". Also the conflict
  -- target the client's insert uses to turn a repeat view into a no-op.
  constraint property_views_unique_viewer unique (property_id, viewer_id)
);

create index if not exists property_views_property_idx
  on public.property_views (property_id);

-- ------------------------------------------------------- denormalised count
-- Read per listing without touching property_views: the listings screen renders
-- many rows at once and an aggregate per row would scan the views table.
alter table public.properties
  add column if not exists views_count integer not null default 0;

-- ------------------------------------------------------------------ triggers
-- Owners looking at their own listing would otherwise inflate their own number.
-- Returning null skips the insert without raising, so a client that has not yet
-- loaded the owner id still behaves correctly.
create or replace function public.skip_own_property_view()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  prop_owner text;
begin
  select owner_id into prop_owner from public.properties where id = new.property_id;

  if prop_owner is not null and prop_owner = new.viewer_id then
    return null;
  end if;

  return new;
end;
$$;

drop trigger if exists property_views_skip_owner on public.property_views;
create trigger property_views_skip_owner before insert on public.property_views
  for each row execute function public.skip_own_property_view();

-- SECURITY DEFINER because the viewer has no update rights on properties; the
-- counter must move without granting them any.
create or replace function public.bump_property_views_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.properties
     set views_count = views_count + 1
   where id = new.property_id;

  return null; -- AFTER trigger: the return value is ignored.
end;
$$;

drop trigger if exists property_views_bump_count on public.property_views;
create trigger property_views_bump_count after insert on public.property_views
  for each row execute function public.bump_property_views_count();

-- Recompute from the source of truth. Harmless on a fresh install (every count
-- is already 0) and it repairs the denormalisation if this migration is re-run
-- after rows were inserted by an earlier version without the trigger.
update public.properties p
   set views_count = coalesce(v.n, 0)
  from (
    select property_id, count(*)::integer as n
    from public.property_views
    group by property_id
  ) v
 where v.property_id = p.id
   and p.views_count is distinct from v.n;

-- --------------------------------------------------------------------- RLS
alter table public.property_views enable row level security;

drop policy if exists "insert own property view"   on public.property_views;
drop policy if exists "owner reads property views" on public.property_views;

-- A viewer may only ever claim a view as themselves.
create policy "insert own property view" on public.property_views
  for insert to authenticated
  with check ((select auth.jwt()->>'sub') = viewer_id);

-- Raw rows say who looked at what, so they are not public: only the property's
-- owner and the admin may read them. Ordinary visitors get the aggregate that
-- rides along with properties.views_count, and only where the UI shows it.
create policy "owner reads property views" on public.property_views
  for select to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.properties p
      where p.id = property_id
        and p.owner_id = (select auth.jwt()->>'sub')
    )
  );

-- ------------------------------------------------------------------- search
-- Recreated verbatim from 0006 so PostgREST re-reads the return type:
-- search_properties returns `setof public.properties`, and this migration just
-- added views_count to that table.
create or replace function public.search_properties(
  search_query  text default null,
  property_type text default null,
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
      or property_type = 'All'
      or p.type::text = property_type
    )
    and (
      search_query is null
      or search_query = ''
      or p.name    ilike '%' || search_query || '%'
      or p.address ilike '%' || search_query || '%'
      or p.type::text ilike '%' || search_query || '%'
    )
  order by p.created_at desc
  limit  greatest(0, least(coalesce(result_limit, 20), 100))
  offset greatest(0, coalesce(result_offset, 0));
$$;

grant execute on function public.search_properties(text, text, integer, integer) to authenticated;
