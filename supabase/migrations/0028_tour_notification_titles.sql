-- Tour requests should not read as stays in a notification.
--
-- WHY THIS FILE EXISTS
-- --------------------
-- The booking triggers from 0003 predate tours (0027): a tour request
-- arrived as "New booking request … requested for 05 Dec to 06 Dec", which
-- reads like a stay and hides the WhatsApp number. With this file the
-- owner gets "New tour request" with the tour date and the tenant's
-- WhatsApp number (which the tour form puts first in the message), and a
-- confirm/decline reads "Tour confirmed" / "Tour declined" for the guest.
-- The notification *type* stays a booking_* type, so the app's existing
-- routing (tap → bookings list, where tours show as a Tour pill) is
-- unchanged. Run this in the Supabase SQL editor, like 0026/0027 — code
-- cannot change database triggers.

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
      case when coalesce(new.is_tour, false) then 'New tour request' else 'New booking request' end,
      case when coalesce(new.is_tour, false)
        then coalesce(prop_name, 'A property') || ' — tour on ' ||
             to_char(new.check_in, 'DD Mon') ||
             coalesce(' — ' || new.message, '')
        else coalesce(prop_name, 'A property') || ' requested for ' ||
             to_char(new.check_in, 'DD Mon') || ' to ' || to_char(new.check_out, 'DD Mon')
      end,
      new.property_id,
      new.id
    );
  end if;

  return new;
end;
$$;

-- Verbatim copy of the 0006 version (actor routing, self-notification
-- guard, and "any other transition sends nothing"), with only the titles
-- changed for tours.
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
    recipient := case when actor is not distinct from new.guest_id
                        then new.owner_id
                        else new.guest_id
                 end;
    n_type    := 'booking_cancelled';
    n_title   := case when coalesce(new.is_tour, false) then 'Tour cancelled' else 'Booking cancelled' end;
  elsif new.status = 'confirmed' then
    recipient := new.guest_id;
    n_type    := 'booking_confirmed';
    n_title   := case when coalesce(new.is_tour, false) then 'Tour confirmed' else 'Booking confirmed' end;
  elsif new.status = 'declined' then
    recipient := new.guest_id;
    n_type    := 'booking_declined';
    n_title   := case when coalesce(new.is_tour, false) then 'Tour declined' else 'Booking declined' end;
  else
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

-- The triggers themselves already exist (0003/0006); replacing the functions
-- is enough. Re-create them defensively so a database that somehow lost a
-- trigger regains it.
drop trigger if exists bookings_notify_insert on public.bookings;
create trigger bookings_notify_insert after insert on public.bookings
  for each row execute function public.notify_on_booking_insert();

drop trigger if exists bookings_notify_status on public.bookings;
create trigger bookings_notify_status after update of status on public.bookings
  for each row execute function public.notify_on_booking_status();

notify pgrst, 'reload schema';
