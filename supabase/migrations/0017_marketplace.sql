-- Marketplace: any signed-in user can list a piece of furniture for sale, an
-- admin approves it, and only then does it become public.
--
-- The whole design turns on one sentence: **a buyer must never be able to read
-- a seller's phone number.** RLS filters ROWS, not COLUMNS. There is no
-- "select every column except phone" policy in Postgres, so if `phone` lived on
-- public.marketplace_items then `select *` — or `select phone` — from any
-- authenticated buyer would return it, no matter how the row policy was
-- written. The contact details therefore live in a SECOND table whose read
-- policy is seller-or-admin, and the public table has no contact column at all.
-- A buyer cannot leak what the row they can see does not contain.
--
-- Idempotent AND replay-safe: `supabase db push` re-applies the whole folder,
-- so every statement here has to survive running against an already-migrated
-- database. See 0016 for the two traps that shaped this file — an RPC parameter
-- sharing a name with a column resolves to the column, and function overloads
-- accumulate across replays. This migration adds no overloadable RPC, so the
-- guards it needs are the ordinary ones: enum creation behind an existence
-- check (never `alter type ... add value`, which cannot be used later in the
-- transaction that adds it), `create table if not exists`, `add column if not
-- exists`, `create or replace function`, and drop-then-create for every policy
-- and trigger.

-- ================================================================ 1. enums
-- Created in one shot inside a guard, for the reason spelled out in 0016: the
-- CLI runs each migration in a transaction and ADD VALUE is unusable in the
-- same transaction that created the type, so the column definitions below
-- would have no usable type to reference on a fresh database.
do $$ begin
  if not exists (
    select 1 from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'marketplace_status'
  ) then
    create type public.marketplace_status as enum ('pending', 'approved', 'rejected');
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'marketplace_condition'
  ) then
    create type public.marketplace_condition as enum ('new', 'like_new', 'good', 'fair');
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'marketplace_category'
  ) then
    create type public.marketplace_category as enum (
      'sofa', 'bed', 'table', 'chair', 'wardrobe',
      'kitchen', 'appliance', 'decor', 'office', 'other'
    );
  end if;
end $$;

