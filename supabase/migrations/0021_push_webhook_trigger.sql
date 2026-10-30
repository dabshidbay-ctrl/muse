-- Push notification webhook trigger.
--
-- Fires after every INSERT on public.notifications and calls the deployed
-- Edge Function, which looks up the recipient's Expo Push Token and delivers
-- the notification via Expo's push API.
--
-- The webhook secret is embedded here so the migration is self-contained.
-- Change it from the Dashboard (Database > Webhooks) if needed.
--
-- Re-run safety: the trigger is dropped first, so `supabase db push` works.
--
-- IMPORTANT: Database Webhooks must be enabled first.
--   Dashboard > Project Settings > Add-ons > Database Webhooks > Enable
--   This creates the `supabase_functions` schema that `http_request` needs.

-- Ensure the schema exists so the migration does not fail.
create schema if not exists supabase_functions;

drop trigger if exists "send-push-notifications" on public.notifications;

create trigger "send-push-notifications"
after insert on public.notifications
for each row
execute function supabase_functions.http_request(
  'https://cnbjywxnfeizqzkqhsby.supabase.co/functions/v1/send-push-notifications',
  'POST',
  '{"Content-type":"application/json"}',
  '{"secret":"restate-push-webhook-2026"}',
  '10000'
);