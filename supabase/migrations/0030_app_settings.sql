-- App-wide settings the admin edits from the admin page, starting with the
-- WhatsApp number that property detail pages chat to.
--
-- A single key/value table (not a column on some other table) so new
-- settings can be added without another migration. `key` is the primary
-- key, which is also what makes the client's upsert conflict-safe.
--
-- Idempotent: safe to re-run.

create table if not exists public.app_settings (
  key text primary key,
  value text not null default '',
  updated_at timestamptz not null default now()
);

alter table public.app_settings enable row level security;

-- Public read: visitors on a property page are not signed in, and the
-- WhatsApp button needs the number before any sign-in.
drop policy if exists "public read app settings" on public.app_settings;

create policy "public read app settings" on public.app_settings
  for select to anon, authenticated
  using (true);

-- Admin write only. The admin check is the same shape as the other admin
-- policies (migration 0004): the caller's profile row must say 'admin'.
drop policy if exists "admin write app settings" on public.app_settings;

create policy "admin write app settings" on public.app_settings
  for all to authenticated
  using (
    (select p.role from public.profiles p
     where p.id = (select auth.jwt()->>'sub')) = 'admin'
  )
  with check (
    (select p.role from public.profiles p
     where p.id = (select auth.jwt()->>'sub')) = 'admin'
  );

-- Seed the WhatsApp key as empty so the admin page always has a row to
-- edit; an empty value hides the WhatsApp button on property pages.
insert into public.app_settings (key, value)
values ('whatsapp_number', '')
on conflict (key) do nothing;

notify pgrst, 'reload schema';
