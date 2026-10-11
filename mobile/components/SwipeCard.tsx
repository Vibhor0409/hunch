// One slip in the deck. The top card follows the finger, rotates, stamps YES or NO
// past the threshold, and flies off on commit. Cards behind it sit scaled and offset.

import * as Haptics from "expo-haptics";
import { forwardRef, useEffect, useImperativeHandle } from "react";
import { StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Extrapolation,
  interpolate,
  runOnUI,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import Svg, { Line } from "react-native-svg";

import { formatCloses } from "@/components/format";
import { colors, motion, radii, space, springs, swipe, type } from "@/lib/theme";
import type { CardPublic, Side } from "@/lib/types";

export type CardAction = Side | "skip";

export interface SwipeCardHandle {
  /** Animate the card off the deck as if it had been swiped. */
  fling: (action: CardAction) => void;
}

interface Props {
  card: CardPublic;
  /** 0 is the top card. */
  index: number;
  enabled: boolean;
  now: number;
  onCommit: (side: Side) => void;
  onSkip: () => void;
}

const NOTCH = 12;

function lightHaptic() {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}

export const SwipeCard = forwardRef<SwipeCardHandle, Props>(function SwipeCard(
  { card, index, enabled, now, onCommit, onSkip },
  ref,
) {
  const { width: W, height: H } = useWindowDimensions();
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const depth = useSharedValue(index);

  useEffect(() => {
    depth.set(withSpring(index, springs.stack));
  }, [index, depth]);

  const flyOut = (action: CardAction) => {
    "worklet";
    if (action === "skip") {
      ty.set(
        withTiming(-H * 1.2, { duration: motion.flyOutMs }, (finished) => {
          if (finished) scheduleOnRN(onSkip);
        }),
      );
      return;
    }
    const direction = action === "yes" ? 1 : -1;
    tx.set(
      withTiming(direction * W * 1.5, { duration: motion.flyOutMs }, (finished) => {
        if (finished) scheduleOnRN(onCommit, action);
      }),
    );
  };

  useImperativeHandle(ref, () => ({
    fling: (action: CardAction) => {
      if (!enabled) return;
      lightHaptic();
      runOnUI(flyOut)(action);
    },
  }));

  const pan = Gesture.Pan()
    .enabled(enabled)
    .minDistance(6)
    .onUpdate((e) => {
      tx.set(e.translationX);
      ty.set(e.translationY);
    })
    .onEnd((e) => {
      const up =
        (e.translationY < -swipe.commitY || e.velocityY < -swipe.flingVelocity) &&
        Math.abs(e.translationX) < swipe.commitX * 0.7;
      if (up) {
        scheduleOnRN(lightHaptic);
        flyOut("skip");
        return;
      }
      if (e.translationX > swipe.commitX || e.velocityX > swipe.flingVelocity) {
        scheduleOnRN(lightHaptic);
        flyOut("yes");
        return;
      }
      if (e.translationX < -swipe.commitX || e.velocityX < -swipe.flingVelocity) {
        scheduleOnRN(lightHaptic);
        flyOut("no");
        return;
      }
      tx.set(withSpring(0, springs.snap));
      ty.set(withSpring(0, springs.snap));
    });

  const cardStyle = useAnimatedStyle(() => {
    const d = depth.get();
    const rotate = interpolate(tx.get(), [-W, 0, W], [-swipe.maxRotationDeg, 0, swipe.maxRotationDeg]);
    const scale = interpolate(d, [0, 1, 2], [1, 0.95, 0.9], Extrapolation.CLAMP);
    const offsetY = interpolate(d, [0, 1, 2], [0, 14, 28], Extrapolation.CLAMP);
    const opacity = interpolate(d, [0, 1, 2, 3], [1, 1, 0.8, 0], Extrapolation.CLAMP);
    return {
      opacity,
      transform: [
        { translateX: tx.get() },
        { translateY: ty.get() + offsetY },
        { rotateZ: `${rotate}deg` },
        { scale },
      ],
    };
  });

  const yesStyle = useAnimatedStyle(() => ({
    opacity: interpolate(tx.get(), [24, swipe.commitX], [0, 1], Extrapolation.CLAMP),
  }));
  const noStyle = useAnimatedStyle(() => ({
    opacity: interpolate(tx.get(), [-swipe.commitX, -24], [1, 0], Extrapolation.CLAMP),
  }));
  const skipStyle = useAnimatedStyle(() => {
    const vertical = interpolate(ty.get(), [-swipe.commitY, -24], [1, 0], Extrapolation.CLAMP);
    const horizontal = interpolate(Math.abs(tx.get()), [0, 60], [1, 0], Extrapolation.CLAMP);
    return { opacity: vertical * horizontal };
  });

  const isTop = index === 0;

  return (
    <GestureDetector gesture={pan}>
      <Animated.View
        testID={isTop ? "card" : undefined}
        accessible={isTop}
        accessibilityLabel={isTop ? card.question : undefined}
        style={[styles.card, { zIndex: 10 - index }, cardStyle]}
      >
        <View style={styles.top}>
          <View style={styles.category}>
            <Text style={styles.categoryText}>{card.category}</Text>
          </View>
          <Text style={styles.blind}>Blind</Text>
        </View>

        <View style={styles.body}>
          <Text style={styles.question} numberOfLines={6} adjustsFontSizeToFit minimumFontScale={0.7}>
            {card.question}
          </Text>
        </View>

        {/* Perforation: the stub below is the part you keep. */}
        <View style={styles.perforation}>
          <Svg width="100%" height={2}>
            <Line x1={NOTCH + 6} y1={1} x2="100%" y2={1} stroke={colors.lineStrong} strokeWidth={2} strokeDasharray="6 5" />
          </Svg>
          <View style={[styles.notch, styles.notchLeft]} />
          <View style={[styles.notch, styles.notchRight]} />
        </View>

        <View style={styles.stub}>
          <Text style={styles.closes}>{formatCloses(card.expiresAt, now)}</Text>
          <Text style={styles.hint}>NO {"←"}   {"→"} YES</Text>
        </View>

        <Animated.View pointerEvents="none" style={[styles.stamp, styles.stampYes, yesStyle]}>
          <Text style={[styles.stampText, { color: colors.yes }]}>YES</Text>
        </Animated.View>
        <Animated.View pointerEvents="none" style={[styles.stamp, styles.stampNo, noStyle]}>
          <Text style={[styles.stampText, { color: colors.no }]}>NO</Text>
        </Animated.View>
        <Animated.View pointerEvents="none" style={[styles.stamp, styles.stampSkip, skipStyle]}>
          <Text style={[styles.stampText, { color: colors.muted }]}>SKIP</Text>
        </Animated.View>
      </Animated.View>
    </GestureDetector>
  );
});

const styles = StyleSheet.create({
  card: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: radii.card,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    overflow: "hidden",
  },
  top: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: space.xl,
    paddingTop: space.xl,
  },
  category: {
    paddingHorizontal: space.md,
    paddingVertical: 6,
    borderRadius: radii.chip,
    backgroundColor: colors.accentSoft,
  },
  categoryText: { ...type.label, color: colors.accent },
  blind: { ...type.label, color: colors.faint },
  body: { flex: 1, justifyContent: "center", paddingHorizontal: space.xl, paddingVertical: space.lg },
  question: { ...type.display },
  perforation: { height: 2, justifyContent: "center" },
  notch: {
    position: "absolute",
    width: NOTCH * 2,
    height: NOTCH * 2,
    borderRadius: NOTCH,
    backgroundColor: colors.bg,
    top: -NOTCH + 1,
  },
  notchLeft: { left: -NOTCH },
  notchRight: { right: -NOTCH },
  stub: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: space.xl,
    paddingVertical: space.lg,
  },
  closes: { ...type.body, color: colors.muted, fontVariant: ["tabular-nums"] },
  hint: { ...type.label, color: colors.faint },
  stamp: {
    position: "absolute",
    top: 64,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    borderWidth: 3,
    borderRadius: 8,
  },
  stampYes: { left: space.xl, borderColor: colors.yes, transform: [{ rotateZ: "-12deg" }] },
  stampNo: { right: space.xl, borderColor: colors.no, transform: [{ rotateZ: "12deg" }] },
  stampSkip: { alignSelf: "center", borderColor: colors.muted, top: 24 },
  stampText: { fontSize: 32, lineHeight: 38, fontWeight: "800", letterSpacing: 2 },
});
