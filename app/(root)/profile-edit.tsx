import React, { useEffect, useRef, useState } from "react";
import { Image, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { describeSupabaseError, supabase } from "@/lib/supabase";
import { getMyPhone, saveMyPhone, updateMyRole } from "@/lib/api";
import { normalizePhone } from "@/lib/phone";
import type { SelfAssignableRole } from "@/lib/types";
import { useSession } from "@/lib/useSession";
import { useProfile } from "@/lib/useProfile";
import { SPACE, useResponsive } from "@/lib/responsive";
import { BackButton, EmptyState, Skeleton, Touchable } from "@/components/ui";
import { captureError } from "@/lib/sentry";

/**
 * The account types a user may pick for themselves. Publishing is gated on
 * property_owner / agency, so this control is the in-app path out of a tenant
 * account; 'admin' is not offered and migration 0009's policy rejects it.
 */
const ROLES: { value: SelfAssignableRole; label: string; hint: string }[] = [
  { value: "tenant", label: "Tenant", hint: "Browse and book places" },
  { value: "property_owner", label: "Property owner", hint: "Publish and manage your own listings" },
  { value: "agency", label: "Agency", hint: "Publish listings on behalf of owners" },
  { value: "hotel_manager", label: "Hotel manager", hint: "List short-stay and monthly units" },
];

/** Roles the platform must be able to call. Mirrors PHONE_REQUIRED_ROLES in sign-in. */
const PHONE_REQUIRED_ROLES: ReadonlyArray<SelfAssignableRole> = [
  "property_owner",
  "agency",
  "hotel_manager",
];

const IDENTITY_TYPES: { value: string; label: string }[] = [
  { value: "passport", label: "Passport" },
  { value: "national_id", label: "National ID" },
  { value: "driver_license", label: "Driver's License" },
  { value: "other", label: "Other" },
];

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  autoCapitalize = "words",
  editable = true,
  hint,
  error,
  keyboardType,
}: {
  label: string;
  value: string;
  onChangeText?: (v: string) => void;
  placeholder?: string;
  autoCapitalize?: "none" | "words";
  editable?: boolean;
  hint?: string;
  error?: string;
  keyboardType?: "default" | "phone-pad";
}) {
  return (
    <View className="mt-md">
      {/* Visible label, not a placeholder-only field. */}
      <Text className="text-caption font-rubik-medium text-black-200 dark:text-white/60 mb-2xs">
        {label}
      </Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#8C8E98"
        editable={editable}
        autoCapitalize={autoCapitalize}
        keyboardType={keyboardType}
        accessibilityLabel={label}
        accessibilityHint={hint}
        className={`rounded-md border px-md py-sm text-body font-rubik ${
          editable
            ? "bg-surface dark:bg-surface-dark-muted text-black-300 dark:text-white"
            : "bg-surface-sunken dark:bg-surface-dark-elevated text-black-200 dark:text-white/50"
        } ${error ? "border-danger" : "border-line dark:border-line-dark"}`}
      />
      {error ? (
        <Text className="text-caption font-rubik-medium text-danger mt-2xs">{error}</Text>
      ) : hint ? (
        <Text className="text-caption font-rubik text-black-100 dark:text-white/40 mt-2xs">
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

export default function ProfileEdit() {
  const { user } = useSession();
  const { profile, isAgent, loading: profileLoading, error: profileError, refresh } = useProfile();
  const { gutter, maxContentWidth } = useResponsive();

  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState<SelfAssignableRole>("tenant");
  const [identityType, setIdentityType] = useState<string>("");
  const [identityNumber, setIdentityNumber] = useState("");
  const [phone, setPhone] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  // The phone value the form was seeded with: "Save" must be enabled by a
  // real change, not merely by having a phone number on file.
  const [seededPhone, setSeededPhone] = useState("");

  // The session and the profile row both resolve asynchronously, so seeding
  // useState once at mount would leave the field permanently blank. Seed on the
  // first row that arrives instead, and never again — re-seeding would wipe out
  // edits in progress whenever `refresh()` returns.
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || !profile) return;
    seeded.current = true;
    setFullName(profile.full_name ?? user?.fullName ?? "");
    // An admin lands on 'tenant' in the picker, but the save below leaves the
    // role untouched unless it actually changed, so their role is never lost.
    if (profile.role !== "admin") setRole(profile.role);
    setIdentityType(profile.identity_type ?? "");
    setIdentityNumber(profile.identity_number ?? "");
  }, [profile, user?.fullName]);

  // The phone lives in its own table, so it is a second read rather than a
  // column on the profile row. Seeded once, like the fields above.
  const phoneSeeded = useRef(false);
  useEffect(() => {
    if (phoneSeeded.current || !user?.id) return;
    phoneSeeded.current = true;
    getMyPhone(supabase, user.id)
      .then((value) => {
        if (value) {
          setPhone(value);
          setSeededPhone(value);
        }
      })
      .catch((err) => captureError(err, "phone-load"));
  }, [user?.id]);

  // The Supabase profile mirrors identity; the name is editable there (avatar +
  // email come from Google and are read-only).
  const trimmed = fullName.trim();
  const nameError = trimmed ? undefined : "Enter your full name.";
  const roleChanged = !!profile && profile.role !== "admin" && role !== profile.role;
  const identityChanged =
    identityType !== (profile?.identity_type ?? "") ||
    identityNumber !== (profile?.identity_number ?? "");
  // Identity vault: show a friendly hint when the guest has their ID on file.
  const hasIdentity = !!identityType && !!identityNumber;

  // A publisher without a number is unreachable, so the field is required for
  // those roles and optional for a tenant.
  const phoneRequired = PHONE_REQUIRED_ROLES.includes(role);
  const phoneError = phoneRequired
    ? !phone.trim()
      ? "Enter a phone number so renters can reach you."
      : normalizePhone(phone)
        ? undefined
        : "Enter a valid Somali phone number, e.g. 061 555 1234."
    : phone.trim() && !normalizePhone(phone)
      ? "Enter a valid Somali phone number, e.g. 061 555 1234."
      : undefined;

  const dirty =
    trimmed !== (profile?.full_name ?? "") ||
    roleChanged ||
    identityChanged ||
    phone.trim() !== seededPhone.trim();
  // The button stays enabled while the name is invalid so that pressing it can
  // surface *why* — a silently dead control gives the user nothing to fix.
  const canSubmit = dirty && !saving;

  const save = async () => {
    setSubmitted(true);
    // `saving` is also checked here, not just on the button: a second tap can
    // land before the disabled state has painted.
    if (!user?.id || !canSubmit || nameError || phoneError) return;
    setSaving(true);
    try {
      // Build patch with changed fields only — keeps admin role safe.
      const patch: Record<string, unknown> = {};
      if (trimmed !== (profile?.full_name ?? "")) patch.full_name = trimmed;
      if (identityChanged) {
        patch.identity_type = identityType || null;
        patch.identity_number = identityNumber || null;
      }
      if (Object.keys(patch).length > 0) {
        const { error } = await supabase.from("profiles").update(patch).eq("id", user.id);
        if (error) throw error;
      }
      // Separate call: `role` is governed by its own RLS clause, so writing it
      // alongside the name would fail the whole update when only the role is
      // refused. Sending it only when changed also keeps an admin's role intact.
      if (roleChanged) await updateMyRole(supabase, user.id, role);
      // Separate table, separate write: the number is not a profile column, and
      // a failure here must not roll back the name or role that did save.
      const normalizedPhone = normalizePhone(phone);
      if (normalizedPhone) await saveMyPhone(supabase, user.id, normalizedPhone);
      await refresh();
      // Inline notice, not Alert.alert + immediate goBack: on native the
      // dialog used to appear over the profile screen the user had just been
      // sent to, and on web Alert is a no-op so nothing showed at all. The
      // user stays here, sees the confirmation, and goes back when ready.
      setSaveError(null);
      setSavedNotice(
        roleChanged
          ? "Your details have been updated. Your account type changed, so publishing options have been updated too."
          : "Your details have been updated."
      );
    } catch (err) {
      captureError(err, "profile-save");
      setSavedNotice(null);
      setSaveError(describeSupabaseError(err));
    } finally {
      setSaving(false);
    }
  };

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
        Edit profile
      </Text>
    </View>
  );

  // Nothing to edit until the profile row is known — showing an empty form
  // first would let the user type into a field that is about to be re-seeded.
  if (profileLoading && !profile) {
    return (
      <SafeAreaView className="flex-1 bg-surface-muted dark:bg-surface-dark" edges={["top"]}>
        {header}
        <View style={{ paddingHorizontal: gutter }} className="gap-sm mt-sm items-center">
          <Skeleton className="size-24 rounded-full" />
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </View>
      </SafeAreaView>
    );
  }

  if (profileError && !profile) {
    return (
      <SafeAreaView className="flex-1 bg-surface-muted dark:bg-surface-dark" edges={["top"]}>
        {header}
        <View className="flex-1 justify-center">
          <EmptyState title="Couldn’t load your profile" body={profileError} tone="error" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-surface-muted dark:bg-surface-dark" edges={["top"]}>
      {header}

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: gutter,
          paddingBottom: 48,
          width: "100%",
          maxWidth: maxContentWidth,
          alignSelf: "center",
        }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View className="items-center mt-sm">
          {user?.imageUrl ? (
            <Image
              source={{ uri: user.imageUrl }}
              style={{ width: 96, height: 96 }}
              className="rounded-full"
              accessibilityLabel="Your profile photo"
              alt="Your profile photo"
            />
          ) : (
            <View className="size-24 rounded-full bg-primary-200" />
          )}
          <View
            className={`mt-sm rounded-full px-md py-2xs ${
              isAgent ? "bg-success/15" : "bg-primary-100"
            }`}
          >
            <Text
              className={`text-caption font-rubik-bold ${
                isAgent ? "text-success" : "text-primary-300"
              }`}
            >
              {isAgent ? "Publisher account" : "Tenant account"}
            </Text>
          </View>
        </View>

        <Field
          label="Full name"
          value={fullName}
          onChangeText={setFullName}
          placeholder="Your full name"
          error={submitted ? nameError : undefined}
        />
        <Field
          label="Email"
          value={user?.email ?? ""}
          editable={false}
          autoCapitalize="none"
          hint="Email is managed by your Google account and cannot be changed here."
        />
        {profile?.role === "admin" ? (
          <Field
            label="Account type"
            value="Administrator"
            editable={false}
            hint="Administrator accounts are managed in Supabase and cannot be changed here."
          />
        ) : (
          <View style={{ marginTop: SPACE.md }}>
            <Text className="text-caption font-rubik-medium text-black-200 dark:text-white/60 mb-2xs">
              Account type
            </Text>
            <View accessibilityRole="radiogroup" className="gap-xs">
              {ROLES.map((option) => {
                const selected = role === option.value;
                return (
                  <Touchable
                    key={option.value}
                    onPress={() => setRole(option.value)}
                    disabled={saving}
                    accessibilityRole="tab"
                    accessibilityLabel={`${option.label}. ${option.hint}`}
                    accessibilityState={{ selected, disabled: saving }}
                    style={{ minHeight: 64 }}
                    className={`justify-center px-md rounded-lg border ${
                      selected
                        ? "border-primary-300 bg-primary-100"
                        : "border-line dark:border-line-dark bg-surface dark:bg-surface-dark-muted"
                    }`}
                  >
                    <Text
                      className={`text-body ${
                        selected
                          ? "font-rubik-semibold text-primary-300"
                          : "font-rubik-medium text-black-300 dark:text-white"
                      }`}
                    >
                      {option.label}
                    </Text>
                    <Text className="text-caption font-rubik text-black-200 dark:text-white/60 mt-2xs">
                      {option.hint}
                    </Text>
                  </Touchable>
                );
              })}
            </View>
            <Text className="text-caption font-rubik text-black-100 dark:text-white/40 mt-2xs">
              Publishing is limited to property owner, agency and hotel manager accounts.
              Changing this takes effect as soon as you save.
            </Text>
          </View>
        )}

        {/* Publisher contact number. Stored in profile_contacts, which no other
            user can read — the platform uses it to reach the publisher, and it
            is never shown on a listing. */}
        <Field
          label={phoneRequired ? "Phone number" : "Phone number (optional)"}
          value={phone}
          onChangeText={setPhone}
          placeholder="061 555 1234"
          autoCapitalize="none"
          keyboardType="phone-pad"
          error={submitted ? phoneError : undefined}
          hint={
            phoneRequired
              ? "Required for publisher accounts. Renters never see it — only the platform can reach you."
              : "Only the platform can see this. It is never shown on a listing."
          }
        />

        {/* Identity vault — lets guests/tenants store their government ID so
            property owners can verify identity at check-in. */}
        <View className="mt-lg">
          <Text className="text-body font-rubik-bold text-black-300 dark:text-white">Identity vault</Text>
          <Text className="text-caption font-rubik text-black-100 dark:text-white/40 mt-2xs">
            Add your government-issued ID so property owners can verify your identity. This
            information is encrypted and only shared when you have an active booking.
          </Text>

          <View className="mt-md">
            <Text className="text-caption font-rubik-medium text-black-200 dark:text-white/60 mb-2xs">
              ID type
            </Text>
            <View className="flex-row flex-wrap gap-xs">
              {IDENTITY_TYPES.map((option) => {
                const selected = identityType === option.value;
                return (
                  <Touchable
                    key={option.value}
                    onPress={() => setIdentityType(option.value)}
                    disabled={saving}
                    accessibilityRole="tab"
                    accessibilityLabel={`${option.label}${selected ? ", selected" : ""}`}
                    accessibilityState={{ selected, disabled: saving }}
                    style={{ minHeight: 44 }}
                    className={`items-center justify-center rounded-full px-lg ${
                      selected
                        ? "bg-primary-300"
                        : "border border-line dark:border-line-dark bg-surface dark:bg-surface-dark-muted"
                    }`}
                  >
                    <Text
                      className={`text-caption ${
                        selected
                          ? "font-rubik-semibold text-white"
                          : "font-rubik-medium text-black-200 dark:text-white/70"
                      }`}
                    >
                      {option.label}
                    </Text>
                  </Touchable>
                );
              })}
            </View>
          </View>

          <Field
            label="ID number"
            value={identityNumber}
            onChangeText={setIdentityNumber}
            placeholder="e.g. passport number"
            autoCapitalize="none"
            hint="Numbers and letters only. Your ID is stored securely."
          />
        </View>

        {submitted && nameError ? (
          <Text
            accessibilityLiveRegion="polite"
            className="text-caption font-rubik-medium text-danger mt-md"
          >
            Please fix the highlighted field before saving.
          </Text>
        ) : null}

        {savedNotice ? (
          <Text
            accessibilityLiveRegion="polite"
            className="text-caption font-rubik-medium text-success mt-md"
          >
            {savedNotice}
          </Text>
        ) : null}
        {saveError ? (
          <Text
            accessibilityRole="alert"
            className="text-caption font-rubik-medium text-danger mt-md"
          >
            Could not save profile: {saveError}
          </Text>
        ) : null}

        <Touchable
          onPress={save}
          disabled={!canSubmit}
          accessibilityLabel="Save profile"
          accessibilityState={{ disabled: !canSubmit, busy: saving }}
          style={{ minHeight: 52, marginTop: SPACE.xl }}
          className="items-center justify-center rounded-full bg-primary-300"
        >
          <Text className="text-body font-rubik-bold text-white">
            {saving ? "Saving…" : "Save changes"}
          </Text>
        </Touchable>
      </ScrollView>
    </SafeAreaView>
  );
}
