// Sifalo Pay e-Wallet proxy — holds the API secret server-side.
//
//   POST /sifalo-checkout          → initiate a direct wallet payment
//   POST /sifalo-checkout?status=1 → check payment status by order_id
//
// The client never sees the Sifalo API key. The JWT is verified so only
// signed-in users can call this, and the service_role key from the env lets
// the function update the booking row.
//
// --- e-Wallet API ---
// POST https://api.sifalopay.com/gateway/
// Headers: Authorization: Basic base64(user:key)
// Body: { account, gateway, amount, currency, order_id }
// Response: { code, sid, response }
//   code 601 = success
//   code 603 = pending
//   code 600/604 = failure

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.112.4";

const SIFALO_GATEWAY = "https://api.sifalopay.com/gateway/";

function basicAuth(): string {
  const user = Deno.env.get("SIFALO_API_USER");
  const key = Deno.env.get("SIFALO_API_KEY");
  if (!user || !key) throw new Error("Sifalo credentials not configured");
  return `Basic ${btoa(`${user}:${key}`)}`;
}

function getSupabase() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key);
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  // GET without params = health check
  const url = new URL(req.url);
  if (req.method === "GET" && !url.searchParams.has("status")) {
    return json({ ok: true, version: 2 });
  }

  try {
    const isStatus = url.searchParams.has("status");

    // Read the body safely
    let body: Record<string, unknown> = {};
    if (req.method === "POST") {
      const raw = await req.text();
      if (!raw) throw new Error("Request body is empty");
      try { body = JSON.parse(raw); } catch (e) {
        throw new Error(`Invalid JSON: ${raw.slice(0, 200)}`);
      }
    } else {
      throw new Error(`Method ${req.method} not supported`);
    }

    if (isStatus) {
      return await handleStatus(body);
    }
    return await handlePayment(body);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("sifalo-checkout error:", msg);
    return json({ error: msg }, 400);
  }
});

async function handlePayment(body: Record<string, unknown>) {
  const { bookingId, amount, account, gateway } = body as {
    bookingId?: string;
    amount?: number;
    account?: string;
    gateway?: string;
  };

  if (!bookingId || !amount || amount <= 0) {
    throw new Error("Something went wrong. Please go back and try again.");
  }
  if (!account || !gateway) {
    throw new Error("Please enter your phone number and pick a payment method.");
  }

  const validGateways = ["waafi", "edahab", "pbwallet"];
  if (!validGateways.includes(gateway)) {
    throw new Error("Selected payment method is not supported. Please pick another.");
  }

  const orderId = `booking_${bookingId}_${Date.now()}`;

  // Sifalo expects the national number without the country code prefix.
  // Strip +252 if present (the client normalizes to +252xxxxxxxx).
  const rawAccount = account.replace(/^\+252/, "").replace(/^0+/, "");

  const res = await fetch(SIFALO_GATEWAY, {
    method: "POST",
    headers: {
      Authorization: basicAuth(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      account: rawAccount,
      gateway,
      amount: String(amount),
      currency: "USD",
      order_id: orderId,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error("Sifalo HTTP error", res.status, text);
    throw new Error("The payment service is not responding. Please try again later.");
  }

  const raw = await res.text();
  if (!raw) {
    throw new Error("The payment did not work. Maybe your balance is not enough.");
  }

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error("The payment service returned an unexpected response. Please try again.");
  }

  const code = String(data.code ?? "0");
  const sid = data.sid ?? "";
  const msg = data.response ?? "";

  // Map Sifalo-specific error messages to user-friendly ones
  let userMessage: string;
  if (code === "601") {
    userMessage = "Payment successful!";
  } else if (code === "603") {
    userMessage = "Check your phone to approve the payment in your mobile money app.";
  } else if (msg.includes("balance") || msg.includes("insufficient")) {
    userMessage = "Your balance is not enough. Please top up and try again.";
  } else if (msg.includes("route") || msg.includes("account") || msg.includes("Validation")) {
    userMessage = "The payment did not work. Check the number you entered and try again.";
  } else if (msg.includes("Payee") || msg.includes("wallet")) {
    userMessage = "The payment did not work. Check the number you entered and try again.";
  } else if (msg.includes("push")) {
    userMessage = "Could not reach your phone. Make sure your mobile money app is working.";
  } else {
    userMessage = "The payment did not work. Maybe your balance is not enough.";
  }

  let status: "success" | "failure" | "pending";
  if (code === "601") {
    status = "success";
  } else if (code === "603") {
    status = "pending";
  } else {
    status = "failure";
  }

  // Update the booking row
  const supabase = getSupabase();
  await supabase
    .from("bookings")
    .update({
      payment_status: status === "success" ? "paid" : status === "pending" ? "pending" : "failed",
      sifalo_sid: sid || null,
      paid_amount: status === "success" ? amount : null,
      payment_method: gateway.toUpperCase(),
    })
    .eq("id", bookingId);

  return json({
    success: status === "success",
    sid,
    status,
    code,
    message: userMessage,
  });
}

async function handleStatus(body: Record<string, unknown>) {
  const { orderId } = body as { orderId?: string };
  if (!orderId) throw new Error("orderId is required");

  const res = await fetch("https://api.sifalopay.com/gateway/verify.php", {
    method: "POST",
    headers: {
      Authorization: basicAuth(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ order_id: orderId }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error("The payment service is not responding. Please try again later.");
  }

  const raw = await res.text();
  if (!raw) {
    throw new Error("Could not check payment status. Check your bookings for updates.");
  }

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error("Could not check payment status. Check your bookings for updates.");
  }

  const status = data.status === "success" ? "success" : data.status === "failure" ? "failure" : "pending";

  return json({
    sid: data.sid,
    status,
    amount: data.amount ?? "0",
    payment_method: (data.payment_type ?? "").toUpperCase(),
  });
}