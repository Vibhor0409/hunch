// One slip in the deck. The top card follows the finger and rotates about a pivot
// near its bottom edge. YES and NO stamps land as the card travels, SKIP as it rises.
// Release past a distance or a fling velocity commits; otherwise it springs back.
// Cards behind read the top card's progress and slide forward as it leaves.
// A tap on Context flips the slip to its back: live context from the web, or the
// market's own rules when the web has nothing. Never odds.

import * as Haptics from "expo-haptics";
import * as WebBrowser from "expo-web-browser";
import { forwardRef, memo, useImperativeHandle, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
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
  type SharedValue,
} from "react-native-reanimated";
import Svg, { Line } from "react-native-svg";
import { scheduleOnRN } from "react-native-worklets";

import { CategoryChip } from "@/components/Category";
import { closesSoon, formatCloses } from "@/components/format";
import { usePlayer } from "@/components/PlayerContext";
import { PulsingMark } from "@/components/PulsingMark";
import { Stamp } from "@/components/Stamp";
import { getContext } from "@/lib/api";
import { colors, credit, hit, motion, radii, shadows, space, springs, swipe, type } from "@/lib/theme";
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
  /** 0 to 1: how far the top card has travelled toward a commit. Shared by the stack. */
  topProgress: SharedValue<number>;
  onCommit: (card: CardPublic, side: Side) => void;
  onSkip: (card: CardPublic) => void;
  /** Reports when the top card shows its back (gestures and buttons pause until Back). */
  onFlip?: (flipped: boolean) => void;
}

type ContextState = { kind: "idle" } | { kind: "loading" } | { kind: "ready"; data: CardContext } | { kind: "error" };

const NOTCH = 12;
const NO_CONTEXT = "No fresh context for this one. Trust your gut.";
const MARKET_SOURCE = "Market rules on Gemini";
// Web context runs to about 220 characters and keeps the large type. Longer passages
// (market rules can run to three sentences) step down a size, and the body scrolls.
const LONG_CONTEXT_CHARS = 240;

/** The context worth showing, or null when the lookup failed or came back empty. */
function shownContext(state: ContextState): CardContext | null {
  if (state.kind !== "ready") return null;
  const { available, text } = state.data;
  return available && typeof text === "string" && text.trim().length > 0 ? state.data : null;
}

/** Only a real http(s) address gets a "Read more" link. */
function linkOf(url: string | null | undefined): string | null {
  if (typeof url !== "string") return null;
  const trimmed = url.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : null;
}

function lightHaptic() {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}

function clampNumber(n: number, lo: number, hi: number): number {
  "worklet";
  return Math.min(hi, Math.max(lo, n));
}

