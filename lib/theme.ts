import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import { colorScheme } from "nativewind";

/**
 * Appearance: light only, by decision.
 *
 * `tailwind.config.js` sets `darkMode: "class"`, so NativeWind only applies
 * `dark:` styles when the scheme is set to dark. This module now never sets
 * dark: every entry point pins light, and any theme choice a previous build
 * stored is cleared on startup, so a device in dark mode still gets the light
 * app. The exports keep their old shapes so existing callers do not break.
 */
export type ThemeMode = "system" | "light" | "dark";

const STORAGE_KEY = "restate.theme";

export const THEME_OPTIONS: { value: ThemeMode; label: string; hint: string }[] = [
  { value: "light", label: "Light", hint: "Always light" },
];

/** Light only: no mode, system or otherwise, ever resolves to dark. */
function resolveScheme(_mode: ThemeMode): "light" {
  return "light";
}

/** Pushes light into NativeWind. */
export function applyTheme(_mode: ThemeMode) {
  // Only the web prerender pass (Node, no window) must skip: the setter
  // throws outright there.
  if (Platform.OS === "web" && typeof globalThis.window === "undefined") return;
  colorScheme.set(resolveScheme("light"));
}

/**
 * Applies light as early as possible.
 *
 * Called from the root layout before render rather than from an effect, so
 * there is no one-frame flash of the wrong theme on startup. Any theme a
 * previous build stored is removed, so it cannot come back.
 */
export async function loadSavedTheme(): Promise<ThemeMode> {
  if (Platform.OS === "web" && typeof globalThis.window === "undefined") return "light";

  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch {
    // A failed clear is not worth blocking startup over.
  }
  applyTheme("light");
  return "light";
}

export type UseTheme = {
  /** Always "light" now; kept for callers that read it. */
  mode: ThemeMode;
  /** Always "light" now. */
  scheme: "light";
  /** No-op now: there is no other theme to switch to. */
  setMode: (next: ThemeMode) => void;
  /** Always false now: there is nothing to load. */
  loading: boolean;
};

export function useTheme(): UseTheme {
  return {
    mode: "light",
    scheme: "light",
    setMode: () => {},
    loading: false,
  };
}
