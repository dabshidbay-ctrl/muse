// Sifalo Pay e-Wallet proxy — holds the API secret server-side.
//
//   POST /sifalo-checkout          → initiate a direct wallet payment
//   POST /sifalo-checkout?status=1 → check payment status by order_id
//
// The client never sees the Sifalo API key. The caller's Supabase JWT is
// verified in handlePayment, the booking is fetched server-side, and only
// the booking's owner may pay it, for exactly its stored total (or the $15
// tour fee). The service_role key from the env lets the function update the
// booking row after those checks.
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
      return await handleStatus(body, req);
    }
    return await handlePayment(body, req);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("sifalo-checkout error:", msg);
    return json({ error: msg }, 400);
  }
});

async function handlePayment(body: Record<string, unknown>, req: Request) {
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

  // Verify the caller before touching anything. The client sends its
  // Supabase session JWT in Authorization, and the service_role client below
  // bypasses RLS — without this check, anyone could mark ANY booking paid
  // for ANY amount by calling the function directly, because the old code
  // trusted the client-supplied bookingId and amount outright.
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    throw new Error("Sign in to pay.");
  }
  const supabase = getSupabase();
  const { data: { user }, error: authError } = await supabase.auth.getUser(
    authHeader.slice("Bearer ".length),
  );
  if (authError || !user) {
    throw new Error("Sign in to pay.");
  }

  // The booking is the source of truth, not the client's URL parameters.
  const { data: booking, error: bookingError } = await supabase
    .from("bookings")
    .select("id, guest_id, total_price, is_tour, payment_status")
    .eq("id", bookingId)
    .maybeSingle();
  if (bookingError || !booking) {
    throw new Error("Booking not found.");
  }
  if (booking.guest_id !== user.id) {
    throw new Error("This booking belongs to someone else.");
  }
  if (booking.payment_status === "paid") {
    throw new Error("This booking is already paid.");
  }
  // Tours charge the flat $15 fee (must match TOUR_FEE in the app); stays
  // charge the booking's stored total. The amount Sifalo is asked for, and
  // the amount recorded as paid, is this server-side figure — never the
  // amount the client sent.
  const expectedAmount = booking.is_tour ? 15 : Number(booking.total_price);
  if (!Number.isFinite(expectedAmount) || expectedAmount <= 0) {
    throw new Error("This booking has no valid amount to pay.");
  }
  if (Number(amount) !== expectedAmount) {
    throw new Error("The payment amount does not match this booking.");
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
      amount: String(expectedAmount),
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

  // Update the booking row (supabase client was created above for auth).
  // The order id is stored too: a pending (603) payment can only be
  // re-checked with this exact id, and it was previously lost.
  await supabase
    .from("bookings")
    .update({
      payment_status: status === "success" ? "paid" : status === "pending" ? "pending" : "failed",
      sifalo_sid: sid || null,
      sifalo_order_id: orderId,
      paid_amount: status === "success" ? expectedAmount : null,
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

async function handleStatus(body: Record<string, unknown>, req: Request) {
  const { bookingId, orderId: passedOrderId } = body as {
    bookingId?: string;
    orderId?: string;
  };

  // Same caller check as handlePayment: the service_role client below
  // bypasses RLS, so the booking's owner must be proven from the JWT.
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    throw new Error("Sign in to check a payment.");
  }
  const supabase = getSupabase();
  const { data: { user }, error: authError } = await supabase.auth.getUser(
    authHeader.slice("Bearer ".length),
  );
  if (authError || !user) {
    throw new Error("Sign in to check a payment.");
  }

  // The booking is the source of truth for the order id. A bare orderId is
  // accepted only as a fallback for rows created before the column existed.
  let orderId = passedOrderId ?? null;
  let booking: { id: string } | null = null;
  if (bookingId) {
    const { data, error } = await supabase
      .from("bookings")
      .select("id, guest_id, sifalo_order_id")
      .eq("id", bookingId)
      .maybeSingle();
    if (error || !data) throw new Error("Booking not found.");
    if ((data as { guest_id?: string }).guest_id !== user.id) {
      throw new Error("This booking belongs to someone else.");
    }
    booking = data as { id: string };
    orderId = (data as { sifalo_order_id?: string | null }).sifalo_order_id ?? orderId;
  }
  if (!orderId) {
    throw new Error("This payment has no order reference to check. It was created before order ids were stored.");
  }

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

  // A re-check is not just a read: it settles the booking row, so a payment
  // approved on the phone after checkout no longer stays "pending" forever.
  if (booking) {
    const verifiedAmount = Number(data.amount ?? NaN);
    await supabase
      .from("bookings")
      .update({
        payment_status: status === "success" ? "paid" : status === "failure" ? "failed" : "pending",
        ...(status === "success" && Number.isFinite(verifiedAmount)
          ? { paid_amount: verifiedAmount }
          : {}),
        ...(data.sid ? { sifalo_sid: String(data.sid) } : {}),
      })
      .eq("id", booking.id);
  }

  return json({
    sid: data.sid,
    status,
    amount: data.amount ?? "0",
    payment_method: (data.payment_type ?? "").toUpperCase(),
  });
}