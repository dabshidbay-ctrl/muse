import React, { useCallback, useEffect, useMemo, useState } from "react";
import { FlatList, Image, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, router } from "expo-router";
import { useProfile } from "@/lib/useProfile";
import { useSupabase } from "@/lib/useSupabase";
import { describeSupabaseError, supabase } from "@/lib/supabase";
import {
  MARKETPLACE_CATEGORY_LABEL,
  MARKETPLACE_CONDITION_LABEL,
  adminDeleteProperty,
  approveMarketplaceItem,
  getAllProfiles,
  getAllProperties,
  getMarketplaceQueue,
  getPropertyPoster,
  getSellerPhone,
  rejectMarketplaceItem,
  reviewNoteProblem,
  setUserRole,
} from "@/lib/adminApi";
import { MIN_TAP, useResponsive } from "@/lib/responsive";
import { BackButton, EmptyState, IconButton, Skeleton, Touchable } from "@/components/ui";
import icons from "@/constants/icons";
import type {
  MarketplaceItem,
  Profile,
  Property,
  PropertyPoster,
  Role,
  SelfAssignableRole,
} from "@/lib/types";
import { captureError } from "@/lib/sentry";
import { normalizePhone } from "@/lib/phone";
import { getWhatsAppNumber, setWhatsAppNumber } from "@/lib/settings";

type Tab = "listings" | "users" | "approvals" | "settings";

/**
 * The roles an administrator may assign from this screen.
 *
 * 'admin' is absent on purpose and must stay absent: migration 0015's trigger
 * rejects granting 'admin' from any client — and equally refuses changing an
 * existing admin's role — so offering it would only ever produce an error.
 * Promotion is a Supabase dashboard action.
 */
const ASSIGNABLE: { value: SelfAssignableRole; label: string }[] = [
  { value: "tenant", label: "Tenant" },
  { value: "property_owner", label: "Owner" },
  { value: "agency", label: "Agency" },
  { value: "hotel_manager", label: "Hotel" },
];

const ROLE_LABEL: Record<Role, string> = {
  tenant: "Tenant",
  property_owner: "Property owner",
  agency: "Agency",
  hotel_manager: "Hotel manager",
  admin: "Administrator",
};

