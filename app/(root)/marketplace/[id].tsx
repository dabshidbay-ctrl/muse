import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Image, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { useSession } from "@/lib/useSession";
import { useProfile } from "@/lib/useProfile";
import { useSupabase } from "@/lib/useSupabase";
import {
  getMarketplaceItem,
  hasEnquired,
  sendMarketplaceEnquiry,
  withdrawMarketplaceEnquiry,
} from "@/lib/marketplaceApi";
import { supabase } from "@/lib/supabase";
import { describeSupabaseError } from "@/lib/supabase";
import { captureError } from "@/lib/sentry";
import type { MarketplaceCategory, MarketplaceCondition, MarketplaceStatus } from "@/lib/types";
import { MIN_TAP, shadow, useResponsive } from "@/lib/responsive";
import { BackButton, EmptyState, Skeleton, Touchable } from "@/components/ui";
import { PropertyGallery } from "@/components/PropertyGallery";
import { districtLabel } from "@/components/Filters";
import { marketplaceCategories, marketplaceConditions } from "@/constants/data";
import icons from "@/constants/icons";

/** Where back lands when this screen was opened from a link and has no history. */
const PARENT = "/marketplace" as const;

const money = (n: number) => `$${Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

const categoryLabel = (v: MarketplaceCategory) =>
  marketplaceCategories.find((c) => c.value === v)?.label ?? v;
const conditionLabel = (v: MarketplaceCondition) =>
  marketplaceConditions.find((c) => c.value === v)?.label ?? v;

/**
 * A uuid, loosely. The route param arrives from a URL a human can edit, and
 * sending `"undefined"` or a stray path segment to Postgres surfaces as an
 * opaque 22P02 error rather than "we could not find that".
 */
const looksLikeId = (v: unknown): v is string =>
  typeof v === "string" && /^[0-9a-fA-F-]{32,36}$/.test(v.trim());

function Fact({ icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <View className="flex-1 items-center py-sm rounded-md bg-surface-muted dark:bg-surface-dark-elevated">
      <Image source={icon} style={{ width: 20, height: 20 }} accessible={false} alt="" />
      <Text className="text-body font-rubik-bold text-black-300 dark:text-white mt-2xs text-center">
        {value}
      </Text>
      <Text className="text-caption font-rubik text-black-200 dark:text-white/60">{label}</Text>
    </View>
  );
}

/**
 * The seller's own view of a listing that is not live. A silent rejection is
 * indistinguishable from a bug, so the status and the admin's note are stated
 * plainly rather than hidden behind "pending".
 */
function StatusBanner({
  status,
  note,
  viewerIsOwner,
}: {
  status: MarketplaceStatus;
  note: string | null;
  viewerIsOwner: boolean;
}) {
  if (status === "approved") return null;

  const rejected = status === "rejected";
  const title = rejected
    ? viewerIsOwner
      ? "You listed this, and it was rejected"
      : "Rejected — not visible to buyers"
    : viewerIsOwner
      ? "You listed this, and it is waiting for review"
      : "Pending review — not visible to buyers";

  return (
    <View
      accessibilityRole="summary"
      accessibilityLiveRegion="polite"
      className={`rounded-md px-md py-sm border ${
        rejected ? "border-danger/40 bg-danger/10" : "border-warning/40 bg-warning/10"
      }`}
    >
      <Text
        className={`text-body font-rubik-semibold ${rejected ? "text-danger" : "text-warning"}`}
      >
        {title}
      </Text>
      <Text className="text-caption font-rubik text-black-200 dark:text-white/70 mt-2xs">
        {rejected
          ? "An admin reviewed it and did not publish it."
          : "An admin checks every listing before buyers can see it."}
      </Text>
      {rejected && note ? (
        <Text className="text-caption font-rubik-medium text-black-300 dark:text-white mt-xs">
          Reason: {note}
        </Text>
      ) : null}
    </View>
  );
}

export default function MarketplaceItemScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const id = typeof params.id === "string" ? params.id.trim() : "";
  const validId = looksLikeId(id);

  const insets = useSafeAreaInsets();
  const { heroHeight, gutter, maxContentWidth } = useResponsive();
  const { user } = useSession();
  const { isAdmin } = useProfile();

  const { data: item, loading, error } = useSupabase({
    fn: getMarketplaceItem,
    params: { id },
    // A malformed id is answered locally; it is not worth a round trip that can
    // only come back as a database type error.
    skip: !validId,
  });

  const images = useMemo(() => item?.images ?? [], [item?.images]);
  const viewerIsOwner = !!user?.id && !!item && item.seller_id === user.id;

  /* ---- enquiry: the buyer -> seller path.
   *
   * The seller's number stays private. What travels is the buyer's, and only
   * because they typed it here and pressed send. */
  const [enquired, setEnquired] = useState(false);
  const [enquiryOpen, setEnquiryOpen] = useState(false);
  const [enquiryPhone, setEnquiryPhone] = useState("");
  const [enquiryMessage, setEnquiryMessage] = useState("");
  const [enquirySubmitted, setEnquirySubmitted] = useState(false);
  const [enquiryBusy, setEnquiryBusy] = useState(false);
  const [enquiryError, setEnquiryError] = useState<string | null>(null);

  const canEnquire = !!user?.id && !!item && item.status === "approved" && !viewerIsOwner;

  useEffect(() => {
    if (!canEnquire || !item || !user?.id) return;
    let alive = true;
    hasEnquired(supabase, { itemId: item.id, buyerId: user.id })
      .then((already) => {
        if (alive) setEnquired(already);
      })
      .catch((err) => captureError(err, "marketplace-enquiry-check"));
    return () => {
      alive = false;
    };
  }, [canEnquire, item, user?.id]);

  // Loose on purpose: a too-strict pattern rejects legitimate numbers, and the
  // seller is a person reading it, not a dialler.
  const phoneProblem = enquiryPhone.replace(/[^0-9]/g, "").length < 7;

  const sendEnquiry = useCallback(async () => {
    if (!item || !user?.id || enquiryBusy) return;
    setEnquirySubmitted(true);
    if (phoneProblem) return;
    setEnquiryBusy(true);
    setEnquiryError(null);
    try {
      await sendMarketplaceEnquiry(supabase, {
        itemId: item.id,
        buyerId: user.id,
        phone: enquiryPhone,
        message: enquiryMessage,
      });
      setEnquired(true);
      setEnquiryOpen(false);
      setEnquiryMessage("");
    } catch (err) {
      captureError(err, "marketplace-enquiry-send");
      setEnquiryError(
        err instanceof Error ? err.message : describeSupabaseError(err)
      );
    } finally {
      setEnquiryBusy(false);
    }
  }, [item, user?.id, enquiryBusy, phoneProblem, enquiryPhone, enquiryMessage]);

  const withdrawEnquiry = useCallback(async () => {
    if (!item || !user?.id || enquiryBusy) return;
    setEnquiryBusy(true);
    setEnquiryError(null);
    try {
      await withdrawMarketplaceEnquiry(supabase, { itemId: item.id, buyerId: user.id });
      setEnquired(false);
    } catch (err) {
      captureError(err, "marketplace-enquiry-withdraw");
      setEnquiryError(describeSupabaseError(err));
    } finally {
      setEnquiryBusy(false);
    }
  }, [item, user?.id, enquiryBusy]);
  const district = districtLabel(item?.district);

  if (!validId) {
    return (
      <View className="flex-1 bg-surface dark:bg-surface-dark">
        <View style={{ paddingTop: insets.top + 8, paddingHorizontal: 24 }}>
          <BackButton fallback={PARENT} label="Back to the marketplace" />
        </View>
        <View className="flex-1 items-center justify-center">
          <EmptyState
            title="That link is not valid"
            body="The address is missing an item reference. Open the item from the marketplace instead."
            tone="error"
          />
        </View>
      </View>
    );
  }

  if (loading) {
    return (
      <View className="flex-1 bg-surface dark:bg-surface-dark">
        <Skeleton className="rounded-none" style={{ width: "100%", height: heroHeight }} />
        <View className="p-lg gap-sm">
          <Skeleton className="h-8 w-1/3" />
          <Skeleton className="h-6 w-2/3" />
          <Skeleton className="h-20 w-full" />
        </View>
      </View>
    );
  }

  // `getMarketplaceItem` returns null both when the row does not exist and when
  // row-level security hides it, and the two are deliberately indistinguishable
  // from here: telling a stranger "this exists but you may not see it" leaks the
  // existence of every pending listing.
  if (error || !item) {
    return (
      <View className="flex-1 bg-surface dark:bg-surface-dark">
        <View style={{ paddingTop: insets.top + 8, paddingHorizontal: 24 }}>
          <BackButton fallback={PARENT} label="Back to the marketplace" />
        </View>
        <View className="flex-1 items-center justify-center">
          <EmptyState
            title={error ? "Could not load this item" : "Item not found"}
            body={
              error ??
              "It may have been sold, removed, or it is not published. Browse what is on sale now."
            }
            tone="error"
          />
          <View className="items-center">
            <Touchable
              onPress={() => router.replace(PARENT)}
              accessibilityLabel="Browse the marketplace"
              style={{ minHeight: MIN_TAP }}
              className="items-center justify-center rounded-full bg-primary-300 px-lg"
            >
              <Text className="text-body font-rubik-semibold text-white">Browse the marketplace</Text>
            </Touchable>
          </View>
        </View>
      </View>
    );
  }

  // Belt and braces over the RLS policy: if a non-owner, non-admin ever reaches
  // an unapproved row, they get the same answer as a stranger rather than a
  // preview of unreviewed content.
  if (item.status !== "approved" && !viewerIsOwner && !isAdmin) {
    return (
      <View className="flex-1 bg-surface dark:bg-surface-dark">
        <View style={{ paddingTop: insets.top + 8, paddingHorizontal: 24 }}>
          <BackButton fallback={PARENT} label="Back to the marketplace" />
        </View>
        <View className="flex-1 items-center justify-center">
          <EmptyState
            title="Item not available"
            body="This listing is not published. Browse what is on sale now."
          />
        </View>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-surface dark:bg-surface-dark">
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 48 + insets.bottom }}
      >
        <View>
          <PropertyGallery images={images} height={heroHeight} />
          {/* Inside the top safe area, so the control never sits under a notch. */}
          <View className="absolute left-lg" style={{ top: insets.top + 8 }}>
            <BackButton
              fallback={PARENT}
              label="Back to the marketplace"
              hint="Returns to the list of items for sale"
            />
          </View>
        </View>

        <View
          className="pt-lg gap-md"
          style={{
            width: "100%",
            maxWidth: maxContentWidth,
            alignSelf: "center",
            paddingHorizontal: gutter,
          }}
        >
          <StatusBanner
            status={item.status}
            note={item.review_note}
            viewerIsOwner={viewerIsOwner}
          />

          <View>
            <View className="flex-row items-end justify-between gap-sm">
              <Text className="text-h1 font-rubik-extrabold text-primary-300">
                {money(item.price)}
              </Text>
              {item.negotiable ? (
                <View className="rounded-full bg-success/15 px-md py-2xs">
                  <Text className="text-caption font-rubik-semibold text-success">
                    Price negotiable
                  </Text>
                </View>
              ) : (
                <View className="rounded-full bg-surface-sunken dark:bg-surface-dark-elevated px-md py-2xs">
                  <Text className="text-caption font-rubik-semibold text-black-200 dark:text-white/70">
                    Fixed price
                  </Text>
                </View>
              )}
            </View>
            <Text
              accessibilityRole="header"
              className="text-h2 font-rubik-bold text-black-300 dark:text-white mt-2xs"
            >
              {item.title}
            </Text>
            {district ? (
              <View className="flex-row items-center gap-2xs mt-2xs">
                <Image
                  source={icons.location}
                  style={{ width: 16, height: 16 }}
                  accessible={false}
                  alt=""
                />
                <Text className="text-body font-rubik text-black-200 dark:text-white/60">
                  {district}
                </Text>
              </View>
            ) : null}
          </View>

          <View className="flex-row gap-xs">
            <Fact icon={icons.info} label="Condition" value={conditionLabel(item.condition)} />
            <Fact icon={icons.area} label="Category" value={categoryLabel(item.category)} />
          </View>

          {item.description ? (
            <View>
              <Text
                accessibilityRole="header"
                className="text-h3 font-rubik-bold text-black-300 dark:text-white"
              >
                Description
              </Text>
              <Text className="text-body font-rubik text-black-200 dark:text-white/70 mt-2xs">
                {item.description}
              </Text>
            </View>
          ) : null}

          {/* No phone, no email, for anybody on this screen — the seller's
              contact details live in a separate table that only the seller and
              an admin may read, and nothing here queries it. The panel exists so
              the absence reads as a deliberate policy rather than a missing
              button. */}
          <View
            style={shadow({ opacity: 0.05, radius: 10, offsetY: 4, elevation: 2 })}
            className="rounded-md border border-line dark:border-line-dark bg-surface-muted dark:bg-surface-dark-muted px-md py-sm"
          >
            <View className="flex-row items-center gap-xs">
              <Image
                source={icons.shield}
                style={{ width: 18, height: 18 }}
                accessible={false}
                alt=""
              />
              <Text className="text-body font-rubik-semibold text-black-300 dark:text-white">
                Contact details are private
              </Text>
            </View>
            <Text className="text-caption font-rubik text-black-200 dark:text-white/70 mt-2xs">
              {viewerIsOwner
                ? "Buyers never see the number you gave us. When someone is interested they send you their own number, and you call them."
                : "The seller's number is never shown. To get in touch you share yours with them — only with this seller, and you can take it back at any time."}
            </Text>
          </View>

          {/* The buyer -> seller path. Before this existed, the panel above
              promised that "our team arranges contact" — a process that did not
              exist anywhere in the app. */}
          {canEnquire ? (
            enquired ? (
              <View className="rounded-md border border-success bg-success/10 px-md py-sm mt-sm">
                <Text className="text-body font-rubik-semibold text-success">
                  Your number is with the seller
                </Text>
                <Text className="text-caption font-rubik text-black-200 dark:text-white/70 mt-2xs">
                  They have been notified and can call you about this item.
                </Text>
                <Touchable
                  onPress={() => void withdrawEnquiry()}
                  disabled={enquiryBusy}
                  accessibilityLabel="Withdraw my enquiry and remove my number"
                  style={{ minHeight: MIN_TAP, marginTop: 12 }}
                  className="items-center justify-center rounded-full border border-line dark:border-line-dark"
                >
                  <Text className="text-caption font-rubik-semibold text-black-300 dark:text-white">
                    {enquiryBusy ? "Withdrawing…" : "Withdraw my number"}
                  </Text>
                </Touchable>
                {enquiryError ? (
                  <Text
                    accessibilityRole="alert"
                    className="text-caption font-rubik-medium text-danger mt-xs"
                  >
                    {enquiryError}
                  </Text>
                ) : null}
              </View>
            ) : enquiryOpen ? (
              <View className="rounded-md border border-line dark:border-line-dark bg-surface dark:bg-surface-dark-muted p-md mt-sm">
                <Text className="text-body font-rubik-semibold text-black-300 dark:text-white">
                  Send the seller your number
                </Text>
                <Text className="text-caption font-rubik text-black-200 dark:text-white/70 mt-2xs">
                  Only this seller sees it. Nothing is published, and you can withdraw it later.
                </Text>

                <Text className="text-caption font-rubik-medium text-black-200 dark:text-white/60 mt-md mb-2xs">
                  Your phone number
                </Text>
                <TextInput
                  value={enquiryPhone}
                  onChangeText={setEnquiryPhone}
                  placeholder="+252 61 234 5678"
                  placeholderTextColor="#8C8E98"
                  keyboardType="phone-pad"
                  accessibilityLabel="Your phone number"
                  aria-invalid={enquirySubmitted && phoneProblem}
                  style={{ minHeight: 48 }}
                  className={`rounded-lg border px-md text-body font-rubik text-black-300 dark:text-white bg-surface dark:bg-surface-dark ${
                    enquirySubmitted && phoneProblem
                      ? "border-danger"
                      : "border-line dark:border-line-dark"
                  }`}
                />
                {enquirySubmitted && phoneProblem ? (
                  <Text
                    accessibilityRole="alert"
                    className="text-caption font-rubik text-danger mt-2xs"
                  >
                    Enter a phone number the seller can reach you on.
                  </Text>
                ) : null}

                <Text className="text-caption font-rubik-medium text-black-200 dark:text-white/60 mt-md mb-2xs">
                  Message (optional)
                </Text>
                <TextInput
                  value={enquiryMessage}
                  onChangeText={setEnquiryMessage}
                  placeholder="Is this still available?"
                  placeholderTextColor="#8C8E98"
                  multiline
                  accessibilityLabel="Message to the seller"
                  style={{ minHeight: 80, textAlignVertical: "top", paddingTop: 12 }}
                  className="rounded-lg border border-line dark:border-line-dark px-md text-body font-rubik text-black-300 dark:text-white bg-surface dark:bg-surface-dark"
                />

                {enquiryError ? (
                  <Text
                    accessibilityRole="alert"
                    className="text-caption font-rubik-medium text-danger mt-xs"
                  >
                    {enquiryError}
                  </Text>
                ) : null}

                <View className="flex-row gap-xs mt-md">
                  <Touchable
                    onPress={() => setEnquiryOpen(false)}
                    disabled={enquiryBusy}
                    accessibilityLabel="Cancel"
                    style={{ flex: 1, minHeight: MIN_TAP }}
                    className="items-center justify-center rounded-full border border-line dark:border-line-dark"
                  >
                    <Text className="text-caption font-rubik-semibold text-black-300 dark:text-white">
                      Cancel
                    </Text>
                  </Touchable>
                  <Touchable
                    onPress={() => void sendEnquiry()}
                    disabled={enquiryBusy}
                    accessibilityLabel="Send my number to the seller"
                    accessibilityState={{ busy: enquiryBusy }}
                    style={{ flex: 1, minHeight: MIN_TAP }}
                    className="items-center justify-center rounded-full bg-primary-300"
                  >
                    {enquiryBusy ? (
                      <ActivityIndicator size="small" color="#FFFFFF" />
                    ) : (
                      <Text className="text-caption font-rubik-semibold text-white">Send</Text>
                    )}
                  </Touchable>
                </View>
              </View>
            ) : (
              <Touchable
                onPress={() => {
                  setEnquiryError(null);
                  setEnquirySubmitted(false);
                  setEnquiryOpen(true);
                }}
                accessibilityLabel="Interested — send the seller my number"
                style={{ minHeight: 52, marginTop: 12 }}
                className="items-center justify-center rounded-full bg-primary-300"
              >
                <Text className="text-body font-rubik-semibold text-white">
                  I am interested
                </Text>
              </Touchable>
            )
          ) : !user?.id && item.status === "approved" ? (
            <Touchable
              onPress={() =>
                router.push({
                  pathname: "/sign-in",
                  params: { returnTo: `/marketplace/${item.id}` },
                })
              }
              accessibilityLabel="Sign in to contact the seller"
              accessibilityHint="You need an account before you can share your number with the seller"
              style={{ minHeight: 52, marginTop: 12 }}
              className="items-center justify-center rounded-full bg-primary-300"
            >
              <Text className="text-body font-rubik-semibold text-white">
                Sign in to contact seller
              </Text>
            </Touchable>
          ) : null}

          {viewerIsOwner ? (
            <Touchable
              onPress={() => router.push("/marketplace/mine")}
              accessibilityLabel="Manage my listings"
              accessibilityHint="Opens the items you listed, where you can edit or remove them"
              style={{ minHeight: MIN_TAP }}
              className="items-center justify-center rounded-full border border-primary-300 bg-primary-100 px-lg"
            >
              <Text className="text-body font-rubik-semibold text-primary-300">
                Manage my listings
              </Text>
            </Touchable>
          ) : null}

          <Text className="text-caption font-rubik text-black-100 dark:text-white/40">
            Listed {new Date(item.created_at).toLocaleDateString()}
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}
