-- ReState schema for Supabase
-- Auth is handled by Supabase; auth.jwt()->>'sub' is the user id.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------- agents
create table if not exists public.agents (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  email      text,
  avatar     text,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------ properties
create table if not exists public.properties (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  type        text not null default 'House'
              check (type in ('House','Townhouse','Condo','Duplex','Studio','Villa','Apartment','Other')),
  description text,
  address     text,
  geolocation text,
  price       numeric(12,2) not null default 0,
  area        integer not null default 0,
  bedrooms    integer not null default 0,
  bathrooms   integer not null default 0,
  rating      numeric(2,1) not null default 0 check (rating >= 0 and rating <= 5),
  facilities  text[] not null default '{}',
  image       text,
  agent_id    uuid references public.agents(id) on delete set null,
  created_at  timestamptz not null default now()
);

create index if not exists properties_type_idx    on public.properties (type);
create index if not exists properties_rating_idx  on public.properties (rating desc);
create index if not exists properties_created_idx on public.properties (created_at desc);

-- -------------------------------------------------------------- galleries
create table if not exists public.galleries (
  id          uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  image       text not null
);

create index if not exists galleries_property_idx on public.galleries (property_id);

-- ---------------------------------------------------------------- reviews
create table if not exists public.reviews (
  id          uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  name        text not null,
  avatar      text,
  review      text not null,
  rating      numeric(2,1) not null default 0 check (rating >= 0 and rating <= 5),
  created_at  timestamptz not null default now()
);

create index if not exists reviews_property_idx on public.reviews (property_id);

-- -------------------------------------------------------------- favorites
-- user_id is the Supabase auth user id, compared against auth.jwt()->>'sub'.
create table if not exists public.favorites (
  user_id     text not null,
  property_id uuid not null references public.properties(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (user_id, property_id)
);

create index if not exists favorites_user_idx on public.favorites (user_id);

-- --------------------------------------------------------------------- RLS
alter table public.agents     enable row level security;
alter table public.properties enable row level security;
alter table public.galleries  enable row level security;
alter table public.reviews    enable row level security;
alter table public.favorites  enable row level security;

-- Catalog data: any signed-in Supabase user may read.
drop policy if exists "agents are readable"     on public.agents;
drop policy if exists "properties are readable" on public.properties;
drop policy if exists "galleries are readable"  on public.galleries;
drop policy if exists "reviews are readable"    on public.reviews;

create policy "agents are readable"     on public.agents     for select to authenticated using (true);
create policy "properties are readable" on public.properties for select to authenticated using (true);
create policy "galleries are readable"  on public.galleries  for select to authenticated using (true);
create policy "reviews are readable"    on public.reviews    for select to authenticated using (true);

-- Favorites: a user only ever sees or writes their own rows.
drop policy if exists "read own favorites"   on public.favorites;
drop policy if exists "insert own favorites" on public.favorites;
drop policy if exists "delete own favorites" on public.favorites;

create policy "read own favorites" on public.favorites
  for select to authenticated
  using ((select auth.jwt()->>'sub') = user_id);

create policy "insert own favorites" on public.favorites
  for insert to authenticated
  with check ((select auth.jwt()->>'sub') = user_id);

create policy "delete own favorites" on public.favorites
  for delete to authenticated
  using ((select auth.jwt()->>'sub') = user_id);
