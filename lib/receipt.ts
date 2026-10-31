/**
 * The paid booking receipt: a designed PDF paper the guest can keep.
 *
 * Brand: "Mogadishu Rents" — a text-only wordmark, no icon, by request:
 * MOGADISHU in dark navy, RENTS in brand blue, wide letter-spacing. The
 * same wordmark heads the PDF, and a circular PAID stamp (drawn in CSS,
 * also text only) sits over the receipt body.
 *
 * Flow: after a successful checkout, and from any paid row in My
 * bookings, the guest taps "Receipt" and gets a PDF to save or share.
 * On web there is no file to share, so the browser print dialog opens
 * instead (Save as PDF from there).
 */
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { Platform } from "react-native";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { BookingWithProperty } from "@/lib/types";

export type ReceiptData = {
  receiptNo: string;
  guestName: string;
  propertyName: string;
  propertyLocation: string;
  stayLine: string;
  amount: number;
  paymentMethod: string;
  paidAt: string;
};

const esc = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const money = (n: number) =>
  `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

const fmtDate = (iso: string) => {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  return Number.isNaN(d.getTime())
    ? iso.slice(0, 10)
    : d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
};

/** The wordmark, as HTML, so the PDF and any future print surface match. */
export function receiptWordmarkHtml(): string {
  return (
    `<span style="font-family:Arial,Helvetica,sans-serif;font-weight:900;` +
    `font-size:28px;letter-spacing:3px;color:#0B1F3A;">MOGADISHU</span> ` +
    `<span style="font-family:Arial,Helvetica,sans-serif;font-weight:900;` +
    `font-size:28px;letter-spacing:3px;color:#0061FF;">RENTS</span>`
  );
}

export function buildReceiptHtml(r: ReceiptData): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  body{font-family:Arial,Helvetica,sans-serif;color:#1A1A1A;margin:0;padding:32px;}
  .head{border-bottom:3px solid #0061FF;padding-bottom:16px;}
  .tag{font-size:12px;color:#666;letter-spacing:1px;margin-top:6px;}
  h1{font-size:20px;letter-spacing:2px;margin:28px 0 4px;}
  .no{font-size:13px;color:#666;margin-bottom:24px;}
  table{width:100%;border-collapse:collapse;font-size:15px;}
  td{padding:10px 0;border-bottom:1px solid #E5E5E5;vertical-align:top;}
  td.k{color:#666;width:38%;}
  td.v{font-weight:700;}
  .amount{font-size:26px;color:#0061FF;}
  .confirm{margin-top:24px;font-size:15px;line-height:1.6;background:#F2F6FF;border-left:4px solid #0061FF;padding:14px 16px;}
  .foot{margin-top:32px;font-size:12px;color:#888;text-align:center;}
  .stamp{position:absolute;top:150px;right:40px;width:132px;height:132px;border:3px solid #0E7A3D;border-radius:50%;display:flex;flex-direction:column;align-items:center;justify-content:center;transform:rotate(-12deg);opacity:0.85;}
  .stamp b{color:#0E7A3D;font-size:24px;letter-spacing:2px;}
  .stamp span{color:#0E7A3D;font-size:8px;letter-spacing:1px;text-align:center;line-height:1.4;}
  .stamp i{border:2px solid #0E7A3D;border-radius:50%;width:112px;height:112px;position:absolute;}
  </style></head><body>
  <div class="head">${receiptWordmarkHtml()}<div class="tag">MOGADISHU &middot; SOMALIA</div></div>
  <div class="stamp"><i></i><b>PAID</b><span>MOGADISHU RENTS</span><span>${esc(r.paidAt)}</span></div>
  <h1>BOOKING RECEIPT</h1>
  <div class="no">Receipt no. ${esc(r.receiptNo)}</div>
  <table>
    <tr><td class="k">Guest</td><td class="v">${esc(r.guestName)}</td></tr>
    <tr><td class="k">Property</td><td class="v">${esc(r.propertyName)}</td></tr>
    <tr><td class="k">Location</td><td class="v">${esc(r.propertyLocation)}</td></tr>
    <tr><td class="k">Stay</td><td class="v">${esc(r.stayLine)}</td></tr>
    <tr><td class="k">Payment method</td><td class="v">${esc(r.paymentMethod)}</td></tr>
    <tr><td class="k">Paid through</td><td class="v">Mogadishu Rents app</td></tr>
    <tr><td class="k">Date of payment</td><td class="v">${esc(r.paidAt)}</td></tr>
    <tr><td class="k">Amount paid</td><td class="v amount">${esc(money(r.amount))}</td></tr>
  </table>
  <div class="confirm">This receipt confirms that <b>${esc(r.guestName)}</b> paid <b>${esc(money(r.amount))}</b> using the Mogadishu Rents app to rent <b>${esc(r.propertyName)}</b>.</div>
  <div class="foot">Mogadishu Rents &middot; Thank you for booking with us. Keep this receipt as proof of payment.</div>
  </body></html>`;
}

/**
 * Build the receipt data for a paid booking. The property's district and
 * rental mode are fetched (one row) because the bookings join does not
 * carry them; the stay line follows the mode so a tour, a nightly stay
 * and a monthly rent each read correctly.
 */
export async function loadReceiptData(
  supabase: SupabaseClient,
  booking: BookingWithProperty,
  guestName: string,
  methodLabel: string
): Promise<ReceiptData> {
  let district: string | null = null;
  let rentalMode: string | null = null;
  const { data } = await supabase
    .from("properties")
    .select("district, rental_mode")
    .eq("id", booking.property_id)
    .maybeSingle();
  if (data) {
    district = (data as { district?: string | null }).district ?? null;
    rentalMode = (data as { rental_mode?: string | null }).rental_mode ?? null;
  }
  const inDate = fmtDate(booking.check_in);
  const outDate = fmtDate(booking.check_out);
  const stayLine = booking.is_tour
    ? `Tour on ${inDate}`
    : rentalMode === "monthly"
      ? `From ${inDate} (monthly rental)`
      : `${inDate} — ${outDate}`;
  return {
    receiptNo: `MR-${booking.id.slice(0, 8).toUpperCase()}`,
    guestName,
    propertyName: booking.property?.name ?? "Property",
    propertyLocation: district ? `${district}, Mogadishu` : "Mogadishu",
    stayLine,
    amount: booking.paid_amount ?? booking.total_price,
    paymentMethod: booking.payment_method ?? methodLabel,
    paidAt: fmtDate(booking.updated_at),
  };
}

/** Render the receipt to PDF and share it (or open print on web). */
export async function shareReceiptPdf(data: ReceiptData): Promise<void> {
  const html = buildReceiptHtml(data);
  if (Platform.OS === "web") {
    await Print.printAsync({ html });
    return;
  }
  const { uri } = await Print.printToFileAsync({ html });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, {
      mimeType: "application/pdf",
      dialogTitle: "Booking receipt",
    });
  } else {
    throw new Error("Sharing is not available on this device.");
  }
}
