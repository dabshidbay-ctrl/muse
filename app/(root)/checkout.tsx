import React, { useCallback, useState } from "react";
import { ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { useSession } from "@/lib/useSession";
import { supabase } from "@/lib/supabase";
import { initiatePayment, PAYMENT_GATEWAYS, type PaymentGateway } from "@/lib/sifalo";
import { normalizePhone } from "@/lib/phone";
import { useResponsive } from "@/lib/responsive";
import { BackButton, Chip, Touchable } from "@/components/ui";
import { captureError } from "@/lib/sentry";

const money = (n: number) =>
  `$${Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

export default function CheckoutScreen() {
  const { bookingId, amount } = useLocalSearchParams<{ bookingId: string; amount: string }>();
  const { user } = useSession();
  const { gutter, maxContentWidth } = useResponsive();

  const [phone, setPhone] = useState("");
  const [gateway, setGateway] = useState<PaymentGateway | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);

  const numericAmount = parseFloat(amount ?? "0");
  // A payment link with a missing, non-numeric or non-positive amount must
  // never render a Pay button: "Pay $NaN" was reachable by editing the URL.
  const amountValid = Number.isFinite(numericAmount) && numericAmount > 0;

  const submit = useCallback(async () => {
    if (!bookingId || !user?.id || !gateway || !amountValid) return;

    const normalized = normalizePhone(phone);
    if (!normalized) {
      // Inline, not Alert.alert: react-native-web's Alert is a no-op, so on
      // web this failure was completely invisible and the button read dead.
      setPhoneError("Enter a Somali mobile number (e.g. 61 555 1234).");
      return;
    }
    setPhoneError(null);

    setSubmitting(true);
    setResult(null);

    try {
      const res = await initiatePayment(supabase, {
        bookingId,
        amount: numericAmount,
        account: normalized,
        gateway,
      });

      if (res.success) {
        // Pay is only offered on owner-confirmed bookings (see bookings.tsx),
        // so a successful payment really does mean confirmed + paid.
        setResult({ success: true, message: "Payment successful! Your booking is confirmed and paid." });
      } else if (res.status === "pending") {
        setResult({
          success: true,
          message: "Check your phone to approve the payment in your mobile money app.",
        });
      } else {
        setResult({
          success: false,
          message: res.message || "The payment did not work. Check your balance and try again.",
        });
      }
    } catch (err) {
      captureError(err, "sifalo-payment");
      setResult({
        success: false,
        message: err instanceof Error ? err.message : "Could not process payment.",
      });
    } finally {
      setSubmitting(false);
    }
  }, [bookingId, user?.id, gateway, phone, numericAmount, supabase]);

  // Invalid payment links get an error screen, never a Pay button.
  if (!amountValid) {
    return (
      <SafeAreaView className="flex-1 bg-surface-muted dark:bg-surface-dark" edges={["top"]}>
        <View
          style={{ paddingHorizontal: gutter }}
          className="flex-row items-center gap-sm pt-sm pb-xs"
        >
          <BackButton fallback="/bookings" />
          <Text
            accessibilityRole="header"
            className="flex-1 text-h2 font-rubik-extrabold text-black-300 dark:text-white"
          >
            Pay with mobile money
          </Text>
        </View>
        <View
          style={{ paddingHorizontal: gutter, maxWidth: maxContentWidth, alignSelf: "center", width: "100%" }}
        >
          <View className="rounded-lg border border-danger bg-danger/10 p-md mt-lg">
            <Text className="text-body font-rubik-bold text-danger">
              This payment link is invalid
            </Text>
            <Text className="text-caption font-rubik text-black-200 dark:text-white/60 mt-2xs">
              The amount on this link is missing or not a valid number. Go back to
              My bookings and open the payment from there.
            </Text>
            <Touchable
              onPress={() => router.replace("/bookings")}
              accessibilityLabel="View my bookings"
              style={{ minHeight: 44, marginTop: 12 }}
              className="items-center justify-center rounded-full border border-danger"
            >
              <Text className="text-caption font-rubik-bold text-danger">View my bookings</Text>
            </Touchable>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-surface-muted dark:bg-surface-dark" edges={["top"]}>
      <View
        style={{ paddingHorizontal: gutter }}
        className="flex-row items-center gap-sm pt-sm pb-xs"
      >
        <BackButton fallback="/bookings" />
        <Text
          accessibilityRole="header"
          className="flex-1 text-h2 font-rubik-extrabold text-black-300 dark:text-white"
        >
          Pay with mobile money
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: gutter,
          paddingBottom: 120,
          width: "100%",
          maxWidth: maxContentWidth,
          alignSelf: "center",
        }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Amount summary */}
        <View className="rounded-lg bg-surface dark:bg-surface-dark-muted border border-line dark:border-line-dark p-lg items-center mt-md">
          <Text className="text-caption font-rubik text-black-200 dark:text-white/60 uppercase">
            Amount to pay
          </Text>
          <Text className="text-display font-rubik-extrabold text-primary-300 mt-xs">
            {money(numericAmount)}
          </Text>
          <Text className="text-caption font-rubik text-black-100 dark:text-white/40 mt-2xs">
            USD
          </Text>
        </View>

        {/* Phone number */}
        <View className="mt-lg">
          <Text className="text-body font-rubik-bold text-black-300 dark:text-white mb-xs">
            Your mobile money number
          </Text>
          <TextInput
            value={phone}
            onChangeText={setPhone}
            placeholder="61 555 1234"
            placeholderTextColor="#8C8E98"
            keyboardType="phone-pad"
            accessibilityLabel="Your mobile money phone number"
            className="rounded-md border border-line dark:border-line-dark px-md py-sm text-body font-rubik bg-surface dark:bg-surface-dark-muted text-black-300 dark:text-white"
            style={{ minHeight: 48 }}
          />
          {phoneError ? (
            <Text accessibilityRole="alert" className="text-caption font-rubik-medium text-danger mt-2xs">
              {phoneError}
            </Text>
          ) : null}
          <Text className="text-caption font-rubik text-black-100 dark:text-white/40 mt-2xs">
            We'll send a payment request to this number. Enter your EVC+, Zaad, eDahab, or Premier
            Wallet number.
          </Text>
        </View>

        {/* Gateway selection */}
        <Text className="text-body font-rubik-bold text-black-300 dark:text-white mt-lg mb-xs">
          Payment method
        </Text>
        <View className="gap-xs">
          {PAYMENT_GATEWAYS.map((g) => {
            const selected = gateway === g.value;
            return (
              <Touchable
                key={g.value}
                onPress={() => setGateway(g.value)}
                accessibilityLabel={`${g.label}. ${g.hint}${selected ? ". Selected" : ""}`}
                accessibilityState={{ selected }}
                className={`rounded-lg border p-md ${
                  selected
                    ? "bg-primary-100 border-primary-300"
                    : "bg-surface dark:bg-surface-dark-muted border-line dark:border-line-dark"
                }`}
              >
                <Text
                  className={`text-body font-rubik-semibold ${
                    selected ? "text-primary-300" : "text-black-300 dark:text-white"
                  }`}
                >
                  {g.label}
                </Text>
                <Text
                  className={`text-caption font-rubik mt-2xs ${
                    selected ? "text-primary-300/70" : "text-black-100 dark:text-white/40"
                  }`}
                >
                  {g.hint}
                </Text>
              </Touchable>
            );
          })}
        </View>

        {/* Result message */}
        {result ? (
          <View
            accessibilityLiveRegion="polite"
            className={`rounded-lg border p-md mt-lg ${
              result.success
                ? "bg-success/10 border-success"
                : "bg-danger/10 border-danger"
            }`}
          >
            <Text
              className={`text-caption font-rubik-bold ${
                result.success ? "text-success" : "text-danger"
              }`}
            >
              {result.success ? "Payment sent" : "Payment failed"}
            </Text>
            <Text className="text-caption font-rubik text-black-200 dark:text-white/60 mt-2xs">
              {result.message}
            </Text>
            <Touchable
              onPress={() => router.replace("/bookings")}
              accessibilityLabel="View my bookings"
              style={{ minHeight: 44, marginTop: 12 }}
              className="items-center justify-center rounded-full border border-success"
            >
              <Text className="text-caption font-rubik-bold text-success">
                View my bookings
              </Text>
            </Touchable>
          </View>
        ) : null}

        {/* Submit button — hidden once a payment has succeeded, so a second
            tap cannot fire a second payment for the same booking. Failures
            keep the button so the user can retry. */}
        {!result?.success ? (
          <Touchable
            onPress={submit}
            disabled={submitting || !gateway || !phone.trim()}
            accessibilityLabel="Pay now"
            accessibilityState={{ disabled: submitting || !gateway || !phone.trim(), busy: submitting }}
            style={{ minHeight: 52, marginTop: 24 }}
            className="items-center justify-center rounded-full bg-primary-300"
          >
            <Text className="text-body font-rubik-bold text-white">
              {submitting
                ? "Processing…"
                : !gateway
                  ? "Choose a payment method"
                  : `Pay ${money(numericAmount)} with ${PAYMENT_GATEWAYS.find((g) => g.value === gateway)?.label ?? ""}`}
            </Text>
          </Touchable>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}