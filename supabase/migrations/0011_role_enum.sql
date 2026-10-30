-- Make `profiles.role` a real enum type.
--
-- Until now the column was `text` with a CHECK constraint. That works, but the
-- Supabase table editor renders it as a free-text box, so changing someone's
-- role means typing the value exactly right and a typo is rejected only on
-- save. An enum column renders as a dropdown instead — pick, don't type.
--
-- The domain is unchanged: the four values are exactly what the CHECK allowed,
-- so the enum replaces that constraint rather than adding a second rule.
--
-- Postgres refuses to alter the type of a column referenced by a policy
-- ("cannot alter type of a column used in a policy definition"), so the two
-- policies that read `role` are dropped and recreated around the change. Same
-- for my_current_role(): its return type follows the column, and a return type
-- cannot be changed by CREATE OR REPLACE, so it is dropped and rebuilt.
--
-- This migration itself is safe to re-run. Several earlier ones are not, once
-- it has been applied: 0003/0004/0006 still mention the retired text values
-- 'user' and 'agent', which are not members of the enum, and 0010 cannot be
-- replayed because CREATE OR REPLACE cannot change my_current_role()'s return
-- type back to text. Run the migrations once, in order. See the note in 0012
-- for the full list of what can and cannot be replayed afterwards.

-- ------------------------------------------------------------------- the type
do $$ begin
  if not exists (select 1 from pg_type where typname = 'user_role') then
    create type public.user_role as enum ('tenant', 'property_owner', 'agency', 'admin');
  end if;
end $$;

-- --------------------------------------------------- drop what depends on it
drop policy if exists "update own profile"         on public.profiles;
drop policy if exists "read own or agent profiles" on public.profiles;
drop function if exists public.my_current_role();

-- 0013 defines a trigger on this column, and Postgres refuses to retype a
-- column a trigger is declared on ("cannot alter type of a column used in a
-- trigger definition"). Dropping it here keeps a full CLI replay working; 0013
-- recreates it when it runs again.
drop trigger if exists profiles_enforce_role_change on public.profiles;

-- ------------------------------------------------------------ the conversion
-- The default is dropped first: it is a text expression and would not survive
-- the retype. The CHECK goes too — the enum now is the constraint.
alter table public.profiles alter column role drop default;
alter table public.profiles drop constraint if exists profiles_role_check;

alter table public.profiles
  alter column role type public.user_role using role::text::public.user_role;

alter table public.profiles
  alter column role set default 'tenant'::public.user_role;

-- ----------------------------------------------------------- rebuild helpers
-- Returns the enum now, so the policy below can compare without a cast.
create or replace function public.my_current_role()
returns public.user_role
language sql
stable
security definer
set search_path = public
as $$
  select p.role
  from public.profiles p
  where p.id = (select auth.jwt()->>'sub')
$$;

revoke all on function public.my_current_role() from public;
grant execute on function public.my_current_role() to authenticated;

-- These read profiles.role too. `language sql` bodies are parsed and stored at
-- creation, so they are recreated against the new column type rather than left
-- holding a parse tree that refers to the old one.
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

grant execute on function public.is_agent() to authenticated;
grant execute on function public.is_admin() to authenticated;

-- The sign-up trigger builds the role as text, which no longer assigns straight
-- into the column: text -> enum needs an explicit cast.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  requested_role text := new.raw_user_meta_data->>'role';
begin
  insert into public.profiles (id, email, full_name, avatar_url, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'),
    coalesce(new.raw_user_meta_data->>'avatar_url', new.raw_user_meta_data->>'picture'),
    (case
       when requested_role in ('tenant', 'property_owner', 'agency') then requested_role
       else 'tenant'
     end)::public.user_role
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

grant execute on function public.handle_new_user() to supabase_auth_admin;
revoke all on function public.handle_new_user() from public;

-- ----------------------------------------------------------- recreate policies
create policy "read own or agent profiles" on public.profiles
  for select to authenticated
  using (
    (select auth.jwt()->>'sub') = id
    or role in ('property_owner', 'agency')
  );

create policy "update own profile" on public.profiles
  for update to authenticated
  using ((select auth.jwt()->>'sub') = id)
  with check (
    (select auth.jwt()->>'sub') = id
    and (
      role in ('tenant', 'property_owner', 'agency')
      or role = public.my_current_role()
    )
  );
