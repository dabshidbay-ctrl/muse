import React from "react";
import { Text, View } from "react-native";
import { MIN_TAP } from "@/lib/responsive";
import { Touchable } from "@/components/ui";

/**
 * A bounded integer chosen by tapping, not typing.
 *
 * Small counts (bedrooms, bathrooms, guests) are a selection problem: a free
 * text field lets someone submit "", "-2" or "3.5" and forces a keyboard over
 * the form on phones. Clamping here means the value is always valid by
 * construction, so the form no longer needs a per-field "whole number" error.
 */
export function Stepper({
  label,
  value,
  onChange,
  min = 0,
  max = 99,
  disabled,
  hint,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  disabled?: boolean;
  hint?: string;
}) {
  const clamp = (n: number) => Math.max(min, Math.min(max, n));
  const atMin = value <= min;
  const atMax = value >= max;

  const button = (
    glyph: string,
    delta: number,
    edge: boolean,
    accessibilityLabel: string
  ) => (
    <Touchable
      onPress={() => onChange(clamp(value + delta))}
      // At a bound the control is genuinely inert, so it must announce that
      // rather than look tappable and quietly do nothing.
      disabled={disabled || edge}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: disabled || edge }}
      style={{ minWidth: MIN_TAP, minHeight: MIN_TAP }}
      className="items-center justify-center rounded-full bg-surface dark:bg-surface-dark-elevated border border-line dark:border-line-dark"
    >
      <Text className="text-h3 font-rubik-medium text-black-300 dark:text-white">{glyph}</Text>
    </Touchable>
  );

  return (
    <View className="mt-md">
      <Text className="text-caption font-rubik-medium text-black-200 dark:text-white/60 mb-2xs">
        {label}
      </Text>
      <View className="flex-row items-center justify-between rounded-md border border-line dark:border-line-dark bg-surface-muted dark:bg-surface-dark-muted px-xs py-xs">
        {/* Minus sign U+2212, not a hyphen: the hyphen renders as a tiny dash
            that reads as a stray mark next to the full-size plus. */}
        {button("−", -1, atMin, `Decrease ${label.toLowerCase()}`)}
        <Text
          // The buttons carry the action; this carries the result, announced
          // on change so a screen reader user hears the new count.
          accessibilityLiveRegion="polite"
          accessibilityLabel={`${label}: ${value}`}
          className="text-h3 font-rubik-bold text-black-300 dark:text-white px-md"
        >
          {value}
        </Text>
        {button("+", 1, atMax, `Increase ${label.toLowerCase()}`)}
      </View>
      {hint ? (
        <Text className="text-caption font-rubik text-black-100 dark:text-white/40 mt-2xs">
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

export default Stepper;
