-- Parameterised search + indexes to back it.
--
-- The client used to build a PostgREST `or=` filter by string interpolation,
-- which let any punctuation in the search box ("a,b", "x)") break out into
-- arbitrary filter syntax. Binding the query as a real function parameter
-- removes that class of bug entirely.

-- Trigram indexes so the ILIKE '%...%' probes below can use an index instead
-- of sequential-scanning every property.
create extension if not exists pg_trgm;

create index if not exists properties_name_trgm_idx
  on public.properties using gin (name gin_trgm_ops);
create index if not exists properties_address_trgm_idx
  on public.properties using gin (address gin_trgm_ops);

create or replace function public.search_properties(
  search_query  text default null,
  property_type text default null,
  result_limit  integer default 20,
  result_offset integer default 0
)
returns setof public.properties
language sql
stable
-- SECURITY INVOKER (the default) is deliberate: the caller's RLS policies
-- still apply, so this function cannot be used to read past them.
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
  -- Clamp so a client cannot ask for an unbounded page.
  limit  greatest(0, least(coalesce(result_limit, 20), 100))
  offset greatest(0, coalesce(result_offset, 0));
$$;

revoke all on function public.search_properties(text, text, integer, integer) from public;
grant execute on function public.search_properties(text, text, integer, integer) to authenticated;
