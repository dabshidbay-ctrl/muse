import { useEffect, useRef } from "react";
import {
  Animated,
  Image,
  Pressable,
  Text,
  View,
  type ImageSourcePropType,
  type ViewStyle,
} from "react-native";
import { cssInterop } from "nativewind";
import { router } from "expo-router";
import { MIN_TAP, MOTION, useReducedMotion } from "@/lib/responsive";
import icons from "@/constants/icons";

/**
 * NativeWind only understands `className` on components it knows about.
 * Animated.View is not one of them, so without this registration every
 * className passed to an Animated.View below is silently dropped.
 */
cssInterop(Animated.View, { className: "style" });

/* ------------------------------------------------------------------ Pressable
 * Press feedback via opacity/scale only — never layout bounds, so surrounding
 * content cannot jitter (pro-rules: "Stable Interaction States").
 */
export function Touchable({
  children,
  onPress,
  stopPropagation = false,
  disabled,
  className = "",
  style,
  accessibilityLabel,
  accessibilityHint,
  accessibilityRole = "button",
  accessibilityState,
}: {
  children: React.ReactNode;
  onPress?: () => void;
  stopPropagation?: boolean;
  disabled?: boolean;
  className?: string;
  style?: ViewStyle;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  accessibilityRole?: "button" | "link" | "tab";
  accessibilityState?: { selected?: boolean; disabled?: boolean; busy?: boolean; expanded?: boolean };
}) {
  const reduced = useReducedMotion();
  const isDisabled = disabled || !onPress || !!accessibilityState?.disabled;
  const scale = useRef(new Animated.Value(1)).current;

  const to = (v: number) => {
    if (reduced) return;
    Animated.timing(scale, {
      toValue: v,
      duration: MOTION.micro,
      useNativeDriver: true,
    }).start();
  };

  return (
    <Pressable
      onPress={
        onPress
          ? (event) => {
              if (stopPropagation) event.stopPropagation();
              onPress();
            }
          : undefined
      }
      disabled={isDisabled}
      onPressIn={() => to(0.97)}
      onPressOut={() => to(1)}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ ...accessibilityState, disabled: isDisabled }}
      style={({ pressed }) => [
        style,
        {
          minHeight: Math.max(
            MIN_TAP,
            typeof style?.minHeight === "number" ? style.minHeight : 0
          ),
          opacity: isDisabled ? 0.5 : pressed ? 0.9 : 1,
        },
      ]}
    >
      {/* `style` sizes the Pressable, but `className` paints this inner view —
          so without stretching/growing, a `minHeight` tap target wraps a pill
          that has collapsed to its content height (the "sliver button"). Fill
          the Pressable so the painted box and the hit area are the same box.
          Call sites therefore keep sizing in `style` and paint in `className`;
          `flex-1`/`w-full` on the className is redundant and must not be added
          back — a `flex-basis: 0` here would collapse the height instead. */}
      <Animated.View
        style={{ alignSelf: "stretch", flexGrow: 1, transform: [{ scale }] }}
        className={className}
      >
        {children}
      </Animated.View>
    </Pressable>
  );
}

/* ---------------------------------------------------------------- Icon button
 * Small glyph, but the hit area is padded up to the platform minimum.
 */
export function IconButton({
  icon,
  label,
  onPress,
  disabled,
  hint,
  tintColor,
  transparent = false,
  className = "",
}: {
  icon: ImageSourcePropType;
  label: string;
  onPress?: () => void;
  /** Renders non-interactive and announces as disabled. */
  disabled?: boolean;
  hint?: string;
  /** Optional tint for the icon image. Passed to Image's tintColor prop. */
  tintColor?: string;
  /** Transparent background, for buttons sitting directly on a photo: the
      glyph alone, no disc behind it. A className bg would fight the base
      bg-surface/90 in the generated sheet, so this omits the base instead. */
  transparent?: boolean;
  /**
   * Painted on the inner view. Hover styling is a CSS class here (see
   * `hover-heart` / `hover-share` in app/global.css) rather than React state:
   * react-native-web does not forward `onHoverIn` in this version, so a
   * state-driven hover never fires.
   */
  className?: string;
}) {
  return (
    <Touchable
      onPress={onPress}
      disabled={disabled || !onPress}
      accessibilityLabel={label}
      accessibilityHint={hint}
      stopPropagation
      style={{ minWidth: MIN_TAP, minHeight: MIN_TAP }}
      className={`items-center justify-center rounded-full ${transparent ? "bg-transparent" : "bg-surface/90 dark:bg-surface-dark-elevated"} ${className}`}
    >
      <Image
        source={icon}
        tintColor={tintColor}
        style={{ width: 20, height: 20 }}
        accessible={false}
        alt=""
      />
    </Touchable>
  );
}

/* ------------------------------------------------------------------ Back nav
 * `router.back()` is a silent no-op when the current screen is the first entry
 * in the stack — which is the normal case for a deep link, a shared URL, a cold
 * web load, and anything reached via `router.replace()`. The button is still
 * painted, so the user taps a control that does nothing at all. Every back
 * affordance therefore goes through here and lands on a real parent route.
 */

/** The href shape `router.replace` accepts; expo-router does not export `Href`. */
export type BackFallback = Parameters<typeof router.replace>[0];