-- ====================================================== 2. the public table
-- Everything a buyer is allowed to see, and nothing else. There is deliberately
-- no phone, no email and no seller name here: see the header.
--
-- `seller_id` is text, not uuid, because it holds auth.jwt()->>'sub' and every
-- other ownership column in this schema (properties.owner_id aside, which
-- predates that convention) compares against that claim as text. Comparing a
-- uuid column to the text claim would need a cast on every policy, and a cast
-- that throws on a malformed claim fails *open* in some plans.
--
-- `district` reuses the enum from 0016 and is nullable: "not specified" is a
-- valid answer for a sofa, exactly as it is for a listing.
create table if not exists public.marketplace_items (
  id          uuid primary key default gen_random_uuid(),
  seller_id   text not null,
  title       text not null,
  description text,
  category    public.marketplace_category  not null default 'other',
  condition   public.marketplace_condition not null default 'good',
  price       numeric(12,2) not null default 0 check (price >= 0),
  negotiable  boolean not null default false,
  district    public.mogadishu_district,
  -- Public URLs from the marketplace-photos bucket. Only the MAXIMUM is a
  -- database rule, for the same reason as the 18-photo gallery cap in 0012: a
  -- minimum of 1 enforced at row level would be a publish-time rule pretending
  -- to be a row-level one. MIN_ITEM_PHOTOS lives in lib/marketplaceApi.ts.
  images      text[] not null default '{}' check (cardinality(images) <= 8),
  status      public.marketplace_status not null default 'pending',
  -- The admin's reason when rejected. A silent rejection is indistinguishable
  -- from a bug, so the seller is shown this.
  review_note text,
  reviewed_by text,
  reviewed_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ===================================================== 3. the private table
-- One row per item, holding the contact details a buyer may never read.
--
-- item_id is the primary key as well as the foreign key: an item has exactly
-- one contact record, and `on delete cascade` means deleting the item takes the
-- phone number with it. A phone number outliving the listing it belongs to
-- would be personal data with no owner and no way to reach it.
create table if not exists public.marketplace_contacts (
  item_id    uuid primary key references public.marketplace_items(id) on delete cascade,
  phone      text not null,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------------ indexes
-- The browse screen filters on status (always) plus category / district, and
-- orders by created_at. `mine` filters on seller_id.
create index if not exists marketplace_items_status_idx    on public.marketplace_items (status);
create index if not exists marketplace_items_seller_idx    on public.marketplace_items (seller_id);
create index if not exists marketplace_items_category_idx  on public.marketplace_items (category);
create index if not exists marketplace_items_district_idx  on public.marketplace_items (district);
create index if not exists marketplace_items_created_idx   on public.marketplace_items (created_at desc);

-- ------------------------------------------------------------- updated_at
drop trigger if exists marketplace_items_touch on public.marketplace_items;
create trigger marketplace_items_touch
  before update on public.marketplace_items
  for each row execute function public.touch_updated_at();

-- ============================================================= 4. RLS: items
alter table public.marketplace_items    enable row level security;
alter table public.marketplace_contacts enable row level security;

-- Every policy below is drop-then-create so a replay converges on exactly one
-- definition rather than erroring on a duplicate name.
drop policy if exists "read approved or own marketplace items" on public.marketplace_items;
drop policy if exists "insert own marketplace item"            on public.marketplace_items;
drop policy if exists "seller updates own unapproved item"     on public.marketplace_items;
drop policy if exists "admin updates any marketplace item"     on public.marketplace_items;
drop policy if exists "delete own marketplace item"            on public.marketplace_items;
drop policy if exists "admin deletes any marketplace item"     on public.marketplace_items;

-- SELECT: approved is public (to signed-in users), a seller additionally sees
-- their own pending/rejected rows, an admin sees everything.
--
-- Note what this does NOT do: it does not query marketplace_items. is_admin()
-- reads public.profiles, so there is no path back into this table and no way
-- to reproduce the 42P17 recursion of 0009/0010.
create policy "read approved or own marketplace items" on public.marketplace_items
  for select to authenticated
  using (
    status = 'approved'
    or seller_id = (select auth.jwt()->>'sub')
    or public.is_admin()
  );

-- INSERT: any authenticated user, tenants included — unlike property listings
-- this is not role-gated. The only rule is that you cannot list on someone
-- else's behalf. `status` is not constrained here; the trigger in section 6
-- owns that, because a WITH CHECK that had to compare against the row's
-- previous state cannot see one on INSERT anyway.
create policy "insert own marketplace item" on public.marketplace_items
  for insert to authenticated
  with check (seller_id = (select auth.jwt()->>'sub'));

-- UPDATE (seller): own row, and only while it is not yet approved. Without the
-- status test a seller could get a benign chair approved and then swap the
-- title, photos and price for something else, using the approval as cover.
--
-- USING sees the row as it currently is; WITH CHECK sees the proposed row and
-- only pins ownership, so a seller cannot hand their item to someone else. It
-- deliberately does not mention `status`: enforcing that here would tempt the
-- next author into a subquery on this same table.
create policy "seller updates own unapproved item" on public.marketplace_items
  for update to authenticated
  using (
    seller_id = (select auth.jwt()->>'sub')
    and status <> 'approved'
  )
  with check (seller_id = (select auth.jwt()->>'sub'));

-- UPDATE (admin): a separate permissive policy, OR'd with the one above. This
-- is how approve/reject happens — there is no privileged RPC.
create policy "admin updates any marketplace item" on public.marketplace_items
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "delete own marketplace item" on public.marketplace_items
  for delete to authenticated
  using (seller_id = (select auth.jwt()->>'sub'));

create policy "admin deletes any marketplace item" on public.marketplace_items
  for delete to authenticated
  using (public.is_admin());

-- ========================================================== 5. RLS: contacts
-- THE PRIVACY REQUIREMENT. Seller of the item, or admin. Nobody else, ever.
--
-- The EXISTS reaches into marketplace_items — a different table, so this is an
-- ordinary cross-table policy and not the self-reference that causes 42P17.
-- It is also belt and braces: that subquery runs under the caller's own RLS, so
-- for a buyer the item row is either invisible (pending) or visible but not
-- theirs, and `seller_id = sub` is false in both cases. Two independent reasons
-- the buyer gets zero rows.
drop policy if exists "seller or admin reads marketplace contact"   on public.marketplace_contacts;
drop policy if exists "seller inserts marketplace contact"          on public.marketplace_contacts;
drop policy if exists "seller or admin updates marketplace contact" on public.marketplace_contacts;
drop policy if exists "seller or admin deletes marketplace contact" on public.marketplace_contacts;

create policy "seller or admin reads marketplace contact" on public.marketplace_contacts
  for select to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.marketplace_items i
      where i.id = item_id
        and i.seller_id = (select auth.jwt()->>'sub')
    )
  );

-- INSERT: only the seller of the item, so nobody can attach a phone number to
-- somebody else's listing.
create policy "seller inserts marketplace contact" on public.marketplace_contacts
  for insert to authenticated
  with check (
    exists (
      select 1 from public.marketplace_items i
      where i.id = item_id
        and i.seller_id = (select auth.jwt()->>'sub')
    )
  );

create policy "seller or admin updates marketplace contact" on public.marketplace_contacts
  for update to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.marketplace_items i
      where i.id = item_id
        and i.seller_id = (select auth.jwt()->>'sub')
    )
  )
  with check (
    public.is_admin()
    or exists (
      select 1 from public.marketplace_items i
      where i.id = item_id
        and i.seller_id = (select auth.jwt()->>'sub')
    )
  );

create policy "seller or admin deletes marketplace contact" on public.marketplace_contacts
  for delete to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.marketplace_items i
      where i.id = item_id
        and i.seller_id = (select auth.jwt()->>'sub')
    )
  );

