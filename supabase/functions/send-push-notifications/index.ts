// Send push notifications to users when a new notification row is inserted.
//
// This function is called by a Supabase Database Webhook that fires on INSERT
// to public.notifications. It looks up the recipient's Expo Push Token from
// public.push_tokens and sends the notification via Expo's push API.
//
// Deploy: supabase functions deploy send-push-notifications --no-verify-jwt
//         (no-verify-jwt because the webhook runs as the service_role and
//          carries no user JWT — the token is our own webhook secret.)
//
// Supabase webhook config (SQL editor or Dashboard > Database > Webhooks):
//
//   create or replace trigger "send-push-notifications"
//   after insert on public.notifications
//   for each row
//   execute function supabase_functions.http_request(
//     'http://localhost:54321/functions/v1/send-push-notifications',
//     'POST',
//     '{"Content-type":"application/json"}',
//     '{"secret":"<your-webhook-secret>"}',
//     '10000'
//   );
//
// Replace the URL with the deployed function URL (from `supabase functions
// list`) and set a webhook secret. The secret is configured in the Dashboard
// under Database > Webhooks > [your webhook] > HTTP Headers.

interface NotificationPayload {
  type: string;
  user_id: string;
  title: string;
  body: string | null;
}

interface PushToken {
  token: string;
}

interface ExpoPushMessage {
  to: string;
  sound: "default";
  title: string;
  body: string;
  data: { type: string };
  _displayInForeground?: boolean;
}

// Expo push API endpoint
const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

// Create a Supabase client using the service_role key from env vars.
// The webhook calls this function as the service_role, so RLS is bypassed.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.112.4";

function getSupabase() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key);
}

Deno.serve(async (req: Request) => {
  try {
    // The trigger passes its secret as a query parameter (the 4th argument
    // of supabase_functions.http_request becomes query params, not the
    // body). Verify it when the secret is configured as an Edge Function
    // secret (PUSH_WEBHOOK_SECRET, same value as in the trigger): without
    // this check the function accepts unauthenticated calls, and anyone
    // who finds its URL could fire pushes at any user. Left permissive
    // when unset so existing deployments keep working until the secret
    // is set — set it, then the check is enforced.
    const expectedSecret = Deno.env.get("PUSH_WEBHOOK_SECRET");
    if (expectedSecret) {
      const givenSecret = new URL(req.url).searchParams.get("secret");
      if (givenSecret !== expectedSecret) {
        return new Response(JSON.stringify({ ok: false, reason: "Bad webhook secret" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    // Parse the webhook payload — it's the full notification row.
    const payload: { record?: NotificationPayload } = await req.json();
    if (!payload.record) {
      return new Response(JSON.stringify({ ok: false, reason: "No record in payload" }), {
        status: 200, // 200 so the webhook does not retry a malformed event.
        headers: { "Content-Type": "application/json" },
      });
    }
    const { user_id, type, title, body } = payload.record;

    if (!user_id) {
      return new Response(JSON.stringify({ ok: false, reason: "No user_id" }), {
        status: 200, // 200 so the webhook does not retry.
        headers: { "Content-Type": "application/json" },
      });
    }

    // Look up the recipient's push token(s).
    const supabase = getSupabase();
    const { data: tokens, error: dbError } = await supabase
      .from("push_tokens")
      .select("token")
      .eq("user_id", user_id);

    if (dbError) throw dbError;

    const pushTokens = (tokens as PushToken[]) ?? [];
    if (pushTokens.length === 0) {
      // User has no push token — nothing to send. This is not an error.
      return new Response(JSON.stringify({ ok: true, sent: 0 }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // Build the Expo push messages.
    const messages: ExpoPushMessage[] = pushTokens.map(({ token }) => ({
      to: token,
      sound: "default",
      title,
      body: body ?? "",
      data: { type },
    }));

    // Send via Expo's push API.
    const pushRes = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(messages),
    });

    const pushResult = await pushRes.json();

    // If Expo returns errors for specific tokens, remove them so we do not
    // keep retrying a dead device.
    if (pushResult.data) {
      const errors: Array<{ status: "error"; details?: { error?: string } }> =
        pushResult.data;

      const deadTokens: string[] = [];
      for (let i = 0; i < errors.length; i++) {
        const err = errors[i];
        if (
          err?.status === "error" &&
          (err?.details?.error === "DeviceNotRegistered" ||
            err?.details?.error === "InvalidCredentials")
        ) {
          deadTokens.push(pushTokens[i].token);
        }
      }

      if (deadTokens.length > 0) {
        // Remove stale tokens silently.
        for (const token of deadTokens) {
          await supabase.from("push_tokens").delete().eq("token", token);
        }
      }
    }

    return new Response(JSON.stringify({ ok: true, sent: messages.length }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("send-push-notifications error:", err);
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 200, // 200 so the webhook does not retry a failing event.
      headers: { "Content-Type": "application/json" },
    });
  }
});