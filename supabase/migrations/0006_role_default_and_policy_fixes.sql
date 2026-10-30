-- Consistency fixes between the schema and what the client actually queries.
--
-- Everything here is additive and idempotent: 0001-0005 may already be applied,
-- so this migration only re-creates policies/functions and adjusts defaults.
--
-- What it fixes:
--   1. profiles.role still defaulted to the pre-0004 value 'user', which the
--      0004 check constraint rejects. Every sign-up (handle_new_user) and every
--      first-run ensureProfile() insert failed with a constraint violation.
--   2. The profiles select policy still published 'agent' rows — a role that no
--      longer exists after the 0004 rename.
--   3. An admin editing someone else's listing could delete amenities but not
--      insert them, so PropertyForm's replaceAmenities() half-failed.
--   4. notify_on_booking_status() built the notification type by string
--      concatenation, which can produce a value the notifications type check
--      rejects and abort the booking update.
--   5. The bookings update policy let a guest confirm their own booking.

-- ----------------------------------------------------------------- profiles
-- Backfill any rows that predate 0004 (if 0004 aborted on its own constraint,
-- these rows are still 'user'/'agent'), then restate the constraint.
alter table public.profiles
  drop constraint if exists profiles_role_check;

-- `::text` so this still parses after 0011 turns `role` into an enum -- the
-- retired 'user'/'agent' strings are not enum labels, so an uncast
-- comparison errors when the CLI replays this file.
update public.profiles set role = 'tenant'         where role::text = 'user';
update public.profiles set role = 'property_owner' where role::text = 'agent';

alter table public.profiles
  add constraint profiles_role_check
  check (role in ('tenant', 'property_owner', 'agency', 'admin'));

-- The default is what handle_new_user() and ensureProfile() rely on: neither
-- sends `role`, and the README promises a new user lands on 'tenant'.
alter table public.profiles
  alter column role set default 'tenant';

-- Publisher profiles are shown alongside listings, so they stay readable; the
-- clause just names the post-0004 roles instead of the retired 'agent'.
drop policy if exists "read own or agent profiles" on public.profiles;

create policy "read own or agent profiles" on public.profiles
  for select to authenticated
  using (
    (select auth.jwt()->>'sub') = id
    or role in ('property_owner', 'agency')
  );

-- ---------------------------------------------------------------- amenities
-- An admin may already update and delete any listing; without this they cannot
-- write the amenity rows that saving that listing produces.
drop policy if exists "admin inserts amenities" on public.amenities;

create policy "admin inserts amenities" on public.amenities
  for insert to authenticated
  with check (public.is_admin());

-- ----------------------------------------------------------------- bookings
-- Guest cancels, owner confirms/declines/cancels. USING still lets either side
-- touch the row (updated_at, message); WITH CHECK is what pins down the status
-- a guest may land on.
drop policy if exists "participants update booking" on public.bookings;

create policy "participants update booking" on public.bookings
  for update to authenticated
  using ((select auth.jwt()->>'sub') in (guest_id, owner_id))
  with check (
    (select auth.jwt()->>'sub') = owner_id
    or (
      (select auth.jwt()->>'sub') = guest_id
      and status in ('pending', 'cancelled')
    )
  );

-- --------------------------------------------------- notification triggers
-- Map the status to a notification type explicitly. 'booking_' || new.status
-- produced 'booking_pending' for a re-open, which the notifications type check
-- rejects — and because the trigger is AFTER UPDATE, that aborted the booking
-- update the client was making.
create or replace function public.notify_on_booking_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  prop_name text;
  recipient text;
  actor     text := (select auth.jwt()->>'sub');
  n_type    text;
  n_title   text;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  select name into prop_name from public.properties where id = new.property_id;

  if new.status = 'cancelled' then
    -- Either side may cancel, so the notice goes to whichever participant did
    -- not do it. Assuming the guest withdrew means an owner-side cancellation
    -- addresses the owner, and the self-notification guard below then drops it
    -- entirely -- leaving the guest never told their stay was called off.
    recipient := case when actor is not distinct from new.guest_id
                        then new.owner_id
                        else new.guest_id
                 end;
    n_type    := 'booking_cancelled';
    n_title   := 'Booking cancelled';
  elsif new.status = 'confirmed' then
    recipient := new.guest_id;
    n_type    := 'booking_confirmed';
    n_title   := 'Booking confirmed';
  elsif new.status = 'declined' then
    recipient := new.guest_id;
    n_type    := 'booking_declined';
    n_title   := 'Booking declined';
  else
    -- Any other transition (e.g. back to 'pending') is not worth a notification.
    return new;
  end if;

  if recipient is not null and recipient is distinct from actor then
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

-- ------------------------------------------------------------------- search
-- Recreated verbatim so PostgREST re-reads the return type: search_properties
-- returns `setof public.properties`, and 0004 added rental_mode and
-- nearby_facilities to that table after the function was first defined.
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
