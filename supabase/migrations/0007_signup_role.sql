-- Let a new user pick their account type during sign-up.
--
-- Until now handle_new_user() never sent `role`, so every profile landed on the
-- 'tenant' column default set in 0006 and only a hand edit in the SQL editor
-- could turn someone into a publisher. The sign-up form now sends the chosen
-- role in options.data, which arrives here as raw_user_meta_data->>'role'.
--
-- raw_user_meta_data is written by the client and is *not* trusted: anyone can
-- POST /auth/v1/signup with any JSON they like. The whitelist below is the
-- security boundary — it is what keeps 'admin' (and anything else) out — so an
-- unrecognised or absent value has to fall back to 'tenant' rather than be
-- passed through. The 0004/0006 check constraint is a second line of defence,
-- but it would abort the sign-up instead of degrading to the safe role.
--
-- Nothing here touches the profiles update policy: a user still cannot change
-- their own role after the fact, so sign-up is the only self-service path.

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
    case
      when requested_role in ('tenant', 'property_owner', 'agency') then requested_role
      else 'tenant'
    end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Recreated so the trigger points at the new body even if 0005 was applied
-- against a database where the trigger was later dropped by hand.
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

grant execute on function public.handle_new_user() to supabase_auth_admin;
revoke all on function public.handle_new_user() from public;
