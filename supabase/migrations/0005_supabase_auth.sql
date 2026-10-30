-- Switch auth from Clerk (third-party JWT) to Supabase-native auth.
--
-- With Supabase auth, auth.jwt()->>'sub' is the *Supabase* user id (a uuid,
-- not a Clerk "user_..." string). The profiles pk and every *_id column that
-- used to hold a Clerk id now hold the Supabase auth user id.
--
-- This migration:
--   1. re-creates the role helpers against the new id space (they already read
--      auth.jwt()->>'sub', which is automatic — no change needed beyond this
--      note);
--   2. adds a trigger so a profile row is created automatically whenever a user
--      signs up via Supabase auth;
--   3. keeps existing rows intact (they keep whatever id they have today; if
--      you had Clerk ids in there, update them to match the matching Supabase
--      user via auth.users, or simply delete the old rows and let the trigger
--      recreate them).

-- ------------------------------------------------- handle new-user trigger
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'),
    coalesce(new.raw_user_meta_data->>'avatar_url', new.raw_user_meta_data->>'picture')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

grant execute on function public.handle_new_user() to supabase_auth_admin;
revoke all on function public.handle_new_user() from public;

-- ------------------------------------------------------- RLS read helpers
-- These already compare auth.jwt()->>'sub' (a uuid) against the pk columns,
-- which after this migration hold the Supabase auth user id.
-- Recreated for clarity / idempotency.
create or replace function public.current_user_id()
returns text language sql stable as $$
  select (select auth.jwt()->>'sub')
$$;

create or replace function public.is_agent()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.jwt()->>'sub')
      and p.role in ('property_owner', 'agency')
  )
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.jwt()->>'sub') and p.role = 'admin'
  )
$$;

grant execute on function public.current_user_id() to authenticated;
grant execute on function public.is_agent() to authenticated;
grant execute on function public.is_admin() to authenticated;