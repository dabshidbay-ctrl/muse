-- Service fee on listings, and tour requests that are not stays.
--
-- WHY THIS FILE EXISTS
-- --------------------
-- 1. Owners need a service fee on the property form, visible on the detail
--    page and added to a booking total. It is a new column on properties,
--    idempotent, so re-running is safe. The app also retries
--    create/update without it on PGRST204, so listings published before this
--    migration is run in the Supabase SQL editor still save — the fee just
--    reads as 0 until then.
-- 2. Monthly rentals are Rent + Book a tour, not a day booking. A tour is
--    stored as a bookings row with is_tour = true so it reuses the existing
--    Requests / My bookings UI (owner confirms or declines it, guest sees
--    it), but it must NOT block the calendar: get_booked_ranges is recreated
--    to exclude tour rows. A tour carries only a $15 fee (held in escrow),
--    never a rent payment.
-- Code cannot apply this — run it in the Supabase SQL editor, then reload.

-- ================================================= 1. service fee
alter table public.properties
  add column if not exists service_fee numeric(12,2) not null default 0
    check (service_fee >= 0);

-- ================================================= 2. tour flag
alter table public.bookings
  add column if not exists is_tour boolean not null default false;

-- Tours do not occupy the property, so they stay out of the booked ranges
-- the calendar greys out. Every other clause is verbatim from 0012.
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
    and not coalesce(b.is_tour, false)
  order by b.check_in
$$;

revoke all on function public.get_booked_ranges(uuid) from public;
grant execute on function public.get_booked_ranges(uuid) to authenticated;

-- Ask PostgREST to re-read the schema, so the new columns take effect
-- without waiting for its cache to expire.
notify pgrst, 'reload schema';