const money = (n: number) =>
  `$${Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

/* ------------------------------------------------------------------ banners */

function ErrorBanner({ message }: { message: string }) {
  return (
    <View
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
      className="rounded-md border border-danger/40 bg-danger/10 px-md py-sm mb-sm"
    >
      <Text className="text-caption font-rubik-medium text-danger">{message}</Text>
    </View>
  );
}

function ListSkeleton() {
  return (
    <View className="gap-sm">
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-24 w-full" />
    </View>
  );
}

/* ------------------------------------------------------------- listing row */

function ListingRow({
  item,
  confirming,
  deleting,
  poster,
  posterLoading,
  posterError,
  onRevealPoster,
  onAskDelete,
  onCancelDelete,
  onConfirmDelete,
}: {
  item: Property;
  /** True while this row is showing its "are you sure" step. */
  confirming: boolean;
  /** True while this row's delete is in flight. */
  deleting: boolean;
  /** Undefined until the admin asks; null when the listing has no publisher. */
  poster?: PropertyPoster | null;
  posterLoading: boolean;
  posterError: string | null;
  onRevealPoster: () => void;
  onAskDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
}) {
  return (
    <View className="p-md rounded-lg bg-surface dark:bg-surface-dark-muted border border-line dark:border-line-dark mb-sm">
      <View className="flex-row items-center gap-md">
        {item.image ? (
          <Image
            source={{ uri: item.image }}
            /* Never sized with `size-*`: react-native-web injects the asset's
               intrinsic size at equal specificity but later in the sheet, so a
               Tailwind class never wins. Inline style beats both. */
            style={{ width: 72, height: 72 }}
            className="rounded-md"
            resizeMode="cover"
            accessibilityLabel={`Photo of ${item.name}`}
            alt={`Photo of ${item.name}`}
          />
        ) : (
          <View
            style={{ width: 72, height: 72 }}
            className="rounded-md bg-surface-sunken dark:bg-surface-dark-elevated"
          />
        )}
        <View className="flex-1">
          <Text
            numberOfLines={1}
            className="text-body font-rubik-bold text-black-300 dark:text-white"
          >
            {item.name}
          </Text>
          <Text className="text-caption font-rubik text-black-200 dark:text-white/60 mt-2xs">
            {item.type} · {item.rental_mode === "short_term" ? "Short-term" : "Monthly"} ·{" "}
            {money(item.price)}
          </Text>
          <Text
            numberOfLines={1}
            className="text-caption font-rubik text-black-100 dark:text-white/40 mt-2xs"
          >
            {item.owner_id
              ? `Owner ${item.owner_id.slice(0, 8)}…`
              : "No owner (seeded listing)"}
          </Text>
        </View>
        <View className="gap-xs">
          <IconButton
            icon={icons.rightArrow}
            label={`Open ${item.name}`}
            onPress={() => router.push(`/properties/${item.id}`)}
            disabled={deleting}
          />
          <IconButton
            icon={icons.logout}
            label={deleting ? `Deleting ${item.name}` : `Delete ${item.name}`}
            onPress={onAskDelete}
            disabled={deleting || confirming}
            className="bg-danger/10"
          />
        </View>
      </View>

      {/* Who posted it, and the number they registered. This is the only place
          a publisher's phone is rendered, and it is behind an explicit tap so
          the number is not sitting on screen during a routine scroll. */}
      {item.owner_id ? (
        <View className="mt-sm rounded-md border border-line dark:border-line-dark p-sm">
          {poster === undefined ? (
            <Touchable
              onPress={onRevealPoster}
              disabled={posterLoading}
              accessibilityLabel={`Show who posted ${item.name}`}
              accessibilityHint="Administrators only"
              style={{ minHeight: MIN_TAP }}
              className="items-center justify-center rounded-full border border-line dark:border-line-dark bg-surface dark:bg-surface-dark-muted px-md"
            >
              <Text className="text-caption font-rubik-semibold text-black-300 dark:text-white">
                {posterLoading ? "Fetching…" : "Show poster details"}
              </Text>
            </Touchable>
          ) : poster ? (
            <View>
              <Text className="text-caption font-rubik-medium text-black-200 dark:text-white/60">
                Posted by
              </Text>
              <Text className="text-body font-rubik-bold text-black-300 dark:text-white mt-2xs">
                {poster.full_name ?? "Unnamed publisher"} · {ROLE_LABEL[poster.role]}
              </Text>
              <Text
                numberOfLines={1}
                className="text-caption font-rubik text-black-200 dark:text-white/60 mt-2xs"
              >
                {poster.email ?? "No email on file"}
              </Text>
              <Text
                selectable
                className="text-body font-rubik-bold text-black-300 dark:text-white mt-2xs"
              >
                {poster.phone ?? "No phone number on file"}
              </Text>
              <Text className="text-caption font-rubik text-black-100 dark:text-white/40 mt-2xs">
                Visible to administrators only. Visitors never see this.
              </Text>
            </View>
          ) : (
            <Text className="text-caption font-rubik text-black-200 dark:text-white/60">
              {posterError ?? "This listing has no publisher account."}
            </Text>
          )}
        </View>
      ) : null}

      {/* Confirmation is inline rather than an Alert: react-native-web ships no
          Alert implementation, so a native dialog would delete silently on web
          with no prompt shown at all. */}
      {confirming ? (
        <View
          accessibilityLiveRegion="polite"
          className="mt-sm rounded-md border border-danger/40 bg-danger/10 p-sm"
        >
          <Text className="text-caption font-rubik-medium text-danger">
            Delete “{item.name}” permanently? Its photos, amenities and bookings are deleted
            with it. This cannot be undone.
          </Text>
          <View className="flex-row gap-xs mt-sm">
            <Touchable
              onPress={onCancelDelete}
              disabled={deleting}
              accessibilityLabel={`Keep ${item.name}`}
              /* Sizing on `style` (the outer Pressable), paint on `className`
                 (the inner view that stretches to fill it). */
              style={{ flex: 1, minHeight: MIN_TAP }}
              className="items-center justify-center rounded-full border border-line dark:border-line-dark bg-surface dark:bg-surface-dark-muted px-md"
            >
              <Text className="text-caption font-rubik-semibold text-black-300 dark:text-white">
                Cancel
              </Text>
            </Touchable>
            <Touchable
              onPress={onConfirmDelete}
              disabled={deleting}
              accessibilityLabel={`Confirm deleting ${item.name}`}
              style={{ flex: 1, minHeight: MIN_TAP }}
              className="items-center justify-center rounded-full bg-danger px-md"
            >
              <Text className="text-caption font-rubik-bold text-white">
                {deleting ? "Deleting…" : "Delete"}
              </Text>
            </Touchable>
          </View>
        </View>
      ) : null}
    </View>
  );
}

/* ---------------------------------------------------------------- user row */

function UserRow({
  item,
  saving,
  isSelf,
  onSetRole,
}: {
  item: Profile;
  saving: boolean;
  isSelf: boolean;
  onSetRole: (role: SelfAssignableRole) => void;
}) {
  // An admin row is read-only here: 0015's trigger refuses both granting and
  // removing the role from a client, so offering the control would only fail.
  const locked = item.role === "admin";

  return (
    <View className="p-md rounded-lg bg-surface dark:bg-surface-dark-muted border border-line dark:border-line-dark mb-sm">
      <View className="flex-row items-center gap-md">
        {item.avatar_url ? (
          <Image
            source={{ uri: item.avatar_url }}
            style={{ width: 40, height: 40 }}
            className="rounded-full"
            accessibilityLabel={`Profile photo of ${item.full_name ?? "this user"}`}
            alt={`Profile photo of ${item.full_name ?? "this user"}`}
          />
        ) : (
          <View style={{ width: 40, height: 40 }} className="rounded-full bg-primary-200" />
        )}
        <View className="flex-1">
          <Text
            numberOfLines={1}
            className="text-body font-rubik-bold text-black-300 dark:text-white"
          >
            {item.full_name ?? "Unnamed user"}
            {isSelf ? " (you)" : ""}
          </Text>
          <Text
            numberOfLines={1}
            className="text-caption font-rubik text-black-200 dark:text-white/60 mt-2xs"
          >
            {item.email ?? "No email on file"}
          </Text>
        </View>
        <View className="rounded-full bg-primary-100 px-sm py-2xs">
          <Text className="text-caption font-rubik-semibold text-primary-300">
            {ROLE_LABEL[item.role]}
          </Text>
        </View>
      </View>

      {locked ? (
        <Text className="text-caption font-rubik text-black-100 dark:text-white/40 mt-sm">
          Administrator accounts are managed in the Supabase dashboard and cannot be changed
          from here.
        </Text>
      ) : (
        <View className="mt-sm">
          <Text className="text-caption font-rubik-medium text-black-200 dark:text-white/60 mb-2xs">
            Account type
          </Text>
          <View accessibilityRole="radiogroup" className="flex-row gap-xs">
            {ASSIGNABLE.map((option) => {
              const selected = item.role === option.value;
              return (
                <Touchable
                  key={option.value}
                  onPress={() => onSetRole(option.value)}
                  disabled={saving || selected}
                  accessibilityRole="tab"
                  accessibilityLabel={`Set ${
                    item.full_name ?? item.email ?? "this user"
                  } to ${option.label}`}
                  accessibilityState={{ selected, disabled: saving }}
                  style={{ flex: 1, minHeight: MIN_TAP }}
                  className={`items-center justify-center rounded-full border px-sm ${
                    selected
                      ? "border-primary-300 bg-primary-100"
                      : "border-line dark:border-line-dark bg-surface dark:bg-surface-dark-muted"
                  }`}
                >
                  <Text
                    className={`text-caption ${
                      selected
                        ? "font-rubik-semibold text-primary-300"
                        : "font-rubik-medium text-black-300 dark:text-white"
                    }`}
                  >
                    {option.label}
                  </Text>
                </Touchable>
              );
            })}
          </View>
          {saving ? (
            <Text
              accessibilityLiveRegion="polite"
              className="text-caption font-rubik text-black-100 dark:text-white/40 mt-2xs"
            >
              Saving…
            </Text>
          ) : null}
        </View>
      )}
    </View>
  );
}

/* ------------------------------------------------------- approval queue row */

/**
 * An empty approval queue is a *good* outcome, so it must not be rendered with
 * the error EmptyState (a red "!"). Same shape, opposite reading.
 */
function QueueClear() {
  return (
    <View className="items-center px-lg py-2xl" accessibilityRole="summary">
      <View className="size-14 rounded-full items-center justify-center mb-md bg-success/10">
        <Text className="text-h2 text-success">✓</Text>
      </View>
      <Text className="text-lead font-rubik-semibold text-black-300 dark:text-white text-center">
        Nothing waiting for review
      </Text>
      <Text className="text-body font-rubik text-black-200 dark:text-white/60 text-center mt-2xs max-w-[420px]">
        Every marketplace item has been dealt with. New submissions land here as soon as a
        seller posts them.
      </Text>
    </View>
  );
}

function MetaChip({ text }: { text: string }) {
  return (
    <View className="rounded-full bg-surface-sunken dark:bg-surface-dark-elevated px-sm py-2xs">
      <Text className="text-caption font-rubik-medium text-black-200 dark:text-white/60">
        {text}
      </Text>
    </View>
  );
}

function ApprovalRow({
  item,
  phone,
  revealing,
  phoneError,
  deciding,
  rejecting,
  note,
  noteTouched,
  onRevealPhone,
  onApprove,
  onAskReject,
  onCancelReject,
  onChangeNote,
  onConfirmReject,
}: {
  item: MarketplaceItem;
  /** undefined = not fetched yet; null = no contact row on file. */
  phone: string | null | undefined;
  revealing: boolean;
  phoneError: string | null;
  /** True while this item's approve/reject is in flight. */
  deciding: boolean;
  /** True while this row is showing its rejection-reason form. */
  rejecting: boolean;
  note: string;
  noteTouched: boolean;
  onRevealPhone: () => void;
  onApprove: () => void;
  onAskReject: () => void;
  onCancelReject: () => void;
  onChangeNote: (v: string) => void;
  onConfirmReject: () => void;
}) {
  const noteProblem = reviewNoteProblem(note);

  return (
    <View className="p-md rounded-lg bg-surface dark:bg-surface-dark-muted border border-line dark:border-line-dark mb-sm">
      {/* Photos first: most decisions here are made on the pictures. */}
      {item.images.length ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8 }}
          className="mb-sm"
        >
          {item.images.map((uri, index) => (
            <Image
              key={uri}
              source={{ uri }}
              /* Never `size-*`: react-native-web injects the asset's intrinsic
                 size at equal specificity but later in the sheet, so the class
                 never wins. Inline style beats both. */
              style={{ width: 104, height: 104 }}
              className="rounded-md"
              resizeMode="cover"
              accessibilityLabel={`Photo ${index + 1} of ${item.images.length} for ${item.title}`}
              alt={`Photo ${index + 1} of ${item.images.length} for ${item.title}`}
            />
          ))}
        </ScrollView>
      ) : (
        <View className="rounded-md border border-warning/40 bg-warning/10 px-md py-sm mb-sm">
          <Text className="text-caption font-rubik-medium text-warning">
            No photos attached. An item with no photo cannot be judged — reject it and say so.
          </Text>
        </View>
      )}

      <Text className="text-body font-rubik-bold text-black-300 dark:text-white">
        {item.title}
      </Text>
      <Text className="text-caption font-rubik-semibold text-primary-300 mt-2xs">
        {money(item.price)}
        {item.negotiable ? " · Negotiable" : ""}
      </Text>

      <View className="flex-row flex-wrap gap-xs mt-sm">
        <MetaChip text={MARKETPLACE_CATEGORY_LABEL[item.category]} />
        <MetaChip text={MARKETPLACE_CONDITION_LABEL[item.condition]} />
        <MetaChip text={item.district ?? "No district"} />
      </View>

      <Text className="text-caption font-rubik text-black-200 dark:text-white/60 mt-sm">
        {item.description?.trim() || "No description given."}
      </Text>

      {/* ---- seller. The only place in the app a phone number is rendered. */}
      <View className="mt-sm rounded-md border border-line dark:border-line-dark p-sm">
        <Text className="text-caption font-rubik-medium text-black-200 dark:text-white/60">
          Seller {item.seller_id.slice(0, 8)}… · submitted{" "}
          {new Date(item.created_at).toLocaleDateString()}
        </Text>

        {phone === undefined ? (
          <View className="flex-row mt-xs">
            <Touchable
              onPress={onRevealPhone}
              disabled={revealing || deciding}
              accessibilityLabel={`Show the seller's phone number for ${item.title}`}
              accessibilityHint="Only administrators can see this number"
              /* Sizing on `style` (outer Pressable), paint on `className`. */
              style={{ minHeight: MIN_TAP }}
              className="items-center justify-center rounded-full border border-line dark:border-line-dark bg-surface dark:bg-surface-dark-muted px-md"
            >
              <Text className="text-caption font-rubik-semibold text-black-300 dark:text-white">
                {revealing ? "Fetching…" : "Show phone number"}
              </Text>
            </Touchable>
          </View>
        ) : (
          <Text
            accessibilityLiveRegion="polite"
            selectable
            className="text-body font-rubik-bold text-black-300 dark:text-white mt-2xs"
          >
            {phone ?? "No phone number on file"}
          </Text>
        )}

        {phoneError ? (
          <Text className="text-caption font-rubik-medium text-danger mt-2xs">{phoneError}</Text>
        ) : (
          <Text className="text-caption font-rubik text-black-100 dark:text-white/40 mt-2xs">
            Visible to administrators only. Buyers never see it.
          </Text>
        )}
      </View>

      {/* ---- decision */}
      {rejecting ? (
        /* Inline rather than an Alert: react-native-web ships no Alert
           implementation, so on web the prompt would never appear and the note
           could never be typed at all. */
        <View
          accessibilityLiveRegion="polite"
          className="mt-sm rounded-md border border-danger/40 bg-danger/10 p-sm"
        >
          <Text className="text-caption font-rubik-semibold text-danger">
            Why is “{item.title}” being rejected?
          </Text>
          <TextInput
            value={note}
            onChangeText={onChangeNote}
            placeholder="e.g. The photos show a different item than the title describes."
            placeholderTextColor="#8C8E98"
            multiline
            editable={!deciding}
            accessibilityLabel={`Reason for rejecting ${item.title}`}
            accessibilityHint="The seller is shown this note"
            className={`mt-xs rounded-md border bg-surface dark:bg-surface-dark-muted px-md py-sm text-body font-rubik text-black-300 dark:text-white ${
              noteTouched && noteProblem ? "border-danger" : "border-line dark:border-line-dark"
            }`}
            style={{ minHeight: 88, textAlignVertical: "top" }}
          />
          <Text
            accessibilityLiveRegion="polite"
            className={`text-caption mt-2xs ${
              noteTouched && noteProblem
                ? "font-rubik-medium text-danger"
                : "font-rubik text-black-200 dark:text-white/60"
            }`}
          >
            {noteTouched && noteProblem
              ? noteProblem
              : "Required. The seller is shown this note — a rejection with no reason is indistinguishable from a bug."}
          </Text>
          <View className="flex-row gap-xs mt-sm">
            <Touchable
              onPress={onCancelReject}
              disabled={deciding}
              accessibilityLabel={`Keep ${item.title} in the queue`}
              style={{ flex: 1, minHeight: MIN_TAP }}
              className="items-center justify-center rounded-full border border-line dark:border-line-dark bg-surface dark:bg-surface-dark-muted px-md"
            >
              <Text className="text-caption font-rubik-semibold text-black-300 dark:text-white">
                Cancel
              </Text>
            </Touchable>
            <Touchable
              onPress={onConfirmReject}
              /* The note is the whole point of a rejection, so the control
                 cannot fire without one; rejectMarketplaceItem re-checks,
                 because a disabled button is a hint and not a guarantee. */
              disabled={deciding || !!noteProblem}
              accessibilityLabel={`Confirm rejecting ${item.title}`}
              accessibilityHint={
                noteProblem ? "Write a reason first" : "The seller is shown this reason"
              }
              accessibilityState={{ disabled: deciding || !!noteProblem }}
              style={{ flex: 1, minHeight: MIN_TAP }}
              className="items-center justify-center rounded-full bg-danger px-md"
            >
              <Text className="text-caption font-rubik-bold text-white">
                {deciding ? "Rejecting…" : "Reject"}
              </Text>
            </Touchable>
          </View>
        </View>
      ) : (
        <View className="flex-row gap-xs mt-sm">
          <Touchable
            onPress={onAskReject}
            disabled={deciding}
            accessibilityLabel={`Reject ${item.title}`}
            accessibilityHint="Asks for a reason before rejecting"
            style={{ flex: 1, minHeight: MIN_TAP }}
            className="items-center justify-center rounded-full border border-danger/40 bg-danger/10 px-md"
          >
            <Text className="text-caption font-rubik-semibold text-danger">Reject</Text>
          </Touchable>
          <Touchable
            onPress={onApprove}
            disabled={deciding}
            accessibilityLabel={`Approve ${item.title}`}
            accessibilityHint="Publishes it to the marketplace"
            style={{ flex: 1, minHeight: MIN_TAP }}
            className="items-center justify-center rounded-full bg-primary-300 px-md"
          >
            <Text className="text-caption font-rubik-bold text-white">
              {deciding ? "Saving…" : "Approve"}
            </Text>
          </Touchable>
        </View>
      )}
    </View>
  );
}

