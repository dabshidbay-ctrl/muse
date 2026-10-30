-- A way for a buyer to reach a seller.
--
-- The marketplace shipped with no path between them at all: a seller's phone is
-- admin-only by design, and nothing else connected the two. The item page even
-- told buyers "our team arranges contact", describing a process that did not
-- exist. This builds the process.
--
-- THE DIRECTION MATTERS. The seller's number stays private — that was the
-- product requirement and it is unchanged. What moves is the *buyer's* number,
-- and only because the buyer chooses to send it: enquiring is the act of
-- sharing your contact details with that one seller. So:
--
--   buyer  -> seller : phone shared, deliberately, per enquiry
--   seller -> buyer  : nothing shared, ever
--
-- The seller can then call the buyer back. Nobody's number is published, and no
-- number moves without its owner pressing a button.
--
-- Idempotent: safe to re-run.

-- ----------------------------------------------------------------- enquiries
create table if not exists public.marketplace_enquiries (
  id         uuid primary key default gen_random_uuid(),
  item_id    uuid not null references public.marketplace_items(id) on delete cascade,
  buyer_id   text not null,
  -- The buyer's own number, given at the moment of enquiry. Not read from their
  -- profile: sharing has to be an explicit act, not a setting they forgot about.
  buyer_phone text not null,
  message    text,
  created_at timestamptz not null default now(),
  -- One enquiry per buyer per item. Without this a frustrated buyer can send
  -- the same request twenty times and the seller gets twenty notifications.
  constraint marketplace_enquiries_once unique (item_id, buyer_id)
);

create index if not exists marketplace_enquiries_item_idx
  on public.marketplace_enquiries (item_id, created_at desc);

alter table public.marketplace_enquiries enable row level security;

-- Read: the buyer who sent it, the seller of the item, and admins. Nobody else
-- — an enquiry carries a phone number, so this list is deliberately short.
drop policy if exists "read own or received enquiries" on public.marketplace_enquiries;

create policy "read own or received enquiries" on public.marketplace_enquiries
  for select to authenticated
  using (
    (select auth.jwt()->>'sub') = buyer_id
    or public.is_admin()
    or exists (
      select 1 from public.marketplace_items i
      where i.id = marketplace_enquiries.item_id
        and i.seller_id = (select auth.jwt()->>'sub')
    )
  );

-- Insert: only as yourself, only on an approved item, and never on your own
-- listing. Enquiring about an unapproved item would also leak that it exists.
drop policy if exists "buyer sends enquiry" on public.marketplace_enquiries;

create policy "buyer sends enquiry" on public.marketplace_enquiries
  for insert to authenticated
  with check (
    (select auth.jwt()->>'sub') = buyer_id
    and exists (
      select 1 from public.marketplace_items i
      where i.id = marketplace_enquiries.item_id
        and i.status = 'approved'
        and i.seller_id <> (select auth.jwt()->>'sub')
    )
  );

-- Withdraw: the buyer can take their number back; admins can remove abuse.
drop policy if exists "buyer or admin deletes enquiry" on public.marketplace_enquiries;

create policy "buyer or admin deletes enquiry" on public.marketplace_enquiries
  for delete to authenticated
  using ((select auth.jwt()->>'sub') = buyer_id or public.is_admin());

-- ------------------------------------------------------------- notifications
-- Reuse the existing table rather than inventing a second inbox. Two additions:
-- the new type, and a column to point at the item.
alter table public.notifications
  drop constraint if exists notifications_type_check;

alter table public.notifications
  add constraint notifications_type_check
  check (type in ('general', 'booking_requested', 'booking_confirmed',
                  'booking_declined', 'booking_cancelled',
                  'marketplace_enquiry'));

alter table public.notifications
  add column if not exists marketplace_item_id uuid
  references public.marketplace_items(id) on delete cascade;

-- SECURITY DEFINER: the buyer has no insert rights on the *seller's*
-- notifications, and should not — the row is written on their behalf.
create or replace function public.notify_on_marketplace_enquiry()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  seller  text;
  item_title text;
begin
  select i.seller_id, i.title into seller, item_title
  from public.marketplace_items i
  where i.id = new.item_id;

  if seller is null then
    return new;
  end if;

  insert into public.notifications (user_id, type, title, body, marketplace_item_id)
  values (
    seller,
    'marketplace_enquiry',
    'Someone is interested',
    coalesce(item_title, 'Your item') ||
      ' — a buyer left their number so you can get in touch.',
    new.item_id
  );

  return new;
end;
$$;

drop trigger if exists marketplace_enquiries_notify on public.marketplace_enquiries;
create trigger marketplace_enquiries_notify
  after insert on public.marketplace_enquiries
  for each row execute function public.notify_on_marketplace_enquiry();