-- ====================================================== 6. the status trigger
-- Approval is admin-only. A seller may edit their unapproved item freely but
-- may not move `status` — otherwise "pending moderation" is advisory.
--
-- This is a TRIGGER, not a policy WITH CHECK, and that is not a style choice.
-- Expressing "the new status may only differ from the old one if the caller is
-- an admin" in a policy means reading the row's previous state from inside a
-- policy on the very table being read, which is exactly the shape that gave
-- this schema 42P17 (infinite recursion detected in policy) twice — see the
-- write-ups in 0009/0010 and the fix in 0013. A BEFORE trigger sees OLD and
-- NEW directly, needs no second lookup, and runs regardless of RLS, so the
-- rule is stronger than the policy clause it replaces, not weaker.
--
-- SECURITY DEFINER with a pinned search_path, for 0013's reason: a trigger body
-- runs as the calling role, and `authenticated` is not guaranteed USAGE on the
-- auth schema, which would make auth.jwt() fail with "permission denied for
-- schema auth" and block every write.
--
-- The `claim is null` branch keeps the Supabase dashboard, migrations and the
-- service_role key working: those carry no `sub`, so they are trusted.
create or replace function public.enforce_marketplace_status()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  claim text := (select auth.jwt()->>'sub');
begin
  -- No JWT: dashboard, migration, or service role. Trusted.
  if claim is null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- Everything starts in the queue. An admin may seed an already-approved
    -- row (they could approve it a millisecond later anyway); a seller may not.
    if new.status <> 'pending' and not public.is_admin() then
      raise exception
        'A marketplace item starts as pending; only an administrator can approve it.'
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  -- UPDATE. An edit that leaves status alone is none of this trigger's
  -- business, and is the common case, so it returns first.
  if new.status is not distinct from old.status then
    -- The review fields belong to the reviewer. A seller re-saving their form
    -- would otherwise be able to invent an admin's rejection note.
    if not public.is_admin() and (
         new.review_note is distinct from old.review_note
      or new.reviewed_by is distinct from old.reviewed_by
      or new.reviewed_at is distinct from old.reviewed_at
    ) then
      raise exception 'Only an administrator can set a review note.'
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  if not public.is_admin() then
    raise exception
      'Only an administrator can change the status of a marketplace item.'
      using errcode = 'check_violation';
  end if;

  -- Stamp the reviewer here rather than trusting the client to send it, so the
  -- audit trail cannot disagree with who actually performed the update.
  new.reviewed_by := claim;
  new.reviewed_at := now();

  -- A note explains a rejection. Carrying one over onto an approval would show
  -- the seller "rejected because ..." next to an approved badge.
  if new.status <> 'rejected' then
    new.review_note := null;
  end if;

  return new;
end;
$$;

drop trigger if exists marketplace_items_enforce_status on public.marketplace_items;
create trigger marketplace_items_enforce_status
  before insert or update on public.marketplace_items
  for each row execute function public.enforce_marketplace_status();

-- ======================================================== 7. storage bucket
-- `marketplace-photos`: public read (the URLs go straight into <Image src>),
-- any authenticated user may upload, and only the uploader may delete.
--
-- Wrapped in a DO block that bails out when the storage schema is absent:
-- PGlite (the test harness) has no storage schema, and the rest of this
-- migration must still apply there. Every statement goes through EXECUTE so
-- plpgsql never plans them on a database where the tables do not exist.
do $$ begin
  if to_regclass('storage.objects') is null then
    return;
  end if;

  execute $s$
    insert into storage.buckets (id, name, public)
    values ('marketplace-photos', 'marketplace-photos', true)
    on conflict (id) do update set public = true
  $s$;

  execute 'drop policy if exists "marketplace photos are publicly readable" on storage.objects';
  execute 'drop policy if exists "authenticated uploads marketplace photos" on storage.objects';
  execute 'drop policy if exists "uploader deletes own marketplace photo"   on storage.objects';
  execute 'drop policy if exists "uploader updates own marketplace photo"   on storage.objects';

  execute $s$
    create policy "marketplace photos are publicly readable" on storage.objects
      for select using (bucket_id = 'marketplace-photos')
  $s$;

  execute $s$
    create policy "authenticated uploads marketplace photos" on storage.objects
      for insert to authenticated
      with check (bucket_id = 'marketplace-photos')
  $s$;

  -- `owner` is set by Supabase Storage to the uploading user, so this is the
  -- "only the uploader may delete" rule without a second bookkeeping table.
  execute $s$
    create policy "uploader deletes own marketplace photo" on storage.objects
      for delete to authenticated
      using (
        bucket_id = 'marketplace-photos'
        and owner = (select auth.jwt()->>'sub')::uuid
      )
  $s$;

  execute $s$
    create policy "uploader updates own marketplace photo" on storage.objects
      for update to authenticated
      using (
        bucket_id = 'marketplace-photos'
        and owner = (select auth.jwt()->>'sub')::uuid
      )
  $s$;
end $$;
