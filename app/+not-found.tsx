import React from "react";
import { Stack, router, usePathname } from "expo-router";
import { Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { EmptyState, Touchable } from "@/components/ui";
import { MIN_TAP, useResponsive } from "@/lib/responsive";

/**
 * The screen expo-router falls back to for any unmatched URL.
 *
 * Without this file the router renders its own bare "Unmatched Route" page,
 * which is untranslated, unstyled and offers no way out other than the browser
 * back button. This one names the address that failed and always leaves a route
 * home; "Go back" is only offered when there is history to go back to, since a
 * deep link opened cold has none and a dead button is worse than no button.
 */
export default function NotFound() {
  const pathname = usePathname();
  const { gutter, maxContentWidth } = useResponsive();
  const canGoBack = router.canGoBack();

  return (
    <>
      {/* Sets the document title on web and the header title wherever the
          parent Stack shows one (the root Stack currently hides it). */}
      <Stack.Screen options={{ title: "Page not found" }} />

      <SafeAreaView className="flex-1 bg-surface-muted dark:bg-surface-dark" edges={["top"]}>
        <View
          style={{
            paddingHorizontal: gutter,
            width: "100%",
            maxWidth: maxContentWidth,
            alignSelf: "center",
          }}
          className="flex-1 justify-center"
        >
          <EmptyState
            title="This page doesn’t exist"
            body={
              pathname && pathname !== "/"
                ? `Nothing is published at ${pathname}. The link may be out of date, or the address may have a typo.`
                : "The link may be out of date, or the address may have a typo."
            }
          />

          {/* Margins live on the wrapper: a Touchable's className paints the
              inner view that must fill the tap target, so spacing there would
              inset the painted pill instead of the control. */}
          <View className="mt-md gap-sm px-lg items-center">
            <Touchable
              onPress={() => router.replace("/")}
              accessibilityLabel="Go to the home screen"
              style={{ minHeight: 52, minWidth: 200 }}
              className="items-center justify-center rounded-full bg-primary-300 px-xl"
            >
              <Text className="text-body font-rubik-bold text-white">Go home</Text>
            </Touchable>

            {canGoBack ? (
              <Touchable
                onPress={() => router.back()}
                accessibilityLabel="Go back to the previous screen"
                style={{ minHeight: MIN_TAP, minWidth: 200 }}
                className="items-center justify-center rounded-full border border-line dark:border-line-dark bg-surface dark:bg-surface-dark-muted px-xl"
              >
                <Text className="text-body font-rubik-semibold text-black-300 dark:text-white">
                  Go back
                </Text>
              </Touchable>
            ) : null}
          </View>
        </View>
      </SafeAreaView>
    </>
  );
}
