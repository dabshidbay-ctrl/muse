-- Payment fields for bookings.
--
-- Adds Sifalo payment tracking to the bookings table. A booking is created
-- with payment_status = 'unpaid' and the guest is redirected to the Sifalo
-- checkout page. Once payment completes, the Sifalo webhook or the verify
-- flow updates the row.
--
-- Idempotent: safe to re-run.

alter table public.bookings
  add column if not exists payment_status text not null default 'unpaid'
  check (payment_status in ('unpaid', 'pending', 'paid', 'failed', 'refunded'));

alter table public.bookings
  add column if not exists sifalo_sid text;

alter table public.bookings
  add column if not exists paid_amount numeric(12,2);

alter table public.bookings
  add column if not exists payment_method text;