export function goBack(fallback: BackFallback) {
  if (router.canGoBack()) {
    router.back();
    return;
  }
  // `replace`, not `push`: the fallback stands in for history that never
  // existed, so it must not grow a stack the user then has to unwind.
  router.replace(fallback);
}

/**
 * The standard screen-header back control. `fallback` is the parent this screen
 * belongs under — not always home: a listing's edit screen belongs under the
 * listings screen.
 */
export function BackButton({
  fallback,
  label = "Go back",
  hint,
  className = "",
}: {
  fallback: BackFallback;
  label?: string;
  hint?: string;
  className?: string;
}) {
  return (
    <IconButton
      icon={icons.backArrow}
      label={label}
      hint={hint}
      onPress={() => goBack(fallback)}
      className={className}
    />
  );
}

/* --------------------------------------------------------------------- Chip */
export function Chip({
  label,
  selected,
  onPress,
  /** What the chip does, for the accessible name. Chips are reused for
   *  filtering, property type, and facilities, so this must be explicit. */
  purpose = "Filter by",
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  purpose?: string;
}) {
  return (
    <Touchable
      onPress={onPress}
      // `selected` is not surfaced for the button role, so the state has to be
      // part of the accessible name or it is conveyed by colour alone.
      accessibilityLabel={`${purpose} ${label}${selected ? ", selected" : ""}`}
      accessibilityState={{ selected }}
      style={{ minHeight: MIN_TAP }}
      className={`items-center justify-center rounded-full px-lg py-sm border ${
        selected
          ? "bg-primary-300 border-primary-300"
          : "bg-surface dark:bg-surface-dark-muted border-line dark:border-line-dark"
      }`}
    >
      <Text
        className={`text-caption ${
          selected
            ? "font-rubik-semibold text-white"
            : "font-rubik-medium text-black-200 dark:text-white/70"
        }`}
      >
        {label}
      </Text>
    </Touchable>
  );
}

/* ------------------------------------------------------------------ Skeleton
 * Reserves the final layout box while loading, so nothing shifts when data
 * lands (UX priority 3: reserve space / CLS).
 */
export function Skeleton({ className = "", style }: { className?: string; style?: ViewStyle }) {
  const reduced = useReducedMotion();
  const pulse = useRef(new Animated.Value(0.5)).current;

  useEffect(() => {
    if (reduced) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.5, duration: 700, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, reduced]);

  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[{ opacity: reduced ? 0.6 : pulse }, style]}
      className={`bg-surface-sunken dark:bg-surface-dark-elevated rounded-md ${className}`}
    />
  );
}

/* ---------------------------------------------------------------- Fade-in-up
 * The design system's "stagger list" motion, honouring reduced-motion.
 */
export function FadeInUp({
  children,
  index = 0,
  className = "",
}: {
  children: React.ReactNode;
  index?: number;
  className?: string;
}) {
  const reduced = useReducedMotion();
  const v = useRef(new Animated.Value(reduced ? 1 : 0)).current;

  useEffect(() => {
    if (reduced) {
      v.setValue(1);
      return;
    }
    Animated.timing(v, {
      toValue: 1,
      duration: MOTION.medium,
      delay: Math.min(index, 8) * 60,
      useNativeDriver: true,
    }).start();
  }, [v, index, reduced]);

  return (
    <Animated.View
      className={className}
      style={{
        opacity: v,
        transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }],
      }}
    >
      {children}
    </Animated.View>
  );
}

/* ------------------------------------------------------------- Section header */
export function SectionHeader({
  title,
  actionLabel,
  onAction,
}: {
  title: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <View className="flex-row items-center justify-between mt-xl mb-sm">
      <Text
        accessibilityRole="header"
        className="text-h3 font-rubik-bold text-black-300 dark:text-white"
      >
        {title}
      </Text>
      {actionLabel ? (
        <Touchable
          onPress={onAction}
          accessibilityLabel={actionLabel}
          // Short labels still need a full-size hit area.
          style={{ minHeight: MIN_TAP, minWidth: MIN_TAP, justifyContent: "center" }}
          className="items-center justify-center px-sm"
        >
          <Text className="text-caption font-rubik-semibold text-primary-300">{actionLabel}</Text>
        </Touchable>
      ) : null}
    </View>
  );
}

/* ---------------------------------------------------------------- EmptyState */
export function EmptyState({
  title,
  body,
  tone = "neutral",
}: {
  title: string;
  body?: string;
  tone?: "neutral" | "error";
}) {
  return (
    <View className="items-center px-lg py-2xl" accessibilityRole="summary">
      <View
        className={`size-14 rounded-full items-center justify-center mb-md ${
          tone === "error" ? "bg-danger/10" : "bg-primary-100"
        }`}
      >
        <Text className={`text-h2 ${tone === "error" ? "text-danger" : "text-primary-300"}`}>
          {tone === "error" ? "!" : "·"}
        </Text>
      </View>
      <Text className="text-lead font-rubik-semibold text-black-300 dark:text-white text-center">
        {title}
      </Text>
      {body ? (
        <Text className="text-body font-rubik text-black-200 dark:text-white/60 text-center mt-2xs max-w-[420px]">
          {body}
        </Text>
      ) : null}
    </View>
  );
}
