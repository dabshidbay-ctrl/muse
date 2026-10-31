import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  FlatList,
  Image,
  Text,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { IconButton, Skeleton } from "@/components/ui";
import icons from "@/constants/icons";
import { captureError } from "@/lib/sentry";
import { shadow } from "@/lib/responsive";

/** Beyond this, a dot row is an unreadable smear — fall back to "3 / 18". */
const MAX_DOTS = 8;

type SlideState = "loading" | "ready" | "failed";

type Natural = { width: number; height: number };

/**
 * How the photo is laid out inside the hero box.
 *
 * `contain`, not `cover`: a listing hero that crops is exactly the complaint
 * being reported — a cover fit on a portrait phone photo in a landscape hero
 * throws away the top and bottom of the building. The whole photo has to be
 * visible, so the fit letterboxes.
 *
 * The scale is also clamped at 1: a small source (an old listing, a scraped
 * thumbnail) is drawn at its own pixel size and centred rather than stretched
 * into a blurry hero. Losing some hero area is a far smaller defect than a soft
 * image, and the surrounding fill makes the smaller frame look deliberate.
 */
function fit(natural: Natural | null, boxWidth: number, boxHeight: number) {
  if (!natural || natural.width <= 0 || natural.height <= 0) {
    return { width: boxWidth, height: boxHeight };
  }
  const scale = Math.min(boxWidth / natural.width, boxHeight / natural.height, 1);
  return {
    width: Math.round(natural.width * scale),
    height: Math.round(natural.height * scale),
  };
}

function Slide({
  uri,
  width,
  height,
  index,
  total,
}: {
  uri: string;
  width: number;
  height: number;
  index: number;
  total: number;
}) {
  const [state, setState] = useState<SlideState>("loading");
  const [natural, setNatural] = useState<Natural | null>(null);

  // The intrinsic size decides both the letterbox geometry and whether the
  // photo would have to be upscaled, and neither is knowable from onLoad on
  // every platform, so it is measured up front.
  useEffect(() => {
    let alive = true;
    setState("loading");
    setNatural(null);
    Image.getSize(
      uri,
      (w, h) => {
        if (alive) setNatural({ width: w, height: h });
      },
      (err) => {
        // Not fatal: without a measurement the slide simply falls back to
        // filling the box, and a genuinely broken URL is caught by onError.
        if (alive) captureError(err, "gallery-image-size");
      }
    );
    return () => {
      alive = false;
    };
  }, [uri]);

  const box = fit(natural, width, height);
  const letterboxed = box.width < width - 1 || box.height < height - 1;

  return (
    <View
      style={{ width, height }}
      className="bg-surface-sunken dark:bg-surface-dark-elevated"
      // Each slide is one focusable stop, so swiping is not the only way to
      // reach photo 7 of 12 with a screen reader running.
      accessible
      accessibilityRole="image"
      accessibilityLabel={
        state === "failed"
          ? `Photo ${index + 1} of ${total}, could not be loaded`
          : `Photo ${index + 1} of ${total}`
      }
    >
      {state === "failed" ? (
        // A broken remote image otherwise leaves a hole the exact size of the
        // hero, which reads as a rendering bug rather than a missing photo.
        <View className="flex-1 items-center justify-center px-lg">
          <Text className="text-h2 text-black-100 dark:text-white/40">!</Text>
          <Text className="text-caption font-rubik-medium text-black-200 dark:text-white/60 text-center mt-2xs">
            Photo unavailable
          </Text>
        </View>
      ) : (
        <View className="flex-1 items-center justify-center">
          {/* The letterbox fill is the same photo, blown out and darkened, so
              the bars read as part of the picture instead of as dead grey
              space. Drawn only when there are bars to fill. */}
          {letterboxed ? (
            <View pointerEvents="none" className="absolute inset-0 overflow-hidden">
              <Image
                source={{ uri }}
                style={{ width, height }}
                resizeMode="cover"
                blurRadius={24}
                accessible={false}
                alt=""
              />
              <View className="absolute inset-0 bg-black/35" />
            </View>
          ) : null}

          {/* Sized inline, never with `size-*`: react-native-web emits atomic
              classes carrying the asset's intrinsic size at equal specificity
              but later in the sheet, so a Tailwind size class never wins. */}
          <Image
            source={{ uri }}
            style={{ width: box.width, height: box.height }}
            resizeMode="contain"
            accessible={false}
            alt=""
            onLoad={() => setState("ready")}
            onError={() => setState("failed")}
          />
          {state === "loading" ? (
            <View className="absolute inset-0">
              <Skeleton style={{ width, height }} className="rounded-none" />
            </View>
          ) : null}
        </View>
      )}
    </View>
  );
}

/**
 * Swipeable photo carousel. Built on FlatList rather than a carousel package:
 * paging, windowing and RTL are already handled there, and one more native
 * dependency would have to survive every Expo SDK bump.
 */
