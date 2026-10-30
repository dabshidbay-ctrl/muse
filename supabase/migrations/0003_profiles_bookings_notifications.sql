-- Profiles (with agent role), bookings, and notifications.
--
-- Auth is Supabase; every *_id that identifies a person is the Supabase auth
-- user id (a uuid), read in policies via auth.jwt()->>'sub'.

-- ---------------------------------------------------------------- profiles
create table if not exists public.profiles (
  id         text primary key,               -- Supabase auth user id
  email      text,
  full_name  text,
  avatar_url text,
  -- 'user' can browse and book. 'agent' can additionally publish listings.
  role       text not null default 'user' check (role in ('user', 'agent')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists profiles_role_idx on public.profiles (role);

-- Ownership of a listing, separate from the display-only agents table.
alter table public.properties
  add column if not exists owner_id text references public.profiles(id) on delete set null;

create index if not exists properties_owner_idx on public.properties (owner_id);

-- ---------------------------------------------------------------- bookings
create table if not exists public.bookings (
  id          uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  guest_id    text not null,                 -- Supabase auth user id of the booker
  -- Denormalised so owner policies do not have to join through properties.
  owner_id    text,
  check_in    date not null,
  check_out   date not null,
  guests      integer not null default 1 check (guests >= 1),
  total_price numeric(12,2) not null default 0,
  status      text not null default 'pending'
              check (status in ('pending', 'confirmed', 'declined', 'cancelled')),
  message     text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint bookings_dates_valid check (check_out > check_in)
);

create index if not exists bookings_guest_idx    on public.bookings (guest_id, created_at desc);
create index if not exists bookings_owner_idx    on public.bookings (owner_id, created_at desc);
create index if not exists bookings_property_idx on public.bookings (property_id);

-- ----------------------------------------------------------- notifications
create table if not exists public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     text not null,                 -- recipient's Supabase auth user id
  type        text not null default 'general'
              check (type in ('general', 'booking_requested', 'booking_confirmed',
                              'booking_declined', 'booking_cancelled')),
  title       text not null,
  body        text,
  property_id uuid references public.properties(id) on delete cascade,
  booking_id  uuid references public.bookings(id) on delete cascade,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists notifications_user_idx
  on public.notifications (user_id, created_at desc);
create index if not exists notifications_unread_idx
  on public.notifications (user_id) where read_at is null;

-- ------------------------------------------------------------------ helpers
-- SECURITY DEFINER so the policy check does not recurse into profiles' own RLS.
create or replace function public.current_user_id()
returns text language sql stable as $$
  select (select auth.jwt()->>'sub')
$$;

create or replace function public.is_agent()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.jwt()->>'sub') and p.role::text = 'agent'
  )
$$;

revoke all on function public.is_agent() from public;
grant execute on function public.is_agent() to authenticated;
grant execute on function public.current_user_id() to authenticated;

-- Keeps updated_at honest on every write.
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

drop trigger if exists bookings_touch on public.bookings;
create trigger bookings_touch before update on public.bookings
  for each row execute function public.touch_updated_at();

-- --------------------------------------------------- notification triggers
-- A new request notifies the owner; a status change notifies the guest. Both
-- run as SECURITY DEFINER because the writer is never the recipient.
create or replace function public.notify_on_booking_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  prop_name text;
begin
  select name into prop_name from public.properties where id = new.property_id;

  if new.owner_id is not null and new.owner_id <> new.guest_id then
    insert into public.notifications (user_id, type, title, body, property_id, booking_id)
    values (
      new.owner_id,
      'booking_requested',
      'New booking request',
      coalesce(prop_name, 'A property') || ' requested for ' ||
        to_char(new.check_in, 'DD Mon') || ' to ' || to_char(new.check_out, 'DD Mon'),
      new.property_id,
      new.id
    );
  end if;

  return new;
end;
$$;

drop trigger if exists bookings_notify_insert on public.bookings;
create trigger bookings_notify_insert after insert on public.bookings
  for each row execute function public.notify_on_booking_insert();

create or replace function public.notify_on_booking_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  prop_name text;
  recipient text;
  n_type    text;
  n_title   text;