export const SwipeCard = memo(
  forwardRef<SwipeCardHandle, Props>(function SwipeCard(
    { card, index, enabled, now, topProgress, onCommit, onSkip, onFlip },
    ref,
  ) {
    const { width: W, height: H } = useWindowDimensions();
    const { playerId } = usePlayer();
    const tx = useSharedValue(0);
    const ty = useSharedValue(0);
    const flip = useSharedValue(0);
    const cardH = useSharedValue(H * 0.55);
    const [flipped, setFlipped] = useState(false);
    // Cached per card instance, so flipping twice never refetches.
    const [context, setContext] = useState<ContextState>({ kind: "idle" });

    const isTop = index === 0;
    const practiceOnly = card.tradable === false;

    const commit = (side: Side) => onCommit(card, side);
    const skip = () => onSkip(card);

    // Fly the card off in the direction of the action. Velocity shortens the trip.
    const flyOut = (action: CardAction, vx: number, vy: number) => {
      "worklet";
      if (action === "skip") {
        const targetY = -(H + 120);
        const remaining = Math.abs(targetY - ty.get());
        const duration = clampNumber((remaining / Math.max(Math.abs(vy), 1600)) * 1000, motion.flyOutMinMs, motion.flyOutMaxMs);
        topProgress.set(withTiming(1, { duration }));
        tx.set(withTiming(tx.get() * 1.2, { duration }));
        ty.set(
          withTiming(targetY, { duration, easing: Easing.out(Easing.quad) }, (finished) => {
            if (finished) scheduleOnRN(skip);
          }),
        );
        return;
      }
      const direction = action === "yes" ? 1 : -1;
      const targetX = direction * (W + 160);
      const remaining = Math.abs(targetX - tx.get());
      const duration = clampNumber((remaining / Math.max(Math.abs(vx), 1400)) * 1000, motion.flyOutMinMs, motion.flyOutMaxMs);
      topProgress.set(withTiming(1, { duration }));
      ty.set(withTiming(ty.get() + vy * (duration / 1000) * 0.25, { duration }));
      tx.set(
        withTiming(targetX, { duration, easing: Easing.out(Easing.quad) }, (finished) => {
          if (finished) scheduleOnRN(commit, action);
        }),
      );
    };

    useImperativeHandle(ref, () => ({
      fling: (action: CardAction) => {
        if (!enabled || flipped) return;
        lightHaptic();
        runOnUI(flyOut)(action, 0, 0);
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

    const retryContext = () => {
      Haptics.selectionAsync().catch(() => {});
      fetchContext();
    };

    const showBack = () => {
      if (!enabled || flipped) return;
      Haptics.selectionAsync().catch(() => {});
      setFlipped(true);
      onFlip?.(true);
      flip.set(withTiming(1, { duration: motion.flipMs, easing: Easing.inOut(Easing.cubic) }));
      // A good answer stays cached on the card. A failed request is asked again.
      if (context.kind === "idle" || context.kind === "error") fetchContext();
    };

    const showFront = () => {
      Haptics.selectionAsync().catch(() => {});
      flip.set(withTiming(0, { duration: motion.flipMs, easing: Easing.inOut(Easing.cubic) }));
      setFlipped(false);
      onFlip?.(false);
    };

    const pan = Gesture.Pan()
      .enabled(enabled && !flipped)
      .minDistance(6)
      .onUpdate((e) => {
        const x = e.translationX;
        // Dragging down is damped: there is nothing below the deck.
        const y = e.translationY < 0 ? e.translationY : e.translationY * 0.25;
        tx.set(x);
        ty.set(y);
        const horizontal = Math.abs(x) / swipe.commitX;
        const vertical = -y / swipe.commitY;
        topProgress.set(clampNumber(Math.max(horizontal, vertical), 0, 1));
      })
      .onEnd((e) => {
        const upward =
          (e.translationY < -swipe.commitY || e.velocityY < -swipe.flingVelocity) &&
          Math.abs(e.translationX) < swipe.commitX * 0.7 &&
          Math.abs(e.velocityX) < Math.abs(e.velocityY);
        if (upward) {
          scheduleOnRN(lightHaptic);
          flyOut("skip", e.velocityX, e.velocityY);
          return;
        }
        if (e.translationX > swipe.commitX || e.velocityX > swipe.flingVelocity) {
          scheduleOnRN(lightHaptic);
          flyOut("yes", e.velocityX, e.velocityY);
          return;
        }
        if (e.translationX < -swipe.commitX || e.velocityX < -swipe.flingVelocity) {
          scheduleOnRN(lightHaptic);
          flyOut("no", e.velocityX, e.velocityY);
          return;
        }
        tx.set(withSpring(0, { ...springs.snap, velocity: e.velocityX }));
        ty.set(withSpring(0, { ...springs.snap, velocity: e.velocityY }));
        topProgress.set(withSpring(0, springs.snap));
      });

    const cardStyle = useAnimatedStyle(() => {
      if (index === 0) {
        const rotate = interpolate(tx.get(), [-W, 0, W], [-swipe.maxRotationDeg, 0, swipe.maxRotationDeg]);
        const pivot = cardH.get() / 2;
        return {
          opacity: 1,
          transform: [
            { translateX: tx.get() },
            { translateY: ty.get() },
            // Rotate about a point near the bottom edge, like a card held from below.
            { translateY: pivot },
            { rotateZ: `${rotate}deg` },
            { translateY: -pivot },
          ],
        };
      }
      // Cards behind: their effective depth shrinks as the top card leaves.
      const d = Math.max(0, index - topProgress.get());
      const scale = interpolate(d, [0, 1, 2], [1, 0.95, 0.9], Extrapolation.CLAMP);
      const offsetY = interpolate(d, [0, 1, 2], [0, 16, 32], Extrapolation.CLAMP);
      const opacity = interpolate(d, [1, 2, 2.5], [1, 0.9, 0], Extrapolation.CLAMP);
      return {
        opacity,
        transform: [{ translateY: offsetY }, { scale }],
      };
    });

    const frontStyle = useAnimatedStyle(() => ({
      transform: [{ perspective: 1400 }, { rotateY: `${flip.get() * 180}deg` }],
    }));
    const backStyle = useAnimatedStyle(() => ({
      transform: [{ perspective: 1400 }, { rotateY: `${180 + flip.get() * 180}deg` }],
    }));

    // Stamps land: they fade in, settle from slightly large, and straighten a little.
    const yesStyle = useAnimatedStyle(() => {
      const p = interpolate(tx.get(), [16, swipe.commitX], [0, 1], Extrapolation.CLAMP);
      return {
        opacity: p,
        transform: [{ scale: 1.25 - 0.25 * p }, { rotateZ: `${-22 + 10 * p}deg` }],
      };
    });
    const noStyle = useAnimatedStyle(() => {
      const p = interpolate(tx.get(), [-swipe.commitX, -16], [1, 0], Extrapolation.CLAMP);
      return {
        opacity: p,
        transform: [{ scale: 1.25 - 0.25 * p }, { rotateZ: `${22 - 10 * p}deg` }],
      };
    });
    const skipStyle = useAnimatedStyle(() => {
      const vertical = interpolate(ty.get(), [-swipe.commitY, -16], [1, 0], Extrapolation.CLAMP);
      const horizontal = interpolate(Math.abs(tx.get()), [0, 50], [1, 0], Extrapolation.CLAMP);
      const p = vertical * horizontal;
      return { opacity: p, transform: [{ scale: 1.2 - 0.2 * p }] };
    });

    // What the back says depends on where the context came from. A missing kind reads as web.
    const shown = shownContext(context);
    const fromMarket = shown?.kind === "market";
    const backTitle = shown ? (fromMarket ? "About this market" : "Live context") : "Context";
    const backCredit = shown ? (fromMarket ? credit.poweredBy : credit.context) : "";

    const closes = formatCloses(card.expiresAt, now);
    const urgent = closesSoon(card.expiresAt, now);

    return (
      <GestureDetector gesture={pan}>
        <Animated.View
          testID={isTop ? "card" : undefined}
          accessible={isTop && !flipped}
          accessibilityLabel={isTop ? card.question : undefined}
          // No zIndex on purpose: the deck renders back-to-front, so paint order
          // puts the top card on top and nothing can rise above the reveal.
          style={[styles.card, cardStyle]}
          onLayout={(e) => cardH.set(e.nativeEvent.layout.height)}
        >
          {/* Front */}
          <Animated.View style={[styles.face, frontStyle]} pointerEvents={flipped ? "none" : "auto"}>
            <View style={styles.top}>
              <CategoryChip category={card.category} />
              <View style={[styles.closes, urgent && styles.closesUrgent]}>
                <Text style={[styles.closesText, urgent && styles.closesTextUrgent]} numberOfLines={1}>
                  {closes}
                </Text>
              </View>
            </View>

            <View style={styles.body}>
              <Text style={styles.question} numberOfLines={6} adjustsFontSizeToFit minimumFontScale={0.7}>
                {card.question}
              </Text>
            </View>

            {/* Perforation: the stub below is the part you keep. */}
            <View style={styles.perforation}>
              <Svg width="100%" height={2}>
                <Line x1={NOTCH + 8} y1={1} x2="100%" y2={1} stroke={colors.lineStrong} strokeWidth={2} strokeDasharray="6 5" />
              </Svg>
              <View style={[styles.notch, styles.notchLeft]} />
              <View style={[styles.notch, styles.notchRight]} />
            </View>

            <View style={styles.stub}>
              {practiceOnly ? (
                <View style={styles.practiceTag}>
                  <Text style={styles.practiceTagText}>Practice only</Text>
                </View>
              ) : (
                <Text style={styles.hint}>
                  {"\u2190 "}
                  <Text style={styles.hintNo}>NO</Text>
                  {"      "}
                  <Text style={styles.hintYes}>YES</Text>
                  {" \u2192"}
                </Text>
              )}
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

            <Animated.View pointerEvents="none" style={[styles.stamp, styles.stampYes, yesStyle]}>
              <Stamp kind="yes" size="lg" />
            </Animated.View>
            <Animated.View pointerEvents="none" style={[styles.stamp, styles.stampNo, noStyle]}>
              <Stamp kind="no" size="lg" />
            </Animated.View>
            <Animated.View pointerEvents="none" style={[styles.stamp, styles.stampSkip, skipStyle]}>
              <Stamp kind="skip" size="lg" />
            </Animated.View>
          </Animated.View>

          {/* Back */}
          <Animated.View
            testID={isTop ? "card-back" : undefined}
            style={[styles.face, styles.back, backStyle]}
            pointerEvents={flipped ? "auto" : "none"}
          >
            <View style={styles.top}>
              <Text style={styles.backTitle}>{backTitle}</Text>
              <View style={styles.blindTag}>
                <Text style={styles.blindTagText}>Odds stay hidden</Text>
              </View>
            </View>

            <View style={styles.backBody}>
              <ContextBody state={context} shown={shown} onRetry={retryContext} />
            </View>

            <View style={styles.backFooter}>
              <Text style={styles.creditText} numberOfLines={2}>
                {backCredit}
              </Text>
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
  }),
);

function ContextBody({
  state,
  shown,
  onRetry,
}: {
  state: ContextState;
  shown: CardContext | null;
  onRetry: () => void;
}) {
  // Nothing to draw until the first flip asks for context.
  if (state.kind === "idle") return null;

  if (state.kind === "loading") {
    return (
      <View style={styles.centered} accessibilityRole="progressbar" accessibilityLabel="Finding context">
        <PulsingMark size={56} background={colors.card} />
        <Text style={styles.loadingTitle}>Finding context</Text>
        <Text style={styles.loadingHint}>This can take a few seconds.</Text>
      </View>
    );
  }

  // The request failed, or the server had nothing for this market.
  if (!shown) {
    return (
      <View style={styles.contextGap}>
        <Text style={styles.contextText}>{NO_CONTEXT}</Text>
        <Pressable
          accessibilityRole="button"
          onPress={onRetry}
          hitSlop={6}
          style={({ pressed }) => [styles.textButton, styles.textButtonStart, pressed && styles.pressed]}
        >
          <Text style={styles.textButtonText}>Try again</Text>
        </Pressable>
      </View>
    );
  }

  const text = (shown.text ?? "").trim();
  const source =
    shown.kind === "market" ? shown.sourceTitle?.trim() || MARKET_SOURCE : (shown.sourceDomain ?? shown.sourceTitle);
  const link = linkOf(shown.sourceUrl);

  return (
    <ScrollView contentContainerStyle={styles.contextScroll}>
      <Text style={[styles.contextText, text.length > LONG_CONTEXT_CHARS && styles.contextTextLong]}>{text}</Text>
      <View style={styles.sourceRow}>
        {source ? (
          <Text style={styles.source} numberOfLines={1}>
            {source}
          </Text>
        ) : null}
        {link ? (
          <Pressable
            accessibilityRole="link"
            onPress={() => {
              WebBrowser.openBrowserAsync(link).catch(() => {});
            }}
            hitSlop={6}
            style={({ pressed }) => [styles.textButton, pressed && styles.pressed]}
          >
            <Text style={styles.textButtonText}>Read more</Text>
          </Pressable>
        ) : null}
      </View>
    </ScrollView>
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
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    backfaceVisibility: "hidden",
    ...shadows.card,
  },
  back: { backgroundColor: colors.card },
  top: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.sm,
    paddingHorizontal: space.xl,
    paddingTop: space.xl,
  },
  closes: {
    height: 28,
    paddingHorizontal: space.md,
    borderRadius: radii.pill,
    backgroundColor: colors.paperDeep,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 1,
  },
  closesUrgent: { backgroundColor: colors.accentSoft },
  closesText: { ...type.caption, fontSize: 13, lineHeight: 16, color: colors.ink2, fontVariant: ["tabular-nums"] },
  closesTextUrgent: { color: colors.accentDeep },
  body: { flex: 1, justifyContent: "center", paddingHorizontal: space.xl, paddingVertical: space.lg },
  question: { ...type.display },
  perforation: { height: 2, justifyContent: "center", overflow: "visible" },
  notch: {
    position: "absolute",
    width: NOTCH * 2,
    height: NOTCH * 2,
    borderRadius: NOTCH,
    backgroundColor: colors.paper,
    borderWidth: 1,
    borderColor: colors.line,
    top: -NOTCH + 1,
  },
  notchLeft: { left: -NOTCH - 1 },
  notchRight: { right: -NOTCH - 1 },
  stub: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.md,
    paddingHorizontal: space.xl,
    paddingVertical: space.lg,
  },
  hint: { ...type.label, color: colors.ink3 },
  hintNo: { color: colors.no },
  hintYes: { color: colors.yes },
  practiceTag: {
    height: 24,
    paddingHorizontal: space.sm,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  practiceTagText: { ...type.caption, color: colors.ink2 },
  contextButton: {
    minHeight: 36,
    paddingHorizontal: space.lg,
    borderRadius: radii.pill,
    backgroundColor: colors.ink,
    alignItems: "center",
    justifyContent: "center",
  },
  contextButtonText: { ...type.small, color: colors.onInk, fontWeight: "700" },
  stamp: { position: "absolute", top: 72 },
  stampYes: { left: space.xl },
  stampNo: { right: space.xl },
  stampSkip: { alignSelf: "center", top: 28 },
  backTitle: { ...type.heading },
  blindTag: {
    height: 24,
    paddingHorizontal: space.sm,
    borderRadius: 6,
    backgroundColor: colors.paperDeep,
    alignItems: "center",
    justifyContent: "center",
  },
  blindTagText: { ...type.caption, color: colors.ink2 },
  backBody: { flex: 1, justifyContent: "center", paddingHorizontal: space.xl, paddingVertical: space.lg },
  centered: { alignItems: "center", gap: space.md },
  loadingTitle: { ...type.heading, textAlign: "center" },
  loadingHint: { ...type.small, textAlign: "center" },
  contextGap: { gap: space.md },
  // Short passages center in the card; long ones scroll, so nothing is ever cut off.
  contextScroll: { flexGrow: 1, justifyContent: "center", gap: space.md },
  contextText: { fontSize: 21, lineHeight: 29, fontWeight: "600", letterSpacing: -0.3, color: colors.ink },
  contextTextLong: { fontSize: 17, lineHeight: 25, fontWeight: "500", letterSpacing: -0.1 },
  sourceRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.md },
  source: { ...type.small, flexShrink: 1 },
  textButton: { minHeight: hit.min, justifyContent: "center" },
  textButtonStart: { alignSelf: "flex-start" },
  textButtonText: { ...type.body, color: colors.accentDeep, fontWeight: "700" },
  backFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.md,
    paddingHorizontal: space.xl,
    paddingBottom: space.lg,
    paddingTop: space.sm,
  },
  // Takes the free width, so Back stays on the right even before a credit is known.
  creditText: { ...type.caption, color: colors.ink3, flex: 1 },
  backButton: {
    minHeight: hit.min,
    minWidth: 96,
    paddingHorizontal: space.lg,
    borderRadius: radii.pill,
    backgroundColor: colors.ink,
    alignItems: "center",
    justifyContent: "center",
  },
  backButtonText: { ...type.heading, color: colors.onInk },
  pressed: { opacity: 0.75 },
});
