-- Publisher contact details, the hotel-manager role, and the extra listing
-- facts the form now collects (living rooms, floor number).
--
-- THE PRIVACY RULE THIS FILE EXISTS FOR
-- -------------------------------------
-- A publisher (property owner, agency, hotel manager) must register a phone
-- number, and that number must never be readable by the public. RLS filters
-- ROWS, not COLUMNS: if `phone` lived on public.profiles then any authenticated
-- user could `select phone from profiles` and read every publisher's number,
-- because the existing "read own or agent profiles" policy already lets every
-- signed-in user read publisher rows. So the number lives in its own table
-- whose read policy is self-or-admin, exactly like public.marketplace_contacts
-- (0017). A row a visitor cannot see cannot leak a column.
--
-- The same reasoning is why the listing page no longer joins public.agents:
-- that table is world-readable and carries an email address. Poster identity is
-- now an admin-only read (see lib/adminApi.ts).
--
-- Idempotent: safe to re-run.

-- ====================================================== 1. hotel managers
-- `alter type ... add value` cannot be *used* in the transaction that adds it,
-- so the value is added here and only referenced from 0025. Splitting the two
-- is what keeps a fresh `supabase db push` working.
alter type public.user_role add value if not exists 'hotel_manager';

-- ================================================ 2. listing detail columns
-- Living rooms and floor number are small bounded counts, like bedrooms and
-- bathrooms. `floor_number` is nullable because "ground floor" and "not
-- specified" are both real answers and 0 would be a lie for the latter.
alter table public.properties
  add column if not exists living_rooms integer not null default 0
    check (living_rooms >= 0);

alter table public.properties
  add column if not exists floor_number integer
    check (floor_number >= 0);

-- ================================================= 3. publisher phone table
-- One row per profile, holding the number a visitor may never read.
--
-- profile_id is the primary key as well as the foreign key: a person has
-- exactly one contact number, and `on delete cascade` means deleting the
-- account takes the number with it rather than leaving personal data with no
-- owner.
create table if not exists public.profile_contacts (
  profile_id text primary key references public.profiles(id) on delete cascade,
  phone      text not null,
  created_at timestamptz not null default now()
);

alter table public.profile_contacts enable row level security;

-- Read: the owner of the number, and administrators. Nobody else — this is the
-- whole point of the separate table.
drop policy if exists "read own or admin contact" on public.profile_contacts;

create policy "read own or admin contact" on public.profile_contacts
  for select to authenticated
  using (
    (select auth.jwt()->>'sub') = profile_id
    or public.is_admin()
  );

-- Write: only as yourself. An admin does not need to write someone else's
-- number, and allowing it would let one admin plant a number on another
-- account.
drop policy if exists "insert own contact" on public.profile_contacts;
drop policy if exists "update own contact" on public.profile_contacts;

create policy "insert own contact" on public.profile_contacts
  for insert to authenticated
  with check ((select auth.jwt()->>'sub') = profile_id);

create policy "update own contact" on public.profile_contacts
  for update to authenticated
  using ((select auth.jwt()->>'sub') = profile_id)
  with check ((select auth.jwt()->>'sub') = profile_id);
