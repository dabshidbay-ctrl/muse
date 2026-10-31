import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
    ActivityIndicator,
    Image,
    ImageBackground,
    KeyboardAvoidingView,
    Platform,
    ScrollView,
    Text,
    TextInput,
    View,
} from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { Redirect, router, useLocalSearchParams } from 'expo-router'
import * as WebBrowser from 'expo-web-browser'
import {
    describeAuthError,
    sendPasswordReset,
    signInWithEmail,
    signInWithGoogle,
    signUpWithEmail,
    type SignUpRole,
} from '@/lib/supabase'
import { useSession } from '@/lib/useSession'
import { saveMyPhone } from '@/lib/api'
import { normalizePhone } from '@/lib/phone'
import { supabase } from '@/lib/supabase'
import { shadow, useResponsive } from '@/lib/responsive'
import { Touchable } from '@/components/ui'
import images from '@/constants/images'
import icons from '@/constants/icons'
import { captureError } from '@/lib/sentry'

// Dismisses the auth browser tab when it redirects back into the app.
WebBrowser.maybeCompleteAuthSession()

/**
 * Preloading the browser makes the OAuth tab open noticeably faster.
 *
 * Both calls are Android-only. expo-web-browser throws UnavailabilityError for
 * them before it reaches its own `Platform.OS !== 'android'` early return, so
 * the platform check has to happen here or every mount on web/iOS produces an
 * unhandled rejection.
 */
const useWarmUpBrowser = () => {
    useEffect(() => {
        if (Platform.OS !== 'android') return

        void WebBrowser.warmUpAsync()
        return () => {
            void WebBrowser.coolDownAsync()
        }
    }, [])
}

// Deliberately loose: the server is the real authority on deliverability, and a
// strict pattern mostly rejects addresses that are in fact valid.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Supabase's own default floor is 6; 8 is the shortest length worth asking for
// and matches what `describeAuthError` tells the user after a weak_password.
const MIN_PASSWORD = 8

type Mode = 'signin' | 'signup'

/**
 * `Touchable` puts `className` on an inner Animated.View and `style` on the
 * outer Pressable, so a margin written as a class sits *inside* the pressable
 * and silently grows the tap target into the gap above the control. Spacing
 * therefore goes through `style`; these mirror the spacing scale in
 * tailwind.config.js so the rhythm stays the same.
 */
const SPACE = { xs: 8, md: 16, lg: 24, xl: 32 } as const

/**
 * The account types someone may pick for themselves. 'admin' is deliberately
 * absent — it is granted in the SQL editor, never requested — and
 * `handle_new_user()` (migration 0007) re-checks this whitelist server-side,
 * because user metadata is client-controlled and this list is only a UI.
 */
const ROLES: ReadonlyArray<{ value: SignUpRole; label: string; hint: string }> = [
    { value: 'tenant', label: 'Tenant', hint: 'Browse and book places' },
    {
        value: 'property_owner',
        label: 'Property owner',
        hint: 'Publish and manage your own listings',
    },
    { value: 'agency', label: 'Agency', hint: 'Publish listings on behalf of owners' },
    {
        value: 'hotel_manager',
        label: 'Hotel manager',
        hint: 'List short-stay and monthly units',
    },
]

/**
 * Roles that must register a phone number.
 *
 * A publisher is the only party the platform cannot reach any other way: a
 * tenant is contacted through their own booking, but an owner, agency or hotel
 * manager has to be callable when a listing is queried or a guest needs them.
 * The number is stored in public.profile_contacts, never on the profile row, so
 * it is not readable by other users.
 */
const PHONE_REQUIRED_ROLES: ReadonlyArray<SignUpRole> = [
    'property_owner',
    'agency',
    'hotel_manager',
]

type FieldProps = {
    label: string
    value: string
    onChangeText: (v: string) => void
    /** Shown only once the form has been submitted, so typing is not nagged. */
    error?: string
    hint?: string
} & React.ComponentProps<typeof TextInput>

