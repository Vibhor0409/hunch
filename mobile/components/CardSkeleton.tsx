// Skeleton stack shown while a lane loads: three slips in the same positions the
// real cards take, breathing gently, with a label so nobody wonders what is happening.

import { memo, useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from "react-native-reanimated";

import { colors, radii, shadows, space, type } from "@/lib/theme";

export const CardSkeleton = memo(function CardSkeleton({ label }: { label: string }) {
  const pulse = useSharedValue(0);

  useEffect(() => {
    pulse.set(
      withRepeat(
        withSequence(
          withTiming(1, { duration: 900, easing: Easing.inOut(Easing.quad) }),
          withTiming(0, { duration: 900, easing: Easing.inOut(Easing.quad) }),
        ),
        -1,
        false,
      ),
    );
  }, [pulse]);

  const blockStyle = useAnimatedStyle(() => ({ opacity: 0.55 + 0.45 * pulse.get() }));

  return (
    <View style={styles.wrap} accessibilityLabel={label} accessibilityRole="progressbar">
      <View style={[styles.card, styles.third]} />
      <View style={[styles.card, styles.second]} />
      <View style={[styles.card, styles.first]}>
        <View style={styles.top}>
          <Animated.View style={[styles.block, styles.chip, blockStyle]} />
          <Animated.View style={[styles.block, styles.pill, blockStyle]} />
        </View>
        <View style={styles.body}>
          <Animated.View style={[styles.block, styles.lineLong, blockStyle]} />
          <Animated.View style={[styles.block, styles.lineLong, blockStyle]} />
          <Animated.View style={[styles.block, styles.lineShort, blockStyle]} />
        </View>
        <View style={styles.footer}>
          <Text style={styles.label}>{label}</Text>
        </View>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  card: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    borderRadius: radii.card,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    ...shadows.card,
  },
  // Rendered third, second, first: paint order stacks them, no zIndex needed.
  first: {},
  second: { transform: [{ translateY: 16 }, { scale: 0.95 }] },
  third: { transform: [{ translateY: 32 }, { scale: 0.9 }], opacity: 0.9 },
  top: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: space.xl,
    paddingTop: space.xl,
  },
  block: { backgroundColor: colors.paperDeep, borderRadius: radii.pill },
  chip: { width: 96, height: 28 },
  pill: { width: 104, height: 28 },
  body: { flex: 1, justifyContent: "center", paddingHorizontal: space.xl, gap: space.md },
  lineLong: { height: 26, borderRadius: 8 },
  lineShort: { height: 26, width: "60%", borderRadius: 8 },
  footer: { paddingHorizontal: space.xl, paddingBottom: space.xl, alignItems: "center" },
  label: { ...type.small, color: colors.ink3 },
});
