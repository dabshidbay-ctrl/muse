import React from "react";
import { StyleSheet } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { IconButton, Touchable } from "@/components/ui";

jest.mock("@/lib/responsive", () => ({
  MIN_TAP: 48,
  MOTION: { micro: 120 },
  useReducedMotion: () => true,
}));

jest.mock("@/constants/icons", () => new Proxy({}, { get: () => ({ uri: "icon" }) }));

describe("shared button controls", () => {
  let renderer: ReactTestRenderer;

  afterEach(() => {
    act(() => renderer?.unmount());
  });

  it("enforces the platform tap target even when a caller requests a smaller one", () => {
    act(() => {
      renderer = create(
        <Touchable
          onPress={() => {}}
          accessibilityLabel="Test button"
          style={{ minHeight: 32 }}
        >
          <></>
        </Touchable>
      );
    });

    const pressable = renderer.root.find(
      (instance) => typeof instance.type !== "string" && instance.type.name === "Pressable"
    );
    const style = pressable.props.style;

    expect(StyleSheet.flatten(style({ pressed: false })).minHeight).toBe(48);
  });

  it("disables controls consistently when their accessibility state is disabled", () => {
    act(() => {
      renderer = create(
        <Touchable
          onPress={() => {}}
          accessibilityLabel="Disabled button"
          accessibilityState={{ disabled: true }}
        >
          <></>
        </Touchable>
      );
    });

    const pressable = renderer.root.find(
      (instance) => typeof instance.type !== "string" && instance.type.name === "Pressable"
    );

    expect(pressable.props.disabled).toBe(true);
    expect(pressable.props.accessibilityState.disabled).toBe(true);
  });

  it("prevents icon actions from also triggering an enclosing card", () => {
    const parentPress = jest.fn();
    const iconPress = jest.fn();
    const stopPropagation = jest.fn();

    act(() => {
      renderer = create(
        <Touchable onPress={parentPress}>
          <IconButton icon={{ uri: "icon" }} label="Save property" onPress={iconPress} />
        </Touchable>
      );
    });

    const pressables = renderer.root.findAll(
      (instance) => typeof instance.type !== "string" && instance.type.name === "Pressable"
    );
    const nestedIcon = pressables[1];

    act(() => nestedIcon.props.onPress({ stopPropagation }));

    expect(stopPropagation).toHaveBeenCalledTimes(1);
    expect(iconPress).toHaveBeenCalledTimes(1);
    expect(parentPress).not.toHaveBeenCalled();
  });
});
