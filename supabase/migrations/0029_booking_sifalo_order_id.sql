-- Store the Sifalo order id on the booking so a pending (603) payment can be
-- re-checked later. The status endpoint needs the exact order_id
-- (booking_<id>_<timestamp>), and it was previously never saved anywhere, so
-- a payment approved on the phone after checkout stayed "pending" forever.
alter table public.bookings add column if not exists sifalo_order_id text;

-- Ask PostgREST to re-read the schema, so the new column takes effect
-- without waiting for its cache to expire.
notify pgrst, 'reload schema';
