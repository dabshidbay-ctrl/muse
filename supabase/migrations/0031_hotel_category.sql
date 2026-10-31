-- Hotels become a listing category alongside Villa, Apartment, Room and BnB.
--
-- Only the enum value is added here. Postgres refuses to *use* a value
-- added by `alter type ... add value` inside the same transaction that
-- added it, so this migration deliberately does nothing else — the app
-- code (constants/data.ts categories, the property form's daily-only
-- forcing for hotels) picks the value up from the next transaction on.
--
-- The hotel_manager role already exists (migration 0024/0025) and is
-- already a publisher for RLS (is_agent), so a hotel manager can post a
-- hotel the moment this value exists. Hotel listings are daily rentals:
-- the form forces rental_mode to short_term for type = 'hotel'.
--
-- Idempotent: safe to re-run.

do $$
begin
  if not exists (
    select 1 from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'property_type' and e.enumlabel = 'hotel'
  ) then
    alter type public.property_type add value 'hotel';
  end if;
end $$;

notify pgrst, 'reload schema';