// forwardRef so the email field can move focus to the password field on submit.
const Field = React.forwardRef<React.ElementRef<typeof TextInput>, FieldProps>(function Field(
    { label, value, onChangeText, error, hint, ...input },
    ref,
) {
    return (
        <View className="mt-md">
            {/* A visible label, not a placeholder-only field: placeholders vanish
                on focus and are not reliably announced. */}
            <Text className="text-caption font-rubik-medium text-black-200 dark:text-white/60 mb-2xs">
                {label}
            </Text>
            <TextInput
                ref={ref}
                value={value}
                onChangeText={onChangeText}
                placeholderTextColor="#8C8E98"
                accessibilityLabel={label}
                aria-invalid={!!error}
                className={`rounded-lg border px-md text-body font-rubik text-black-300 dark:text-white bg-surface dark:bg-surface-dark-muted ${
                    error ? 'border-danger' : 'border-line dark:border-line-dark'
                }`}
                style={{ minHeight: 52 }}
                {...input}
            />
            {error ? (
                <Text
                    accessibilityRole="alert"
                    className="text-caption font-rubik text-danger mt-2xs"
                >
                    {error}
                </Text>
            ) : hint ? (
                <Text className="text-caption font-rubik text-black-100 dark:text-white/40 mt-2xs">
                    {hint}
                </Text>
            ) : null}
        </View>
    )
})

/**
 * Where the sign-in screen may send a user back to. A protected destination
 * (Profile, bookings, publishing) is fine after sign-in, but as a *back*
 * destination while still signed out it would bounce straight back here
 * through the (root) guard — so back only ever lands on a public page.
 */
const isPublicReturn = (path: string): boolean => {
    if (path === '/' || path === '/explore' || path === '/marketplace') return true
    if (path.startsWith('/properties/')) {
        const rest = path.slice('/properties/'.length)
        return rest !== 'new' && rest !== 'edit' && rest !== 'listings' && !rest.includes('/')
    }
    if (path.startsWith('/marketplace/')) {
        const rest = path.slice('/marketplace/'.length)
        return rest !== 'new' && rest !== 'mine' && !rest.includes('/')
    }
    return false
}

