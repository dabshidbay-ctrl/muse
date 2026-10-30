import { useWindowDimensions, AccessibilityInfo, Platform } from "react-native";
import { useEffect, useMemo, useState } from "react";

/**
 * Device classes. Mobile-first: every value below is the *floor* for that class,
 * so styles start at `phone` and scale up (UX rule: mobile-first breakpoints).
 */
export type DeviceClass = "phone" | "phoneLg" | "tablet" | "desktop";

export const BREAKPOINTS: Record<DeviceClass, number> = {
  phone: 0,      // 320-389   (iPhone SE)
  phoneLg: 390,  // 390-767   (iPhone 15 / Pixel)
  tablet: 768,   // 768-1023  (iPad portrait)
  desktop: 1024, // 1024+     (iPad landscape / web)
};

export type Responsive = {
  width: number;
  height: number;
  device: DeviceClass;
  isLandscape: boolean;
  /** Grid columns for property cards. */
  columns: number;
  /** Horizontal page inset — widens on bigger screens (pro-rules: adaptive gutters). */
  gutter: number;
  /** Cap on long-form text width so paragraphs stay readable on tablets. */
  maxContentWidth: number;
  /** Height of the hero/cover image, proportional rather than fixed px. */
  heroHeight: number;
  isAtLeast: (c: DeviceClass) => boolean;
};

export function useResponsive(): Responsive {
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;

  return useMemo(() => {
    const device: DeviceClass =
      width >= BREAKPOINTS.desktop ? "desktop"
      : width >= BREAKPOINTS.tablet ? "tablet"
      : width >= BREAKPOINTS.phoneLg ? "phoneLg"
      : "phone";

    // More columns as width allows, so cards never stretch into unusable slabs.
    const columns =
      device === "desktop" ? (isLandscape ? 4 : 3)
      : device === "tablet" ? 3
      : isLandscape ? 3
      : 2;

    const gutter =
      device === "desktop" ? 32 : device === "tablet" ? 24 : 20;

    return {
      width,
      height,
      device,
      isLandscape,
      columns,
      gutter,
      maxContentWidth: device === "desktop" ? 1120 : device === "tablet" ? 840 : width,
      // Shorter hero in landscape so the fold still shows content beneath it.
      heroHeight: Math.round(isLandscape ? height * 0.55 : Math.min(height * 0.42, 420)),
      isAtLeast: (c: DeviceClass) => width >= BREAKPOINTS[c],
    };
  }, [width, height, isLandscape]);
}

/**
 * Honours the OS "reduce motion" setting so animations can be skipped.
 * Required by the pre-delivery checklist.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled?.()
      .then((v) => alive && setReduced(!!v))
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener?.("reduceMotionChanged", (v) =>
      setReduced(!!v)
    );
    return () => {
      alive = false;
      sub?.remove?.();
    };
  }, []);

  return reduced;
}

/**
 * Numeric mirror of the `spacing` scale in tailwind.config.js. Needed because a
 * margin must sit on a component's `style` (the outer box) rather than in its
 * `className` — a margin inside a Touchable's className lands on the *inner*
 * painted view, making blank space tappable. Keep in sync with the config.
 */
export const SPACE = {
  "2xs": 4,
  xs: 8,
  sm: 12,
  md: 16,
  lg: 24,
  xl: 32,
  "2xl": 48,
  "3xl": 64,
} as const;

/** Minimum tap target: 44pt iOS / 48dp Android (pro-rules: touch target minimum). */
export const MIN_TAP = Platform.OS === "android" ? 48 : 44;

/** Shared motion tokens — one scale, chosen by distance, not copy-pasted per view. */
export const MOTION = {
  micro: 120,   // press feedback
  short: 200,   // fades, chips
  medium: 320,  // card / list stagger
  long: 450,    // screen-level
} as const;

/**
 * Delays a rapidly-changing value. Used for the search box so a query is sent
 * once the user pauses, instead of one request per keystroke.
 */
export function useDebounced<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);

  return debounced;
}

/**
 * Cross-platform elevation.
 *
 * React Native Web deprecated the `shadow*` props in favour of CSS
 * `boxShadow`, and warns once per style object — which is why the console fills
 * up with "\"shadow*\" style props are deprecated". Native, meanwhile, still
 * needs `shadowColor`/`shadowOffset`/`shadowOpacity`/`shadowRadius` on iOS and
 * `elevation` on Android, so the props cannot simply be replaced.
 *
 * This returns whichever dialect the current platform actually wants. Pass the
 * colour as `rgba(...)` on web (boxShadow has no separate opacity channel);
 * `opacity` is folded into it here so call sites keep writing the two
 * separately.
 */
export function shadow({
  color = "#0061FF",
  opacity = 0.08,
  radius = 12,
  offsetX = 0,
  offsetY = 6,
  elevation = 3,
}: {
  color?: string;
  opacity?: number;
  radius?: number;
  offsetX?: number;
  offsetY?: number;
  elevation?: number;
} = {}) {
  if (Platform.OS === "web") {
    // #rrggbb -> rgba(), so the shadow keeps its intended transparency.
    const hex = color.replace("#", "");
    const full = hex.length === 3 ? hex.split("").map((c) => c + c).join("") : hex;
    const r = parseInt(full.slice(0, 2), 16);
    const g = parseInt(full.slice(2, 4), 16);
    const b = parseInt(full.slice(4, 6), 16);
    return {
      boxShadow: `${offsetX}px ${offsetY}px ${radius}px rgba(${r}, ${g}, ${b}, ${opacity})`,
    } as const;
  }

  return {
    shadowColor: color,
    shadowOpacity: opacity,
    shadowRadius: radius,
    shadowOffset: { width: offsetX, height: offsetY },
    elevation,
  } as const;
}