export function PropertyGallery({ images, height }: { images: string[]; height: number }) {
  const [width, setWidth] = useState(0);
  const [index, setIndex] = useState(0);
  const listRef = useRef<FlatList<string>>(null);

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    setWidth(Math.round(e.nativeEvent.layout.width));
  }, []);

  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (!width) return;
      const next = Math.round(e.nativeEvent.contentOffset.x / width);
      // Web has no momentum-end event on every browser, so the index is derived
      // from the scroll position instead; guard the setState to avoid a render
      // per scroll frame.
      setIndex((prev) => (prev === next ? prev : Math.max(0, Math.min(images.length - 1, next))));
    },
    [width, images.length]
  );

  if (images.length === 0) {
    return (
      <View
        style={{ height }}
        className="items-center justify-center bg-surface-sunken dark:bg-surface-dark-elevated"
        accessible
        accessibilityRole="image"
        accessibilityLabel="No photos for this listing"
      >
        <Text className="text-caption font-rubik-medium text-black-200 dark:text-white/60">
          No photos yet
        </Text>
      </View>
    );
  }

  const single = images.length === 1;

  // Carousel arrows: swiping is not obvious on a desktop browser, and a
  // photo row with no visible way forward reads as a single photo. The
  // arrows wrap around, and stay in step with swipes via onScroll.
  const goTo = useCallback(
    (next: number) => {
      if (single || !width) return;
      const target = (next + images.length) % images.length;
      setIndex(target);
      listRef.current?.scrollToIndex({ index: target, animated: true });
    },
    [single, width, images.length]
  );

  return (
    <View style={{ height }} onLayout={onLayout} className="relative overflow-hidden">
      {width > 0 ? (
        <FlatList
          ref={listRef}
          data={images}
          horizontal
          pagingEnabled={!single}
          scrollEnabled={!single}
          showsHorizontalScrollIndicator={false}
          // Uniform slide width means the offsets are known up front; without
          // this a jump to a far index scrolls to the wrong place.
          getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
          keyExtractor={(uri, i) => `${i}-${uri}`}
          onScroll={onScroll}
          scrollEventThrottle={16}
          renderItem={({ item, index: i }) => (
            <Slide uri={item} width={width} height={height} index={i} total={images.length} />
          )}
        />
      ) : null}

      {!single ? (
        <>
          {/* Previous / next arrows, vertically centred over the photo. */}
          <View
            pointerEvents="box-none"
            className="absolute left-sm right-sm flex-row items-center justify-between"
            style={{ top: height / 2 - 22 }}
          >
            <IconButton
              icon={icons.backArrow}
              label="Previous photo"
              onPress={() => goTo(index - 1)}
              transparent
              tintColor="#FFFFFF"
            />
            <IconButton
              icon={icons.rightArrow}
              label="Next photo"
              onPress={() => goTo(index + 1)}
              transparent
              tintColor="#FFFFFF"
            />
          </View>

          {/* A bottom scrim, stacked rather than a gradient because
              expo-linear-gradient is not a dependency and one more native
              module is not worth a single fade. Enough bands that the steps
              are below the eye's threshold — four coarse ones banded visibly
              on a flat white photo. It darkens the strip the indicator sits
              in so the pill never has to fight a blown-out sky. */}
          <View pointerEvents="none" className="absolute left-0 right-0 bottom-0">
            {SCRIM_STEPS.map((opacity, i) => (
              <View
                key={i}
                style={{ height: SCRIM_BAND, backgroundColor: `rgba(0,0,0,${opacity})` }}
              />
            ))}
          </View>

          {/* Dots convey position by colour alone, so the same overlay carries the
              position as text for assistive tech and re-announces on every swipe. */}
          <View
            pointerEvents="none"
            accessible
            accessibilityLiveRegion="polite"
            accessibilityLabel={`Photo ${index + 1} of ${images.length}`}
            className="absolute left-0 right-0 bottom-md items-center justify-center px-lg"
          >
            {images.length <= MAX_DOTS ? (
              // bg-black/70 plus a white hairline: the backdrop alone still
              // washes out on a blown-highlight sky, and the ring is what
              // guarantees an edge on a pure-white photo.
              <View
                style={INDICATOR_SHADOW}
                className="flex-row items-center gap-2xs rounded-full border border-white/40 bg-black/70 px-sm py-xs"
              >
                {images.map((uri, i) => (
                  <View
                    key={`${i}-${uri}`}
                    style={{ width: i === index ? 18 : 7, height: 7 }}
                    className={`rounded-full ${i === index ? "bg-white" : "bg-white/55"}`}
                  />
                ))}
              </View>
            ) : (
              <View
                style={INDICATOR_SHADOW}
                className="rounded-full border border-white/40 bg-black/70 px-sm py-2xs"
              >
                <Text className="text-caption font-rubik-semibold text-white">
                  {index + 1} / {images.length}
                </Text>
              </View>
            )}
          </View>
        </>
      ) : null}
    </View>
  );
}

/** Fade height per band, and the ramp itself — quadratic, so it starts invisibly. */
const SCRIM_BAND = 8;
const SCRIM_STEPS = Array.from({ length: 14 }, (_, i) =>
  Number((0.34 * ((i + 1) / 14) ** 2).toFixed(3))
);

/** Lifts the pill off the photo on the rare frame where the scrim is not enough. */
const INDICATOR_SHADOW = shadow({
  color: "#000000",
  opacity: 0.45,
  radius: 8,
  offsetY: 2,
  elevation: 4,
});

export default PropertyGallery;