/**
 * Says so when a list is showing only its first page.
 *
 * The admin queries cap at 200 rows. Without this, a platform with 250
 * listings looks like a platform with 200 — the moderator has no way to tell a
 * complete list from a truncated one, which is the worst kind of quiet.
 */
const ADMIN_PAGE_LIMIT = 200;

function TruncationNotice({ count, noun }: { count: number; noun: string }) {
  if (count < ADMIN_PAGE_LIMIT) return null;
  return (
    <View className="rounded-lg border border-warning bg-warning/10 p-md mb-sm">
      <Text className="text-caption font-rubik-medium text-warning">
        Showing the first {ADMIN_PAGE_LIMIT} {noun}. There may be more — narrow the platform
        down in the Supabase dashboard to review the rest.
      </Text>
    </View>
  );
}

/* ------------------------------------------------------------------- screen */

export default function Admin() {
  const { profile, isAdmin, loading: profileLoading, error: profileError } = useProfile();
  const { gutter, maxContentWidth } = useResponsive();
  const [tab, setTab] = useState<Tab>("listings");
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [savingUserId, setSavingUserId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Nothing is fetched until the role is known *and* it is 'admin': for anyone
  // else the profiles read comes back as a partial list with no error, which is
  // indistinguishable from "there are no users".
  const gated = profileLoading || !isAdmin;

  const {
    data: properties,
    initialLoading: propertiesLoading,
    error: propertiesError,
    refetch: refetchProperties,
  } = useSupabase<{ limit: number }, Property[]>({
    fn: (client, params) => getAllProperties(client, params),
    params: { limit: 200 },
    skip: gated,
  });

  const {
    data: profiles,
    initialLoading: profilesLoading,
    error: profilesError,
    refetch: refetchProfiles,
  } = useSupabase<{ limit: number }, Profile[]>({
    fn: (client, params) => getAllProfiles(client, params),
    params: { limit: 200 },
    skip: gated,
  });

  const {
    data: queue,
    initialLoading: queueLoading,
    error: queueError,
    refetch: refetchQueue,
  } = useSupabase<Record<string, never>, MarketplaceItem[]>({
    fn: (client) => getMarketplaceQueue(client),
    params: {},
    skip: gated,
  });

  // Phones are fetched one row at a time, on demand, and held only for the life
  // of this screen: an admin should not pull every seller's number into memory
  // just by opening the queue.
  const [phones, setPhones] = useState<Record<string, string | null>>({});
  const [revealingId, setRevealingId] = useState<string | null>(null);
  const [phoneErrors, setPhoneErrors] = useState<Record<string, string | null>>({});
  const [decidingId, setDecidingId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [noteTouched, setNoteTouched] = useState(false);

  // Listing posters are fetched on demand for the same reason as seller phones:
  // opening the console must not pull every publisher's number into memory.
  // `undefined` means "not asked yet", `null` means "asked, no publisher".
  // WhatsApp number for the property-page contact button (settings tab).
  // Loaded once for admins; an empty value hides the button on details.
  const [whatsappInput, setWhatsappInput] = useState("");
  const [whatsappLoaded, setWhatsappLoaded] = useState(false);
  const [whatsappSaving, setWhatsappSaving] = useState(false);
  const [whatsappNotice, setWhatsappNotice] = useState<string | null>(null);
  const [whatsappError, setWhatsappError] = useState<string | null>(null);
  useEffect(() => {
    if (!isAdmin) return;
    getWhatsAppNumber(supabase)
      .then((v) => setWhatsappInput(v ?? ""))
      .catch(() => {})
      .finally(() => setWhatsappLoaded(true));
  }, [isAdmin]);
  const saveWhatsApp = async () => {
    setWhatsappError(null);
    setWhatsappNotice(null);
    if (!normalizePhone(whatsappInput)) {
      setWhatsappError("Enter a valid Somali phone number, e.g. 061 555 1234.");
      return;
    }
    setWhatsappSaving(true);
    try {
      await setWhatsAppNumber(supabase, whatsappInput);
      setWhatsappInput(normalizePhone(whatsappInput) ?? whatsappInput);
      setWhatsappNotice(
        "WhatsApp number saved. Property pages now open a chat to this number."
      );
    } catch (err) {
      setWhatsappError(describeSupabaseError(err));
    } finally {
      setWhatsappSaving(false);
    }
  };

  const [posters, setPosters] = useState<Record<string, PropertyPoster | null>>({});
  const [posterLoadingId, setPosterLoadingId] = useState<string | null>(null);
  const [posterErrors, setPosterErrors] = useState<Record<string, string | null>>({});

  const handleRevealPoster = useCallback(async (item: Property) => {
    if (!item.owner_id) return;
    setPosterLoadingId(item.id);
    setPosterErrors((e) => ({ ...e, [item.id]: null }));
    try {
      const poster = await getPropertyPoster(supabase, item.owner_id);
      setPosters((p) => ({ ...p, [item.id]: poster }));
    } catch (err) {
      // The number must not reach an error reporter, so only the failure is
      // recorded — never the row that was being read.
      captureError(new Error("Failed to read listing poster"), "admin-reveal-poster", {
        propertyId: item.id,
      });
      setPosterErrors((e) => ({ ...e, [item.id]: describeSupabaseError(err) }));
    } finally {
      setPosterLoadingId(null);
    }
  }, []);

  const handleRevealPhone = useCallback(async (item: MarketplaceItem) => {
    setRevealingId(item.id);
    setPhoneErrors((e) => ({ ...e, [item.id]: null }));
    try {
      const phone = await getSellerPhone(supabase, item.id);
      setPhones((p) => ({ ...p, [item.id]: phone }));
    } catch (err) {
      // Deliberately not passed to captureError: the number must not reach an
      // error reporter. Only the failure itself is recorded.
      captureError(new Error("Failed to read seller contact"), "admin-reveal-phone", {
        itemId: item.id,
      });
      setPhoneErrors((e) => ({ ...e, [item.id]: describeSupabaseError(err) }));
    } finally {
      setRevealingId(null);
    }
  }, []);

  const handleApprove = useCallback(
    async (item: MarketplaceItem) => {
      setDecidingId(item.id);
      setActionError(null);
      try {
        await approveMarketplaceItem(supabase, item.id);
        // Drop the number as soon as the decision is made — there is no reason
        // to keep it once the row leaves the queue.
        setPhones((p) => {
          const next = { ...p };
          delete next[item.id];
          return next;
        });
        await refetchQueue();
      } catch (err) {
        captureError(err, "admin-approve-item");
        setActionError(describeSupabaseError(err));
      } finally {
        setDecidingId(null);
      }
    },
    [refetchQueue]
  );

  const handleReject = useCallback(
    async (item: MarketplaceItem) => {
      setNoteTouched(true);
      // The note is what the seller is shown; rejecting without one is
      // indistinguishable from a bug on their side.
      if (reviewNoteProblem(note)) return;
      setDecidingId(item.id);
      setActionError(null);
      try {
        await rejectMarketplaceItem(supabase, item.id, note);
        setPhones((p) => {
          const next = { ...p };
          delete next[item.id];
          return next;
        });
        setRejectingId(null);
        setNote("");
        setNoteTouched(false);
        await refetchQueue();
      } catch (err) {
        captureError(err, "admin-reject-item");
        setActionError(describeSupabaseError(err));
      } finally {
        setDecidingId(null);
      }
    },
    [note, refetchQueue]
  );

  const handleDelete = useCallback(
    async (item: Property) => {
      setDeletingId(item.id);
      setActionError(null);
      try {
        // supabase-js resolves with an `error` field instead of rejecting, so a
        // refused delete would read as success — adminDeleteProperty checks
        // both the error and the affected row count and throws.
        await adminDeleteProperty(supabase, item.id);
        setConfirmingId(null);
        await refetchProperties();
      } catch (err) {
        captureError(err, "admin-delete-property");
        setActionError(`Could not delete “${item.name}”. ${describeSupabaseError(err)}`);
      } finally {
        setDeletingId(null);
      }
    },
    [refetchProperties]
  );

  const handleSetRole = useCallback(
    async (item: Profile, role: SelfAssignableRole) => {
      setSavingUserId(item.id);
      setActionError(null);
      try {
        await setUserRole(supabase, item.id, role);
        await refetchProfiles();
      } catch (err) {
        captureError(err, "admin-set-role");
        // Surfaced verbatim: when the 0015 trigger refuses a change it explains
        // why, and swallowing that would leave the row looking merely broken.
        setActionError(
          `Could not change the account type for ${
            item.full_name ?? item.email ?? "that user"
          }. ${describeSupabaseError(err)}`
        );
      } finally {
        setSavingUserId(null);
      }
    },
    [refetchProfiles]
  );

  const listPadding = useMemo(
    () => ({
      paddingHorizontal: gutter,
      paddingBottom: 64,
      width: "100%" as const,
      maxWidth: maxContentWidth,
      alignSelf: "center" as const,
    }),
    [gutter, maxContentWidth]
  );

  const header = (
    <View
      style={{ paddingHorizontal: gutter }}
      className="flex-row items-center gap-sm pt-sm pb-xs"
    >
      <BackButton fallback="/profile" />
      <Text
        accessibilityRole="header"
        className="flex-1 text-h2 font-rubik-extrabold text-black-300 dark:text-white"
      >
        Admin
      </Text>
    </View>
  );

  /* ---- state 1: the role is not known yet. Never guess it — flashing the
     refusal at a real admin, or the console at a tenant, are both wrong. */
  if (profileLoading) {
    return (
      <SafeAreaView className="flex-1 bg-surface-muted dark:bg-surface-dark" edges={["top"]}>
        <Stack.Screen options={{ title: "Admin" }} />
        {header}
        <View style={{ paddingHorizontal: gutter }} className="gap-sm">
          <Skeleton className="h-12 w-full" />
          <ListSkeleton />
        </View>
      </SafeAreaView>
    );
  }

  /* ---- state 2: the profile row itself could not be read. */
  if (profileError) {
    return (
      <SafeAreaView className="flex-1 bg-surface-muted dark:bg-surface-dark" edges={["top"]}>
        <Stack.Screen options={{ title: "Admin" }} />
        {header}
        <View className="flex-1 justify-center">
          <EmptyState title="Couldn’t load your account" body={profileError} tone="error" />
        </View>
      </SafeAreaView>
    );
  }

  /* ---- state 3: signed in, but not an administrator. An explicit refusal
     rather than an empty screen that reads as a bug. */
  if (!isAdmin) {
    return (
      <SafeAreaView className="flex-1 bg-surface-muted dark:bg-surface-dark" edges={["top"]}>
        <Stack.Screen options={{ title: "Admin" }} />
        {header}
        <View className="flex-1 justify-center">
          <EmptyState
            title="Administrators only"
            body="This screen moderates every listing and account on the platform, so it is limited to administrator accounts. The administrator role is granted in the Supabase dashboard."
          />
          <View className="items-center px-lg">
            <Touchable
              onPress={() => router.replace("/profile")}
              accessibilityLabel="Back to your profile"
              style={{ minHeight: 52 }}
              className="items-center justify-center rounded-full bg-primary-300 px-xl"
            >
              <Text className="text-body font-rubik-bold text-white">Back to profile</Text>
            </Touchable>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  /* ---- state 4: administrator. */
  const showingListings = tab === "listings";
  const showingApprovals = tab === "approvals";
  const listLoading = showingApprovals
    ? queueLoading
    : showingListings
      ? propertiesLoading
      : profilesLoading;
  const listError = showingApprovals
    ? queueError
    : showingListings
      ? propertiesError
      : profilesError;
  // Only the count is read here, so the element type does not matter.
  const rows: readonly unknown[] | null | undefined = showingApprovals
    ? queue
    : showingListings
      ? properties
      : profiles;
  // An empty list is only empty once a query has actually come back clean;
  // "loading" and "failed" must never render as "there is nothing here".
  const isEmpty = !listLoading && !listError && (rows?.length ?? 0) === 0;

  const tabs = (
    <View style={{ paddingHorizontal: gutter }} className="pb-sm">
      <View accessibilityRole="tablist" className="flex-row gap-xs">
        {(
          [
            ["listings", "All listings", properties?.length],
            ["users", "All users", profiles?.length],
            ["approvals", "Approvals", queue?.length],
            ["settings", "Settings", undefined],
          ] as const
        ).map(([value, label, count]) => {
          const selected = tab === value;
          return (
            <Touchable
              key={value}
              onPress={() => {
                setTab(value);
                setActionError(null);
                setConfirmingId(null);
              }}
              accessibilityRole="tab"
              accessibilityLabel={`${label}${selected ? ", selected" : ""}`}
              accessibilityState={{ selected }}
              style={{ flex: 1, minHeight: MIN_TAP }}
              className={`items-center justify-center rounded-full border px-md ${
                selected
                  ? "border-primary-300 bg-primary-100"
                  : "border-line dark:border-line-dark bg-surface dark:bg-surface-dark-muted"
              }`}
            >
              <Text
                className={`text-caption ${
                  selected
                    ? "font-rubik-semibold text-primary-300"
                    : "font-rubik-medium text-black-300 dark:text-white"
                }`}
              >
                {label}
                {typeof count === "number" ? ` (${count})` : ""}
              </Text>
            </Touchable>
          );
        })}
      </View>
    </View>
  );

  return (
    <SafeAreaView className="flex-1 bg-surface-muted dark:bg-surface-dark" edges={["top"]}>
      <Stack.Screen options={{ title: "Admin" }} />
      {header}
      {tabs}

      {/* Settings is its own panel, not a list — it renders instead of the
          list chain, so the loading/empty branches below never apply to it. */}
      {tab === "settings" ? (
        <ScrollView
          style={{ paddingHorizontal: gutter }}
          contentContainerStyle={{ paddingBottom: 24 }}
          showsVerticalScrollIndicator={false}
        >
          <Text className="text-h2 font-rubik-extrabold text-black-300 dark:text-white mb-2xs">
            WhatsApp contact
          </Text>
          <Text className="text-body font-rubik text-black-200 dark:text-white/70 mb-md">
            This is the number visitors chat to when they tap WhatsApp on a
            property page. Their message arrives pre-filled with the property
            details — they just press send. Leave it empty to hide the button.
          </Text>
          <Text className="text-caption font-rubik-medium text-black-200 dark:text-white/60 mb-2xs">
            WhatsApp number
          </Text>
          <TextInput
            value={whatsappInput}
            onChangeText={(v) => {
              setWhatsappInput(v);
              setWhatsappNotice(null);
              setWhatsappError(null);
            }}
            placeholder="061 555 1234"
            placeholderTextColor="#8C8E98"
            keyboardType="phone-pad"
            autoCorrect={false}
            accessibilityLabel="WhatsApp number for property pages"
            editable={whatsappLoaded}
            className="rounded-lg border border-line dark:border-line-dark bg-surface dark:bg-surface-dark-muted px-md py-md text-body font-rubik text-black-300 dark:text-white mb-sm"
          />
          {whatsappError ? <ErrorBanner message={whatsappError} /> : null}
          {whatsappNotice ? (
            <Text className="text-body font-rubik-medium text-primary-300 mb-sm">
              {whatsappNotice}
            </Text>
          ) : null}
          <Touchable
            onPress={saveWhatsApp}
            disabled={whatsappSaving || !whatsappLoaded}
            accessibilityLabel="Save WhatsApp number"
            style={{ minHeight: 52 }}
            className="items-center justify-center rounded-full bg-primary-300 px-lg"
          >
            <Text className="text-body font-rubik-bold text-white">
              {whatsappSaving ? "Saving…" : "Save WhatsApp number"}
            </Text>
          </Touchable>
        </ScrollView>
      ) : /* `initialLoading`, not `loading`: the refetch after a delete or a role
          change must not blank the list back to skeletons. */
      listLoading ? (
        <View style={{ paddingHorizontal: gutter }}>
          <ListSkeleton />
        </View>
      ) : listError && !rows?.length ? (
        <View className="flex-1 justify-center">
          <EmptyState
            title={
              showingApprovals
                ? "Could not load the approval queue"
                : showingListings
                  ? "Could not load listings"
                  : "Could not load users"
            }
            body={listError}
            tone="error"
          />
        </View>
      ) : showingApprovals ? (
        <FlatList
          data={queue ?? []}
          keyExtractor={(item) => item.id}
          contentContainerStyle={listPadding}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            <View>
              {actionError ? <ErrorBanner message={actionError} /> : null}
              {queueError && queue?.length ? (
                <ErrorBanner message={`This list may be out of date. ${queueError}`} />
              ) : null}
            </View>
          }
          ListEmptyComponent={
            isEmpty ? (
              // An empty queue is the good outcome, so it must not look like
              // the error state directly above it.
              <EmptyState
                title="Nothing waiting for review"
                body="Every marketplace item has been reviewed. New submissions appear here."
              />
            ) : undefined
          }
          renderItem={({ item }) => (
            <ApprovalRow
              item={item}
              phone={phones[item.id]}
              revealing={revealingId === item.id}
              phoneError={phoneErrors[item.id] ?? null}
              deciding={decidingId === item.id}
              rejecting={rejectingId === item.id}
              note={rejectingId === item.id ? note : ""}
              noteTouched={rejectingId === item.id && noteTouched}
              onRevealPhone={() => void handleRevealPhone(item)}
              onApprove={() => void handleApprove(item)}
              onAskReject={() => {
                setActionError(null);
                setRejectingId(item.id);
                setNote("");
                setNoteTouched(false);
              }}
              onCancelReject={() => {
                setRejectingId(null);
                setNote("");
                setNoteTouched(false);
              }}
              onChangeNote={setNote}
              onConfirmReject={() => void handleReject(item)}
            />
          )}
        />
      ) : showingListings ? (
        <FlatList
          data={properties ?? []}
          keyExtractor={(item) => item.id}
          contentContainerStyle={listPadding}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            <View>
              {actionError ? <ErrorBanner message={actionError} /> : null}
              <TruncationNotice count={properties?.length ?? 0} noun="listings" />
              {/* A failed *refetch* keeps the rows on screen, so say they are stale. */}
              {propertiesError && properties?.length ? (
                <ErrorBanner message={`This list may be out of date. ${propertiesError}`} />
              ) : null}
            </View>
          }
          ListEmptyComponent={
            isEmpty ? (
              <EmptyState
                title="No listings on the platform"
                body="Nothing has been published yet. Listings created by any owner or agency appear here."
              />
            ) : undefined
          }
          renderItem={({ item }) => (
            <ListingRow
              item={item}
              confirming={confirmingId === item.id}
              deleting={deletingId === item.id}
              poster={posters[item.id]}
              posterLoading={posterLoadingId === item.id}
              posterError={posterErrors[item.id] ?? null}
              onRevealPoster={() => void handleRevealPoster(item)}
              onAskDelete={() => {
                setActionError(null);
                setConfirmingId(item.id);
              }}
              onCancelDelete={() => setConfirmingId(null)}
              onConfirmDelete={() => void handleDelete(item)}
            />
          )}
        />
      ) : (
        <FlatList
          data={profiles ?? []}
          keyExtractor={(item) => item.id}
          contentContainerStyle={listPadding}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            <View>
              {actionError ? <ErrorBanner message={actionError} /> : null}
              <TruncationNotice count={profiles?.length ?? 0} noun="users" />
              {profilesError && profiles?.length ? (
                <ErrorBanner message={`This list may be out of date. ${profilesError}`} />
              ) : null}
              <Text className="text-caption font-rubik text-black-200 dark:text-white/60 mb-sm">
                Move people between tenant, owner and agency accounts. Granting or removing the
                administrator role is a Supabase dashboard action and is not offered here.
              </Text>
            </View>
          }
          ListEmptyComponent={
            isEmpty ? (
              <EmptyState
                title="No users to show"
                body="No profile rows came back. If you expected to see accounts here, check that this account still has the administrator role."
              />
            ) : undefined
          }
          renderItem={({ item }) => (
            <UserRow
              item={item}
              saving={savingUserId === item.id}
              isSelf={item.id === profile?.id}
              onSetRole={(role) => void handleSetRole(item, role)}
            />
          )}
        />
      )}
    </SafeAreaView>
  );
}
