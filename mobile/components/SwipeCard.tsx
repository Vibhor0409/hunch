// One slip in the deck. The top card follows the finger, rotates, stamps YES or NO
// past the threshold, and flies off on commit. Cards behind it sit scaled and offset.
// A tap on Context flips the slip to its back: live context from the web, never odds.

import * as Haptics from "expo-haptics";
import * as WebBrowser from "expo-web-browser";
import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Easing,
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
import { usePlayer } from "@/components/PlayerContext";
import { getContext } from "@/lib/api";
import { colors, hit, motion, radii, space, springs, swipe, type } from "@/lib/theme";
import type { CardContext, CardPublic, Side } from "@/lib/types";

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
  /** Reports when the card shows its back (gestures and buttons pause until Back). */
  onFlip?: (flipped: boolean) => void;
}

type ContextState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; data: CardContext }
  | { kind: "error" };

const NOTCH = 12;
const FLIP_MS = 420;
const NO_CONTEXT = "No fresh context for this one. Trust your gut.";

function lightHaptic() {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}

export const SwipeCard = forwardRef<SwipeCardHandle, Props>(function SwipeCard(
  { card, index, enabled, now, onCommit, onSkip, onFlip },
  ref,
) {
  const { width: W, height: H } = useWindowDimensions();
  const { playerId } = usePlayer();
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const depth = useSharedValue(index);
  const flip = useSharedValue(0);
  const [flipped, setFlipped] = useState(false);
  // Cached per card instance, so flipping twice never refetches.
  const [context, setContext] = useState<ContextState>({ kind: "idle" });

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
      if (!enabled || flipped) return;
      lightHaptic();
      runOnUI(flyOut)(action);
    },
  }));

  const fetchContext = () => {
    if (!playerId) {
      setContext({ kind: "error" });
      return;
    }
    setContext({ kind: "loading" });
    getContext(card.eventTicker, card.instrumentSymbol, playerId)
      .then((data) => setContext({ kind: "ready", data }))
      .catch(() => setContext({ kind: "error" }));
  };

  const showBack = () => {
    if (!enabled || flipped) return;
    Haptics.selectionAsync().catch(() => {});
    setFlipped(true);
    onFlip?.(true);
    flip.set(withTiming(1, { duration: FLIP_MS, easing: Easing.inOut(Easing.cubic) }));
    if (context.kind === "idle" || context.kind === "error") fetchContext();
  };

  const showFront = () => {
    Haptics.selectionAsync().catch(() => {});
    flip.set(withTiming(0, { duration: FLIP_MS, easing: Easing.inOut(Easing.cubic) }));
    setFlipped(false);
    onFlip?.(false);
  };

  const pan = Gesture.Pan()
    .enabled(enabled && !flipped)
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

  const frontStyle = useAnimatedStyle(() => ({
    transform: [{ perspective: 1200 }, { rotateY: `${flip.get() * 180}deg` }],
  }));
  const backStyle = useAnimatedStyle(() => ({
    transform: [{ perspective: 1200 }, { rotateY: `${180 + flip.get() * 180}deg` }],
  }));

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
        accessible={isTop && !flipped}
        accessibilityLabel={isTop ? card.question : undefined}
        style={[styles.card, { zIndex: 10 - index }, cardStyle]}
      >
        {/* Front */}
        <Animated.View style={[styles.face, frontStyle]} pointerEvents={flipped ? "none" : "auto"}>
          <View style={styles.top}>
            <View style={styles.category}>
              <Text style={styles.categoryText}>{card.category}</Text>
            </View>
            <Pressable
              testID="btn-context"
              accessibilityRole="button"
              accessibilityState={{ disabled: !enabled }}
              disabled={!enabled}
              onPress={showBack}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={({ pressed }) => [styles.contextButton, pressed && styles.pressed]}
            >
              <Text style={styles.contextButtonText}>Context</Text>
            </Pressable>
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

        {/* Back */}
        <Animated.View
          testID={isTop ? "card-back" : undefined}
          style={[styles.face, styles.back, backStyle]}
          pointerEvents={flipped ? "auto" : "none"}
        >
          <View style={styles.top}>
            <Text style={type.label}>Context</Text>
            <Text style={styles.blind}>Still blind</Text>
          </View>

          <View style={styles.backBody}>
            <ContextBody state={context} />
          </View>

          <View style={styles.backFooter}>
            <Text style={styles.credit}>Context by Context.dev</Text>
            <Pressable
              testID="btn-context-back"
              accessibilityRole="button"
              onPress={showFront}
              hitSlop={6}
              style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
            >
              <Text style={styles.backButtonText}>Back</Text>
            </Pressable>
          </View>
        </Animated.View>
      </Animated.View>
    </GestureDetector>
  );
});

function ContextBody({ state }: { state: ContextState }) {
  if (state.kind === "idle" || state.kind === "loading") {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.accent} />
        <Text style={type.small}>Looking it up</Text>
      </View>
    );
  }
  if (state.kind === "error" || !state.data.available || !state.data.text) {
    return <Text style={styles.contextText}>{NO_CONTEXT}</Text>;
  }
  const { text, sourceDomain, sourceTitle, sourceUrl } = state.data;
  const source = sourceDomain ?? sourceTitle;
  return (
    <View style={styles.contextGap}>
      <Text style={styles.contextText} numberOfLines={5}>
        {text}
      </Text>
      {source ? (
        <Text style={styles.source} numberOfLines={1}>
          {source}
        </Text>
      ) : null}
      {sourceUrl ? (
        <Pressable
          accessibilityRole="link"
          onPress={() => {
            WebBrowser.openBrowserAsync(sourceUrl).catch(() => {});
          }}
          hitSlop={6}
          style={({ pressed }) => [styles.readMore, pressed && styles.pressed]}
        >
          <Text style={styles.readMoreText}>Read more</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  face: {
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
    backfaceVisibility: "hidden",
  },
  back: { backgroundColor: colors.surfaceRaised },
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
  contextButton: {
    minHeight: 32,
    paddingHorizontal: space.md,
    borderRadius: radii.chip,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  contextButtonText: { ...type.small, color: colors.paper, fontWeight: "600" },
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
  backBody: { flex: 1, justifyContent: "center", paddingHorizontal: space.xl, paddingVertical: space.lg },
  centered: { alignItems: "center", gap: space.md },
  contextGap: { gap: space.md },
  contextText: { ...type.title, fontWeight: "600", fontSize: 21, lineHeight: 28 },
  source: { ...type.small, color: colors.muted },
  readMore: { alignSelf: "flex-start", minHeight: hit.min, justifyContent: "center" },
  readMoreText: { ...type.body, color: colors.accent, fontWeight: "600" },
  backFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: space.xl,
    paddingBottom: space.lg,
    paddingTop: space.sm,
  },
  credit: { ...type.label, color: colors.faint },
  backButton: {
    minHeight: hit.min,
    minWidth: 88,
    paddingHorizontal: space.lg,
    borderRadius: radii.button,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  backButtonText: { ...type.heading, color: colors.onAccent },
  pressed: { opacity: 0.75 },
});
