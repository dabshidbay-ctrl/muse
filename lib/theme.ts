import { useCallback, useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Appearance } from "react-native";
import { colorScheme, useColorScheme } from "nativewind";
import { captureError } from "./sentry";

/**
 * Appearance.
 *
 * `tailwind.config.js` sets `darkMode: "class"`, which means NativeWind only
 * applies `dark:` styles when something tells it the active scheme. Nothing
 * ever did, so every `dark:` class in the app was inert on web (native quietly
 * followed the OS through its own default). Calling `colorScheme.set` is what
 * makes the whole dark palette real on both platforms.
 */
export type ThemeMode = "system" | "light" | "dark";

const STORAGE_KEY = "restate.theme";

export const THEME_OPTIONS: { value: ThemeMode; label: string; hint: string }[] = [
  { value: "system", label: "System", hint: "Follow your device setting" },
  { value: "light", label: "Light", hint: "Always light" },
  { value: "dark", label: "Dark", hint: "Always dark" },
];

function isMode(v: unknown): v is ThemeMode {
  return v === "system" || v === "light" || v === "dark";
}

/**
 * Resolves "system" to a concrete scheme.
 *
 * This has to happen here rather than being handed to NativeWind, because with
 * `darkMode: "class"` its web setter only ever adds the class for the literal
 * value "dark" and removes it for everything else — "system" included. Passing
 * "system" through therefore pinned web to light no matter what the OS said.
 */
function resolveScheme(mode: ThemeMode): "light" | "dark" {
  if (mode !== "system") return mode;
  return Appearance.getColorScheme() === "dark" ? "dark" : "light";
}

/** Pushes a mode into NativeWind, resolving "system" first. */
export function applyTheme(mode: ThemeMode) {
  // No DOM during the web prerender pass; the setter throws outright there.
  if (!globalThis.window) return;
  colorScheme.set(resolveScheme(mode));
}

/**
 * Applies the saved choice as early as possible.
 *
 * Called from the root layout before render rather than from an effect: a
 * one-frame flash of the wrong theme is the most visible bug an appearance
 * setting can have, and on web it means a white flash on a dark device.
 * `colorScheme.set` is safe outside React — it is NativeWind's imperative
 * handle on the same store the hook reads.
 */
export async function loadSavedTheme(): Promise<ThemeMode> {
  // `expo export --platform web` prerenders every route in Node, where
  // react-native-css-interop's setter throws outright ("Cannot manually set
  // color scheme while not in a browser environment"). React Native defines
  // `window`, so this only skips the server pass; the browser applies the
  // theme on hydration.
  if (!globalThis.window) return "system";

  try {
    const saved = await AsyncStorage.getItem(STORAGE_KEY);
    if (isMode(saved)) {
      applyTheme(saved);
      return saved;
    }
  } catch (err) {
    // A failed read is not worth blocking startup: fall through to "system",
    // which is what a first-run user gets anyway.
    captureError(err, "theme-load");
  }
  applyTheme("system");
  return "system";
}

export type UseTheme = {
  /** What the user chose — "system" included, which `scheme` never is. */
  mode: ThemeMode;
  /** What is actually being displayed right now. */
  scheme: "light" | "dark";
  setMode: (next: ThemeMode) => void;
  /** True until the saved choice has been read back. */
  loading: boolean;
};

export function useTheme(): UseTheme {
  const { colorScheme: active } = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>("system");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(STORAGE_KEY)
      .then((saved) => {
        if (!alive) return;
        if (isMode(saved)) {
          setModeState(saved);
          applyTheme(saved);
        }
      })
      .catch((err) => captureError(err, "theme-load"))
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  // While the user is on "System", the OS can change under us (a device on a
  // sunset schedule). Without this the app keeps whatever scheme was current
  // when it launched.
  useEffect(() => {
    if (mode !== "system") return;
    const sub = Appearance.addChangeListener(() => applyTheme("system"));
    return () => sub.remove();
  }, [mode]);

  const setMode = useCallback(
    (next: ThemeMode) => {
      // Applied first, persisted second: the switch must feel instant, and a
      // storage failure should not stop the theme from changing for this
      // session.
      setModeState(next);
      applyTheme(next);
      AsyncStorage.setItem(STORAGE_KEY, next).catch((err) =>
        captureError(err, "theme-save")
      );
    },
    []
  );

  return {
    mode,
    // `colorScheme` resolves "system" to the concrete scheme; it can be
    // undefined for a frame before the store initialises.
    scheme: active === "dark" ? "dark" : "light",
    setMode,
    loading,
  };
}
