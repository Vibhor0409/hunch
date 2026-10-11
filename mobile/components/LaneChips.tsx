// Lane control above the deck: a real segmented control. One track, five segments,
// a raised thumb that slides to the selection.

import * as Haptics from "expo-haptics";
import { memo, useCallback, useEffect, useRef } from "react";
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";

import { colors, radii, shadows, space, springs } from "@/lib/theme";
import type { LaneFilter } from "@/lib/types";

export const LANES: { key: LaneFilter; label: string }[] = [
  { key: "foryou", label: "For you" },
  { key: "live", label: "Live" },
  { key: "tomorrow", label: "Tomorrow" },
  { key: "week", label: "This week" },
  { key: "later", label: "Later" },
];

/** The lane after `lane` in the control, for idle prefetching. */
export function nextLane(lane: LaneFilter): LaneFilter {
  const i = LANES.findIndex((l) => l.key === lane);
  return LANES[(i + 1) % LANES.length].key;
}

const PAD = 3;

export const LaneChips = memo(function LaneChips({
  value,
  onChange,
  disabled = false,
}: {
  value: LaneFilter;
  onChange: (lane: LaneFilter) => void;
  disabled?: boolean;
}) {
  const frames = useRef<({ x: number; width: number } | null)[]>(LANES.map(() => null));
  const measured = useRef(false);
  const thumbX = useSharedValue(0);
  const thumbW = useSharedValue(0);
  const thumbOpacity = useSharedValue(0);

  const selectedIndex = Math.max(
    0,
    LANES.findIndex((l) => l.key === value),
  );

  const moveThumb = useCallback(
    (index: number, animate: boolean) => {
      const frame = frames.current[index];
      if (!frame) return;
      if (animate) {
        thumbX.set(withSpring(frame.x, springs.quick));
        thumbW.set(withSpring(frame.width, springs.quick));
      } else {
        thumbX.set(frame.x);
        thumbW.set(frame.width);
      }
      thumbOpacity.set(1);
    },
    [thumbX, thumbW, thumbOpacity],
  );

  useEffect(() => {
    moveThumb(selectedIndex, measured.current);
  }, [selectedIndex, moveThumb]);

  const onSegmentLayout = (index: number) => (e: LayoutChangeEvent) => {
    const { x, width } = e.nativeEvent.layout;
    frames.current[index] = { x, width };
    if (index === selectedIndex) {
      moveThumb(index, measured.current);
      measured.current = true;
    }
  };

  const thumbStyle = useAnimatedStyle(() => ({
    opacity: thumbOpacity.get(),
    width: thumbW.get(),
    transform: [{ translateX: thumbX.get() }],
  }));

  return (
    <View style={[styles.track, disabled && styles.trackDisabled]} accessibilityRole="tablist">
      <Animated.View pointerEvents="none" style={[styles.thumb, thumbStyle]} />
      {LANES.map((lane, index) => {
        const selected = index === selectedIndex;
        return (
          <Pressable
            key={lane.key}
            testID={`lane-${lane.key}`}
            accessibilityRole="tab"
            accessibilityState={{ selected, disabled }}
            disabled={disabled}
            onLayout={onSegmentLayout(index)}
            onPress={() => {
              if (selected) return;
              Haptics.selectionAsync().catch(() => {});
              onChange(lane.key);
            }}
            style={styles.segment}
          >
            <Text
              style={[styles.text, selected && styles.textSelected]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.85}
            >
              {lane.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
});

const styles = StyleSheet.create({
  track: {
    flexDirection: "row",
    alignItems: "stretch",
    marginHorizontal: space.xl,
    padding: PAD,
    height: 42,
    borderRadius: radii.pill,
    backgroundColor: colors.paperDeep,
  },
  trackDisabled: { opacity: 0.7 },
  thumb: {
    position: "absolute",
    top: PAD,
    bottom: PAD,
    left: 0,
    borderRadius: radii.pill,
    backgroundColor: colors.card,
    ...shadows.tile,
  },
  segment: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
    borderRadius: radii.pill,
  },
  text: { fontSize: 13, lineHeight: 16, fontWeight: "600", color: colors.ink2 },
  textSelected: { color: colors.ink, fontWeight: "700" },
});
