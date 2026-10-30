-- Teach every role rule about 'hotel_manager'.
--
-- 0024 added the enum value; this file is where it is *used*. Postgres refuses
-- to use a value added by `alter type ... add value` inside the same
-- transaction that added it, which is why the two are separate migrations.
--
-- A hotel manager is a publisher: they list short-stay and monthly units and
-- manage the bookings on them, exactly like a property owner. The only
-- difference is the label the platform shows.
--
-- Idempotent: safe to re-run.

-- ------------------------------------------------------------- is_agent()
-- Drives the "can publish" checks in RLS. Rebuilt so a hotel manager is not
-- silently treated as a tenant by every policy that calls it.
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
      and p.role in ('property_owner', 'agency', 'hotel_manager')
  )
$$;

grant execute on function public.is_agent() to authenticated;

-- ------------------------------------------------------- sign-up whitelist
-- raw_user_meta_data is client-controlled, so this whitelist is the security
-- boundary: 'admin' must stay out of it, and an unknown value has to degrade to
-- 'tenant' rather than abort the sign-up.
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
       when requested_role in ('tenant', 'property_owner', 'agency', 'hotel_manager')
         then requested_role
       else 'tenant'
     end)::public.user_role
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

grant execute on function public.handle_new_user() to supabase_auth_admin;
revoke all on function public.handle_new_user() from public;

-- ------------------------------------------------------- self-service role
-- Same contract as 0009/0011: the three (now four) self-assignable roles, or
-- the role the row already has. 'admin' remains unreachable from a client.
drop policy if exists "update own profile" on public.profiles;

create policy "update own profile" on public.profiles
  for update to authenticated
  using ((select auth.jwt()->>'sub') = id)
  with check (
    (select auth.jwt()->>'sub') = id
    and (
      role in ('tenant', 'property_owner', 'agency', 'hotel_manager')
      or role = (select p.role from public.profiles p where p.id = profiles.id)
    )
  );

-- ------------------------------------------------------- publisher profiles
-- The read policy from 0011 lists the publisher roles explicitly, so a hotel
-- manager's profile would have been invisible to everyone but themselves and
-- an admin. Rebuilt with the new role included.
drop policy if exists "read own or agent profiles" on public.profiles;

create policy "read own or agent profiles" on public.profiles
  for select to authenticated
  using (
    (select auth.jwt()->>'sub') = id
    or role in ('property_owner', 'agency', 'hotel_manager')
  );