const SignIn = () => {
    useWarmUpBrowser()

    const { isSignedIn } = useSession()
    const insets = useSafeAreaInsets()
    const { returnTo } = useLocalSearchParams<{ returnTo?: string }>()
    const safeReturnTo =
        typeof returnTo === 'string' && returnTo.startsWith('/') && returnTo !== '/sign-in'
            ? returnTo
            : null

    const handleBack = () => {
        if (safeReturnTo && isPublicReturn(safeReturnTo)) {
            router.replace(safeReturnTo)
            return
        }
        if (router.canGoBack()) {
            router.back()
            return
        }
        router.replace('/')
    }
    const { heroHeight, height, isLandscape, gutter, isAtLeast } = useResponsive()
    const authHeroHeight = Math.min(
        heroHeight,
        Math.round(height * (isLandscape ? 0.24 : 0.3)),
    )

    const [mode, setMode] = useState<Mode>('signin')
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [fullName, setFullName] = useState('')
    const [phone, setPhone] = useState('')
    const [role, setRole] = useState<SignUpRole>('tenant')
    const [submitted, setSubmitted] = useState(false)
    // Set only by "Forgot password?": the reset flow validates the email
    // field alone, so it must not light up the password (or phone) errors
    // the way a full form submit does.
    const [resetAttempted, setResetAttempted] = useState(false)
    const [busy, setBusy] = useState<'email' | 'google' | 'reset' | null>(null)
    // Set after a sign-up that Supabase withheld a session for. Replaces the
    // form, because there is nothing more to do on this screen until the user
    // opens the link in their inbox.
    const [sentTo, setSentTo] = useState<string | null>(null)
    // Rendered inline rather than through Alert.alert: react-native-web ships
    // `static alert() {}`, so on web every auth failure was silent — a wrong
    // password looked like a button that did nothing.
    const [formError, setFormError] = useState<string | null>(null)
    const [formNotice, setFormNotice] = useState<string | null>(null)

    const passwordRef = useRef<React.ElementRef<typeof TextInput>>(null)

    const isSignUp = mode === 'signup'

    const errors = useMemo(() => {
        const emailError = !email.trim()
            ? 'Enter your email address.'
            : EMAIL_RE.test(email.trim())
              ? undefined
              : 'Enter a valid email address.'
        const passwordError = !password
            ? 'Enter your password.'
            : isSignUp && password.length < MIN_PASSWORD
              ? `Use at least ${MIN_PASSWORD} characters.`
              : undefined
        // Only publishers are asked for a number, and only at sign-up: a tenant
        // has no reason to hand one over before they book anything.
        const phoneError =
            isSignUp && PHONE_REQUIRED_ROLES.includes(role)
                ? !phone.trim()
                    ? 'Enter a phone number so renters can reach you.'
                    : normalizePhone(phone)
                      ? undefined
                      : 'Enter a valid Somali phone number, e.g. 061 555 1234.'
                : undefined
        return { email: emailError, password: passwordError, phone: phoneError }
    }, [email, password, isSignUp, phone, role])

    const valid = !errors.email && !errors.password && !errors.phone

    // Switching mode re-validates against different rules, so a message left
    // over from the other mode would be stale.
    const switchMode = useCallback((next: Mode) => {
        setMode(next)
        setSubmitted(false)
        setResetAttempted(false)
        setFormError(null)
        setFormNotice(null)
    }, [])

    const submit = useCallback(async () => {
        setSubmitted(true)
        if (!valid || busy) return

        setBusy('email')
        setFormError(null)
        setFormNotice(null)
        try {
            if (isSignUp) {
                const { needsConfirmation } = await signUpWithEmail({
                    email,
                    password,
                    fullName,
                    role,
                })
                // The number is written after the account exists, because the
                // contact row's policy requires the caller to be the profile
                // owner. It is best-effort: a failed write must not make a
                // successful sign-up look broken, and the profile screen offers
                // the same field again.
                if (PHONE_REQUIRED_ROLES.includes(role) && phone.trim()) {
                    const normalized = normalizePhone(phone)
                    const { data: sessionData } = await supabase.auth.getSession()
                    const userId = sessionData.session?.user?.id
                    if (normalized && userId) {
                        await saveMyPhone(supabase, userId, normalized).catch((err) =>
                            captureError(err, 'signup-phone'),
                        )
                    }
                }
                // When confirmation is on, there is no session yet — the (root)
                // layout will not route anywhere, so say so explicitly.
                if (needsConfirmation) setSentTo(email.trim())
            } else {
                await signInWithEmail(email, password)
                // The (root) layout picks up the new session and routes onward.
            }
        } catch (error) {
            captureError(error, "sign-in-email")
            setFormError(describeAuthError(error))
        } finally {
            setBusy(null)
        }
    }, [valid, busy, isSignUp, email, password, fullName, role, phone])

    const resetPassword = useCallback(async () => {
        // Reset only needs the address, so it is gated on the email field
        // alone — and it must not mark the whole form submitted, or an empty
        // password field lights up with an error the reset never needed.
        setResetAttempted(true)
        if (errors.email || busy) return

        setBusy('reset')
        setFormError(null)
        setFormNotice(null)
        try {
            await sendPasswordReset(email)
            setFormNotice(
                `If ${email.trim()} has an account, a password reset link is on its way.`,
            )
        } catch (error) {
            captureError(error, "password-reset")
            setFormError(describeAuthError(error))
        } finally {
            setBusy(null)
        }
    }, [errors.email, busy, email])

    const handleGoogle = useCallback(async () => {
        if (busy) return
        setBusy('google')
        try {
            // Runs the Google OAuth flow against Supabase's built-in auth.
            await signInWithGoogle()
        } catch (error) {
            captureError(error, "sign-in-google")
            setFormError(describeAuthError(error))
        } finally {
            setBusy(null)
        }
    }, [busy])

    if (isSignedIn) return <Redirect href={safeReturnTo ?? '/'} />

    return (
        <View className="flex-1 bg-surface dark:bg-surface-dark">
            {/* Back to where the user came from — the screen has no header,
                so without this a signed-out visitor who tapped Profile (or
                "Sign in to book") had no way out except the system back key,
                which exits the app when sign-in replaced the stack. */}
            <View
                style={{
                    position: 'absolute',
                    top: insets.top + 12,
                    left: gutter,
                    zIndex: 10,
                }}
            >
                <Touchable
                    onPress={handleBack}
                    accessibilityLabel="Go back"
                    accessibilityHint="Returns to the page you were on before sign-in"
                    style={{
                        width: 44,
                        height: 44,
                        borderRadius: 22,
                        backgroundColor: 'rgba(0,0,0,0.45)',
                        alignItems: 'center',
                        justifyContent: 'center',
                    }}
                >
                    <Image
                        source={icons.backArrow}
                        style={{ width: 20, height: 20, tintColor: '#FFFFFF' }}
                        accessible={false}
                    />
                </Touchable>
            </View>
            <KeyboardAvoidingView
                behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                className="flex-1"
            >
                <ScrollView
                    contentContainerStyle={{ flexGrow: 1 }}
                    showsVerticalScrollIndicator={false}
                    keyboardShouldPersistTaps="handled"
                    bounces={false}
                >
                    {/* Keep the hero proportional without pushing auth controls below the fold. */}
                    <ImageBackground
                        source={images.onboarding}
                        // Explicit width: `w-full` resolves to a percentage the
                        // web build does not apply to the image element itself.
                        style={{ height: authHeroHeight, width: '100%' }}
                        resizeMode="cover"
                        accessible={false}
                    >
                        <View className="flex-1 bg-black/10" />
                    </ImageBackground>

                    <SafeAreaView edges={['bottom']} className="flex-1">
                        <View
                            style={{
                                paddingHorizontal: gutter,
                                width: '100%',
                                maxWidth: 520,
                                alignSelf: 'center',
                            }}
                            className="flex-1 -mt-xl rounded-t-2xl bg-surface dark:bg-surface-dark pt-xl pb-lg"
                        >
                            {sentTo ? (
                                <View>
                                    <Text
                                        accessibilityRole="header"
                                        className={`${isAtLeast('tablet') ? 'text-display' : 'text-h1'} font-rubik-extrabold text-black-300 dark:text-white text-center`}
                                    >
                                        Check your inbox
                                    </Text>
                                    <Text className="text-body font-rubik text-black-200 dark:text-white/60 text-center mt-md">
                                        We sent a confirmation link to{' '}
                                        <Text className="font-rubik-semibold text-black-300 dark:text-white">
                                            {sentTo}
                                        </Text>
                                        . Open it to finish setting up your account, then come back
                                        and sign in.
                                    </Text>
                                    <Touchable
                                        onPress={() => {
                                            setSentTo(null)
                                            switchMode('signin')
                                            setPassword('')
                                        }}
                                        accessibilityLabel="Back to sign in"
                                        className="items-center justify-center rounded-full bg-primary-300 py-md"
                                        style={{ minHeight: 56, marginTop: SPACE.xl }}
                                    >
                                        <Text className="text-body font-rubik-semibold text-white">
                                            Back to sign in
                                        </Text>
                                    </Touchable>
                                </View>
                            ) : (
                                <>
                                    <Text className="text-caption text-center uppercase font-rubik-medium text-black-200 dark:text-white/50">
                                        Welcome to ReState
                                    </Text>

                                    <Text
                                        accessibilityRole="header"
                                        className={`${isAtLeast('tablet') ? 'text-display' : 'text-h1'} font-rubik-extrabold text-black-300 dark:text-white text-center mt-sm`}
                                    >
                                        {isSignUp ? (
                                            <>
                                                Create your{' \n'}
                                                <Text className="text-primary-300">
                                                    ReState account
                                                </Text>
                                            </>
                                        ) : (
                                            <>
                                                Let&apos;s get you closer to{' \n'}
                                                <Text className="text-primary-300">
                                                    your ideal home
                                                </Text>
                                            </>
                                        )}
                                    </Text>

                                    {/* Mode switch. Both options stay visible so the
                                        alternative is discoverable without a tap. */}
                                    <View
                                        accessibilityRole="tablist"
                                        className="flex-row gap-2xs p-2xs mt-lg rounded-full bg-surface-muted dark:bg-surface-dark-muted"
                                    >
                                        {(
                                            [
                                                ['signin', 'Sign in'],
                                                ['signup', 'Create account'],
                                            ] as const
                                        ).map(([value, label]) => (
                                            <Touchable
                                                key={value}
                                                onPress={() => switchMode(value)}
                                                accessibilityRole="tab"
                                                accessibilityLabel={label}
                                                accessibilityState={{ selected: mode === value }}
                                                // Width belongs to the outer
                                                // Pressable; the inner view
                                                // paints the pill and fills it.
                                                style={{ flex: 1, minHeight: 44 }}
                                                className={`items-center justify-center rounded-full ${
                                                    mode === value
                                                        ? 'bg-surface dark:bg-surface-dark-elevated'
                                                        : ''
                                                }`}
                                            >
                                                <Text
                                                    className={`text-caption ${
                                                        mode === value
                                                            ? 'font-rubik-bold text-black-300 dark:text-white'
                                                            : 'font-rubik-medium text-black-200 dark:text-white/60'
                                                    }`}
                                                >
                                                    {label}
                                                </Text>
                                            </Touchable>
                                        ))}
                                    </View>

                                    {/* Role is chosen here or not at all: RLS
                                        stops a user editing their own `role`
                                        afterwards, so sign-up is the only
                                        self-service path to publishing. */}
                                    {isSignUp ? (
                                        // tablist/tab rather than
                                        // radiogroup/radio: `Touchable` only
                                        // accepts button, link or tab, and tab
                                        // is the one that carries the
                                        // selected-one-of-many semantics the
                                        // mode switch above already relies on.
                                        <View
                                            accessibilityRole="tablist"
                                            accessibilityLabel="Account type"
                                            className="mt-md"
                                        >
                                            <Text className="text-caption font-rubik-medium text-black-200 dark:text-white/60 mb-2xs">
                                                Account type
                                            </Text>
                                            {ROLES.map(({ value, label, hint }) => {
                                                const selected = role === value
                                                return (
                                                    <Touchable
                                                        key={value}
                                                        onPress={() => setRole(value)}
                                                        accessibilityRole="tab"
                                                        accessibilityLabel={label}
                                                        accessibilityHint={hint}
                                                        accessibilityState={{ selected }}
                                                        // Label plus hint already
                                                        // clears 44px, so the card
                                                        // needs spacing only.
                                                        style={{ marginTop: SPACE.xs }}
                                                        className={`justify-center rounded-lg border px-md py-sm ${
                                                            selected
                                                                ? 'border-primary-300 bg-primary-100'
                                                                : 'border-line dark:border-line-dark'
                                                        }`}
                                                    >
                                                        <Text
                                                            className={`text-body ${
                                                                selected
                                                                    ? 'font-rubik-semibold text-primary-300'
                                                                    : 'font-rubik-medium text-black-300 dark:text-white'
                                                            }`}
                                                        >
                                                            {label}
                                                        </Text>
                                                        <Text className="text-caption font-rubik text-black-100 dark:text-white/40 mt-2xs">
                                                            {hint}
                                                        </Text>
                                                    </Touchable>
                                                )
                                            })}
                                        </View>
                                    ) : null}

                                    {isSignUp ? (
                                        <Field
                                            label="Full name"
                                            value={fullName}
                                            onChangeText={setFullName}
                                            placeholder="Alex Morgan"
                                            autoCapitalize="words"
                                            autoComplete="name"
                                            textContentType="name"
                                            returnKeyType="next"
                                            hint="Optional — shown on your profile."
                                        />
                                    ) : null}

                                    {/* Publishers must be reachable. The number
                                        is stored in profile_contacts, which no
                                        other user can read — see migration
                                        0024. */}
                                    {isSignUp && PHONE_REQUIRED_ROLES.includes(role) ? (
                                        <Field
                                            label="Phone number"
                                            value={phone}
                                            onChangeText={setPhone}
                                            error={submitted ? errors.phone : undefined}
                                            placeholder="061 555 1234"
                                            keyboardType="phone-pad"
                                            autoComplete="tel"
                                            textContentType="telephoneNumber"
                                            returnKeyType="next"
                                            hint="Required for publisher accounts. Renters never see it — only the platform can reach you."
                                        />
                                    ) : null}

                                    <Field
                                        label="Email"
                                        value={email}
                                        onChangeText={setEmail}
                                        error={submitted || resetAttempted ? errors.email : undefined}
                                        placeholder="you@example.com"
                                        keyboardType="email-address"
                                        autoCapitalize="none"
                                        autoCorrect={false}
                                        autoComplete="email"
                                        textContentType="emailAddress"
                                        returnKeyType="next"
                                        onSubmitEditing={() => passwordRef.current?.focus()}
                                    />

                                    <Field
                                        ref={passwordRef}
                                        label="Password"
                                        value={password}
                                        onChangeText={setPassword}
                                        error={submitted ? errors.password : undefined}
                                        hint={
                                            isSignUp
                                                ? `At least ${MIN_PASSWORD} characters.`
                                                : undefined
                                        }
                                        placeholder="••••••••"
                                        secureTextEntry
                                        autoCapitalize="none"
                                        autoComplete={isSignUp ? 'new-password' : 'current-password'}
                                        textContentType={isSignUp ? 'newPassword' : 'password'}
                                        returnKeyType="go"
                                        onSubmitEditing={() => void submit()}
                                    />

                                    {!isSignUp ? (
                                        <Touchable
                                            onPress={() => void resetPassword()}
                                            disabled={!!busy}
                                            accessibilityRole="link"
                                            accessibilityLabel="Forgot your password"
                                            accessibilityHint="Emails you a password reset link"
                                            // `self-end` on the inner view left
                                            // the outer Pressable full-width, so
                                            // the whole blank strip beside the
                                            // link was tappable. Align the
                                            // outer instead.
                                            className="justify-center py-2xs"
                                            style={{
                                                minHeight: 44,
                                                marginTop: SPACE.xs,
                                                alignSelf: 'flex-end',
                                            }}
                                        >
                                            <Text className="text-caption font-rubik-medium text-primary-300">
                                                {busy === 'reset'
                                                    ? 'Sending…'
                                                    : 'Forgot password?'}
                                            </Text>
                                        </Touchable>
                                    ) : null}

                                    {formError ? (
                                        <View
                                            accessibilityRole="alert"
                                            className="rounded-lg border border-danger bg-danger/10 p-md mt-md"
                                        >
                                            <Text className="text-caption font-rubik-medium text-danger">
                                                {formError}
                                            </Text>
                                        </View>
                                    ) : null}

                                    {formNotice ? (
                                        <View
                                            accessibilityLiveRegion="polite"
                                            className="rounded-lg border border-primary-200 bg-primary-100 p-md mt-md"
                                        >
                                            <Text className="text-caption font-rubik-medium text-primary-300">
                                                {formNotice}
                                            </Text>
                                        </View>
                                    ) : null}

                                    <Touchable
                                        onPress={() => void submit()}
                                        disabled={!!busy}
                                        accessibilityLabel={
                                            isSignUp ? 'Create account' : 'Sign in'
                                        }
                                        accessibilityState={{
                                            disabled: !!busy,
                                            busy: busy === 'email',
                                        }}
                                        className="items-center justify-center rounded-full bg-primary-300 py-md"
                                        style={{ minHeight: 56, marginTop: SPACE.lg }}
                                    >
                                        {busy === 'email' ? (
                                            <ActivityIndicator size="small" color="#FFFFFF" />
                                        ) : (
                                            <Text className="text-body font-rubik-semibold text-white">
                                                {isSignUp ? 'Create account' : 'Sign in'}
                                            </Text>
                                        )}
                                    </Touchable>

                                    <View className="flex-row items-center gap-sm mt-lg">
                                        <View className="flex-1 h-px bg-line dark:bg-line-dark" />
                                        <Text className="text-caption font-rubik text-black-100 dark:text-white/40">
                                            or
                                        </Text>
                                        <View className="flex-1 h-px bg-line dark:bg-line-dark" />
                                    </View>

                                    <Touchable
                                        onPress={() => void handleGoogle()}
                                        disabled={!!busy}
                                        accessibilityLabel="Continue with Google"
                                        accessibilityHint="Signs you in to ReState using your Google account"
                                        accessibilityState={{
                                            disabled: !!busy,
                                            busy: busy === 'google',
                                        }}
                                        className="flex-row items-center justify-center gap-sm rounded-full bg-surface dark:bg-surface-dark-elevated border border-line dark:border-line-dark py-md"
                                        style={{
                                            minHeight: 56,
                                            marginTop: SPACE.lg,
                                            ...shadow({ opacity: 0.12, radius: 16, offsetY: 8, elevation: 3 }),
                                        }}
                                    >
                                        {busy === 'google' ? (
                                            <ActivityIndicator size="small" color="#0061FF" />
                                        ) : (
                                            <>
                                                <Image
                                                    source={icons.google}
                                                    // Sized through `style`, not
                                                    // a class: on web
                                                    // react-native-web injects an
                                                    // atomic class carrying the
                                                    // asset's intrinsic size at
                                                    // equal specificity but later
                                                    // in the sheet, so `size-5`
                                                    // lost and the logo rendered
                                                    // at 44x45.
                                                    style={{ width: 20, height: 20 }}
                                                    resizeMode="contain"
                                                    accessible={false}
                                                    alt=""
                                                />
                                                <Text className="text-body font-rubik-semibold text-black-300 dark:text-white">
                                                    Continue with Google
                                                </Text>
                                            </>
                                        )}
                                    </Touchable>

                                    <Text className="text-caption font-rubik text-black-100 dark:text-white/40 text-center mt-md">
                                        By continuing you agree to our Terms and Privacy Policy.
                                    </Text>
                                </>
                            )}
                        </View>
                    </SafeAreaView>
                </ScrollView>
            </KeyboardAvoidingView>
        </View>
    )
}

export default SignIn