begin
  if new.status = old.status then
    return new;
  end if;

  select name into prop_name from public.properties where id = new.property_id;

  if new.status = 'cancelled' then
    -- Guest cancelled: tell the owner.
    recipient := new.owner_id;
    n_type    := 'booking_cancelled';
    n_title   := 'Booking cancelled';
  else
    -- Owner responded: tell the guest.
    recipient := new.guest_id;
    n_type    := 'booking_' || new.status;
    n_title   := case new.status
                   when 'confirmed' then 'Booking confirmed'
                   when 'declined'  then 'Booking declined'
                   else 'Booking updated'
                 end;
  end if;

  if recipient is not null then
    insert into public.notifications (user_id, type, title, body, property_id, booking_id)
    values (recipient, n_type, n_title,
            coalesce(prop_name, 'Your booking') || ' — ' || new.status,
            new.property_id, new.id);
  end if;

  return new;
end;
$$;

drop trigger if exists bookings_notify_status on public.bookings;
create trigger bookings_notify_status after update of status on public.bookings
  for each row execute function public.notify_on_booking_status();

-- --------------------------------------------------------------------- RLS
alter table public.profiles      enable row level security;
alter table public.bookings      enable row level security;
alter table public.notifications enable row level security;

-- profiles: everyone sees their own row; agent rows are public (they are shown
-- on listings), but non-agent rows stay private.
drop policy if exists "read own or agent profiles" on public.profiles;
drop policy if exists "insert own profile"         on public.profiles;
drop policy if exists "update own profile"         on public.profiles;

create policy "read own or agent profiles" on public.profiles
  for select to authenticated
  using ((select auth.jwt()->>'sub') = id or role::text = 'agent');

create policy "insert own profile" on public.profiles
  for insert to authenticated
  with check ((select auth.jwt()->>'sub') = id);

-- Role is deliberately not self-assignable: promotion happens in the dashboard.
create policy "update own profile" on public.profiles
  for update to authenticated
  using ((select auth.jwt()->>'sub') = id)
  with check ((select auth.jwt()->>'sub') = id and role = (select p.role from public.profiles p where p.id = profiles.id));

-- properties: publishing is gated on the agent role; edits are owner-only.
drop policy if exists "agents insert own properties" on public.properties;
drop policy if exists "owners update own properties" on public.properties;
drop policy if exists "owners delete own properties" on public.properties;

create policy "agents insert own properties" on public.properties
  for insert to authenticated
  with check ((select auth.jwt()->>'sub') = owner_id and public.is_agent());

create policy "owners update own properties" on public.properties
  for update to authenticated
  using ((select auth.jwt()->>'sub') = owner_id)
  with check ((select auth.jwt()->>'sub') = owner_id);

create policy "owners delete own properties" on public.properties
  for delete to authenticated
  using ((select auth.jwt()->>'sub') = owner_id);

-- bookings: guest and owner each see their side; only the guest creates,
-- and updates are restricted to the two legitimate transitions.
drop policy if exists "read own bookings"    on public.bookings;
drop policy if exists "guest inserts booking" on public.bookings;
drop policy if exists "participants update booking" on public.bookings;

create policy "read own bookings" on public.bookings
  for select to authenticated
  using ((select auth.jwt()->>'sub') in (guest_id, owner_id));

create policy "guest inserts booking" on public.bookings
  for insert to authenticated
  with check ((select auth.jwt()->>'sub') = guest_id);

create policy "participants update booking" on public.bookings
  for update to authenticated
  using ((select auth.jwt()->>'sub') in (guest_id, owner_id))
  with check ((select auth.jwt()->>'sub') in (guest_id, owner_id));

-- notifications: strictly private to the recipient. Rows are created by the
-- SECURITY DEFINER triggers above, so there is no insert policy for clients.
drop policy if exists "read own notifications"   on public.notifications;
drop policy if exists "update own notifications" on public.notifications;

create policy "read own notifications" on public.notifications
  for select to authenticated
  using ((select auth.jwt()->>'sub') = user_id);

create policy "update own notifications" on public.notifications
  for update to authenticated
  using ((select auth.jwt()->>'sub') = user_id)
  with check ((select auth.jwt()->>'sub') = user_id);
