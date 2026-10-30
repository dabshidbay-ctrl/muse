-- Push notification tokens.
--
-- Every user who opts in gets a row here. The token is an Expo Push Token
-- (ExponentPushToken[xxxx]) that the `send-push-notifications` Edge Function
-- sends to Expo's push API when a new notification row is inserted.
--
-- A user may have multiple devices, so the primary key is the token itself.
-- On sign-out the app deletes the token for that device, and a stale token
-- that Expo rejects is removed on the next send cycle.

create table if not exists public.push_tokens (
  token      text primary key,
  user_id    text not null,
  created_at timestamptz not null default now()
);

create index if not exists push_tokens_user_idx
  on public.push_tokens (user_id);

alter table public.push_tokens enable row level security;

-- A user manages their own tokens — insert/delete only, no update (a token is
-- immutable; if it changes, the old one is dead).

drop policy if exists "insert own push tokens" on public.push_tokens;
create policy "insert own push tokens" on public.push_tokens
  for insert to authenticated
  with check ((select auth.jwt()->>'sub') = user_id);

drop policy if exists "delete own push tokens" on public.push_tokens;
create policy "delete own push tokens" on public.push_tokens
  for delete to authenticated
  using ((select auth.jwt()->>'sub') = user_id);

-- The Edge Function runs as the service_role, so it can read any token.
-- No additional policy needed for that path.