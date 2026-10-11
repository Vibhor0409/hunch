// The reveal: a sheet over the deck. Big YES and NO percentages count up, the split
// bar springs to the market's ratio, then the verdict, the payout and the receipt
// for the real sandbox order. This is the hero moment.

import * as Haptics from "expo-haptics";
import { memo, useEffect, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from "react-native";
import Animated, {
  Easing,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  formatContracts,
  formatDollars,
  formatMoney,
  formatPct,
  formatPrice,
} from "@/components/format";
import { HunchMark } from "@/components/HunchMark";
import { Stamp } from "@/components/Stamp";
import {
  colors,
  credit,
  hit,
  motion,
  radii,
  shadows,
  space,
  springs,
  type,
} from "@/lib/theme";
import type { CardPublic, Reveal, Side } from "@/lib/types";

export type SheetState =
  | { kind: "pending"; card: CardPublic; side: Side }
  | { kind: "ready"; card: CardPublic; side: Side; reveal: Reveal }
  | {
      kind: "error";
      card: CardPublic;
      side: Side;
      message: string;
      restorable: boolean;
    };

const SHEET_TRAVEL = 720;
const AnimatedTextInput = Animated.createAnimatedComponent(TextInput);

export const RevealSheet = memo(function RevealSheet({
  state,
  onNext,
  onRetry,
  onDismiss,
}: {
  state: SheetState | null;
  onNext: () => void;
  onRetry: (card: CardPublic, side: Side) => void;
  onDismiss: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [rendered, setRendered] = useState<SheetState | null>(state);
  const progress = useSharedValue(0);

  // Keep the last state mounted while the sheet animates out (derived during render).
  if (state && state !== rendered) {
    setRendered(state);
  }

  useEffect(() => {
    if (state) {
      progress.set(withSpring(1, springs.sheet));
      return undefined;
    }
    progress.set(withTiming(0, { duration: motion.fadeMs }));
    const t = setTimeout(() => setRendered(null), motion.fadeMs + 20);
    return () => clearTimeout(t);
  }, [state, progress]);

  useEffect(() => {
    if (state?.kind === "ready") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
        () => {},
      );
    } else if (state?.kind === "error") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(
        () => {},
      );
    }
  }, [state]);

  const backdropStyle = useAnimatedStyle(() => ({ opacity: progress.get() }));
  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: (1 - progress.get()) * SHEET_TRAVEL }],
  }));

  if (!rendered) return null;

  const paddingBottom = insets.bottom + space.lg;

  // A Modal lives in its own window above the whole screen, so no card in the deck
  // can paint over the odds. It unmounts when the sheet finishes fading out.
  return (
    <Modal
      visible
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={() => {
        if (rendered.kind !== "pending") onNext();
      }}
    >
      <View style={StyleSheet.absoluteFill}>
        <Animated.View style={[styles.backdrop, backdropStyle]} />
        <Animated.View
          testID="reveal"
          style={[styles.sheet, { paddingBottom }, sheetStyle]}
        >
          <View style={styles.grabber} />
          <ScrollView
            bounces={false}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.content}
          >
            <View style={styles.callRow}>
              <Text style={styles.callLabel}>Your call</Text>
              <Stamp kind={rendered.side} size="md" filled tilt />
            </View>
            <Text style={styles.question} numberOfLines={2}>
              {rendered.card.question}
            </Text>

            {rendered.kind === "pending" ? <PendingBody /> : null}
            {rendered.kind === "error" ? (
              <Text style={styles.errorText}>{rendered.message}</Text>
            ) : null}
            {rendered.kind === "ready" ? (
              <RevealBody reveal={rendered.reveal} card={rendered.card} />
            ) : null}
          </ScrollView>

          {rendered.kind === "error" && rendered.restorable ? (
            <View style={styles.actions}>
              <Pressable
                accessibilityRole="button"
                onPress={onDismiss}
                style={({ pressed }) => [
                  styles.ghost,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.ghostText}>Not now</Text>
              </Pressable>
              <Pressable
                testID="btn-next"
                accessibilityRole="button"
                onPress={() => onRetry(rendered.card, rendered.side)}
                style={({ pressed }) => [
                  styles.next,
                  styles.nextHalf,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.nextText}>Try again</Text>
              </Pressable>
            </View>
          ) : (
            <Pressable
              testID="btn-next"
              accessibilityRole="button"
              accessibilityState={{ disabled: rendered.kind === "pending" }}
              onPress={onNext}
              disabled={rendered.kind === "pending"}
              style={({ pressed }) => [
                styles.next,
                rendered.kind === "pending" && styles.nextDisabled,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.nextText}>
                {rendered.kind === "pending" ? "Checking the market" : "Next"}
              </Text>
            </Pressable>
          )}
        </Animated.View>
      </View>
    </Modal>
  );
});

/** The card is already committed. The mark breathes until the market answers. */
function PendingBody() {
  const pulse = useSharedValue(0);
  useEffect(() => {
    pulse.set(
      withRepeat(
        withSequence(
          withTiming(1, { duration: 650, easing: Easing.inOut(Easing.quad) }),
          withTiming(0, { duration: 650, easing: Easing.inOut(Easing.quad) }),
        ),
        -1,
        false,
      ),
    );
  }, [pulse]);
  const markStyle = useAnimatedStyle(() => ({
    opacity: 0.7 + 0.3 * pulse.get(),
    transform: [{ scale: 0.94 + 0.1 * pulse.get() }],
  }));
  return (
    <View
      style={styles.pending}
      accessibilityRole="progressbar"
      accessibilityLabel="Checking the market"
    >
      <Animated.View style={markStyle}>
        <HunchMark size={72} background={colors.card} />
      </Animated.View>
      <Text style={styles.pendingTitle}>Checking the market</Text>
      <Text style={styles.pendingHint}>
        Reading the live odds on Gemini. This takes a second or two.
      </Text>
    </View>
  );
}

function RevealBody({ reveal, card }: { reveal: Reveal; card: CardPublic }) {
  const yesPct = clampPct(reveal.yesPct);
  const noPct = clampPct(reveal.noPct);
  const total = yesPct + noPct;
  const yesShare = total > 0 ? (yesPct / total) * 100 : 50;

  const yesWidth = useSharedValue(50);
  const fade = useSharedValue(0);
  const rise = useSharedValue(12);

  useEffect(() => {
    yesWidth.set(50);
    fade.set(0);
    rise.set(12);
    yesWidth.set(withDelay(120, withSpring(yesShare, springs.reveal)));
    fade.set(withDelay(motion.countMs * 0.6, withTiming(1, { duration: 360 })));
    rise.set(
      withDelay(
        motion.countMs * 0.6,
        withTiming(0, { duration: 360, easing: Easing.out(Easing.cubic) }),
      ),
    );
  }, [reveal, yesShare, yesWidth, fade, rise]);

  const yesStyle = useAnimatedStyle(() => ({ width: `${yesWidth.get()}%` }));
  const restStyle = useAnimatedStyle(() => ({
    opacity: fade.get(),
    transform: [{ translateY: rise.get() }],
  }));

  const chosenYes = reveal.side === "yes";
  const paid = reveal.mode === "paid";
  const receipt = reveal.receipt;
  const chosenPct = chosenYes ? yesPct : noPct;
  const otherPct = chosenYes ? noPct : yesPct;
  const withMarket = chosenPct >= otherPct;

  const verdict = withMarket
    ? `You sided with ${formatPct(chosenPct)} of the market.`
    : `You went against ${formatPct(otherPct)} of the market.`;

  let payoutLine: string;
  if (paid) {
    payoutLine = `${formatDollars(reveal.stake)} returns ${formatDollars(reveal.payoutIfRight)} if right.`;
  } else if (card.tradable === false) {
    payoutLine = "Practice call. This market is not on the Gemini sandbox yet.";
  } else if (receipt?.message) {
    payoutLine = receipt.message;
  } else {
    payoutLine = "Practice call. It still scores Edge.";
  }

  // Wallet movement for paid swipes (F8). Older responses may not carry these fields.
  const walletLine =
    paid &&
    typeof reveal.cost === "number" &&
    typeof reveal.balanceAfter === "number"
      ? `Cost ${formatMoney(reveal.cost)} from your wallet. Balance ${formatMoney(reveal.balanceAfter)}.`
      : null;

  const liveOrder = Boolean(receipt?.orderId);

  return (
    <View style={styles.bodyGap}>
      <Text style={styles.marketLabel}>The market says</Text>

      <View style={styles.numbers}>
        <View style={styles.numberCol}>
          <CountUp value={yesPct} align="left" />
          <View style={styles.sideRow}>
            <View style={[styles.sideKey, { backgroundColor: colors.yes }]} />
            <Text style={[styles.sideName, { color: colors.yes }]}>YES</Text>
            {chosenYes ? <YouTag /> : null}
          </View>
        </View>
        <View style={[styles.numberCol, styles.numberColRight]}>
          <CountUp value={noPct} align="right" />
          <View style={[styles.sideRow, styles.sideRowRight]}>
            {!chosenYes ? <YouTag /> : null}
            <Text style={[styles.sideName, { color: colors.no }]}>NO</Text>
            <View style={[styles.sideKey, { backgroundColor: colors.no }]} />
          </View>
        </View>
      </View>

      <View style={styles.bar}>
        <Animated.View style={[styles.barYes, yesStyle]} />
        <View style={styles.barGap} />
        <View style={styles.barNo} />
      </View>

      <Animated.View style={[styles.bodyGap, restStyle]}>
        <Text style={styles.verdict}>{verdict}</Text>
        <Text style={[styles.payout, !paid && styles.payoutPractice]}>
          {payoutLine}
        </Text>
        {walletLine ? <Text style={styles.wallet}>{walletLine}</Text> : null}

        <View
          testID="receipt"
          style={styles.receipt}
          accessibilityLabel={liveOrder ? credit.liveOrder : "Receipt"}
        >
          <View style={styles.receiptHeader}>
            <Text style={styles.receiptTitle}>
              {liveOrder ? credit.liveOrder : "Receipt"}
            </Text>
            <View style={[styles.modeTag, paid && styles.modeTagPaid]}>
              <Text
                style={[styles.modeTagText, paid && styles.modeTagTextPaid]}
              >
                {paid ? "Paid" : "Practice"}
              </Text>
            </View>
          </View>
          <View style={styles.receiptRows}>
            <ReceiptRow label="Mode" value={paid ? "Paid" : "Practice"} />
            <ReceiptRow label="Order id" value={receipt?.orderId ?? "none"} />
            <ReceiptRow
              label="Status"
              value={receipt ? receipt.status.replace("_", " ") : "not placed"}
            />
            <ReceiptRow
              label="Contracts"
              value={formatContracts(
                receipt ? receipt.contracts : reveal.contracts,
              )}
            />
            {receipt ? (
              <ReceiptRow label="Price" value={formatPrice(receipt.price)} />
            ) : null}
          </View>
        </View>
      </Animated.View>
    </View>
  );
}

/** A percentage that counts up on the UI thread. No React state per frame. */
function CountUp({ value, align }: { value: number; align: "left" | "right" }) {
  const v = useSharedValue(0);
  useEffect(() => {
    v.set(0);
    v.set(
      withTiming(value, {
        duration: motion.countMs,
        easing: Easing.out(Easing.cubic),
      }),
    );
  }, [value, v]);
  const animatedProps = useAnimatedProps(
    () =>
      ({
        text: `${Math.round(v.get())}%`,
      }) as unknown as Partial<TextInputProps>,
  );
  return (
    <AnimatedTextInput
      editable={false}
      scrollEnabled={false}
      underlineColorAndroid="transparent"
      defaultValue="0%"
      maxFontSizeMultiplier={1.2}
      accessibilityLabel={`${Math.round(value)} percent`}
      style={[styles.hero, align === "right" && styles.heroRight]}
      animatedProps={animatedProps}
    />
  );
}

function YouTag() {
  return (
    <View style={styles.youTag}>
      <Text style={styles.youTagText}>You</Text>
    </View>
  );
}

function ReceiptRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.receiptRow}>
      <Text style={styles.receiptLabel}>{label}</Text>
      <Text
        style={styles.receiptValue}
        numberOfLines={1}
        ellipsizeMode="middle"
      >
        {value}
      </Text>
    </View>
  );
}

function clampPct(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, n));
}

const styles = StyleSheet.create({
  backdrop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.overlay,
  },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: "92%",
    backgroundColor: colors.card,
    borderTopLeftRadius: radii.sheet,
    borderTopRightRadius: radii.sheet,
    paddingHorizontal: space.xxl,
    paddingTop: space.md,
    ...shadows.sheet,
  },
  grabber: {
    alignSelf: "center",
    width: 40,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.lineStrong,
    marginBottom: space.lg,
  },
  content: { gap: space.md, paddingBottom: space.lg },
  callRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  callLabel: { ...type.caption, color: colors.ink2 },
  question: { ...type.heading, color: colors.ink2, marginBottom: space.sm },
  pending: { alignItems: "center", gap: space.md, paddingVertical: space.xxl },
  pendingTitle: {
    ...type.title,
    fontSize: 22,
    lineHeight: 26,
    textAlign: "center",
  },
  pendingHint: { ...type.small, textAlign: "center", maxWidth: 280 },
  errorText: {
    ...type.heading,
    textAlign: "center",
    paddingVertical: space.xxl,
  },
  bodyGap: { gap: space.lg },
  marketLabel: { ...type.caption, color: colors.ink2 },
  numbers: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    gap: space.md,
  },
  numberCol: { flex: 1, gap: space.xs },
  numberColRight: { alignItems: "flex-end" },
  hero: {
    ...type.hero,
    height: 66,
    padding: 0,
    margin: 0,
    width: "100%",
    textAlign: "left",
  },
  heroRight: { textAlign: "right" },
  sideRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  sideRowRight: { justifyContent: "flex-end" },
  sideKey: { width: 10, height: 10, borderRadius: 3 },
  sideName: { ...type.label },
  bar: {
    flexDirection: "row",
    height: 16,
    borderRadius: radii.pill,
    overflow: "hidden",
    backgroundColor: colors.paperDeep,
  },
  barYes: {
    height: "100%",
    backgroundColor: colors.yes,
    borderTopLeftRadius: radii.pill,
    borderBottomLeftRadius: radii.pill,
  },
  barGap: { width: 2, height: "100%", backgroundColor: colors.card },
  barNo: {
    flex: 1,
    height: "100%",
    backgroundColor: colors.no,
    borderTopRightRadius: radii.pill,
    borderBottomRightRadius: radii.pill,
  },
  youTag: {
    paddingHorizontal: 7,
    height: 18,
    borderRadius: radii.pill,
    backgroundColor: colors.ink,
    alignItems: "center",
    justifyContent: "center",
  },
  youTagText: {
    fontSize: 10,
    lineHeight: 12,
    fontWeight: "800",
    letterSpacing: 0.6,
    color: colors.onInk,
  },
  verdict: {
    ...type.title,
    fontSize: 22,
    lineHeight: 27,
    fontVariant: ["tabular-nums"],
  },
  payout: {
    ...type.heading,
    color: colors.accentDeep,
    fontVariant: ["tabular-nums"],
  },
  payoutPractice: { color: colors.ink2 },
  wallet: {
    ...type.small,
    fontVariant: ["tabular-nums"],
    marginTop: -space.sm,
  },
  receipt: {
    borderRadius: radii.tile,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.paper,
    paddingHorizontal: space.lg,
    paddingBottom: space.md,
  },
  receiptHeader: {
    minHeight: hit.min,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.md,
  },
  receiptTitle: { ...type.heading, fontSize: 15, flexShrink: 1 },
  modeTag: {
    height: 22,
    paddingHorizontal: space.sm,
    borderRadius: 6,
    backgroundColor: colors.paperDeep,
    alignItems: "center",
    justifyContent: "center",
  },
  modeTagPaid: { backgroundColor: colors.accent },
  modeTagText: { ...type.caption, color: colors.ink2 },
  modeTagTextPaid: { color: colors.onAccent },
  receiptRows: { gap: 6 },
  receiptRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: space.lg,
  },
  receiptLabel: { ...type.mono, color: colors.ink2 },
  receiptValue: { ...type.mono, flexShrink: 1, textAlign: "right" },
  actions: { flexDirection: "row", gap: space.md, marginTop: space.sm },
  ghost: {
    flex: 1,
    minHeight: 56,
    borderRadius: radii.button,
    borderWidth: 1.5,
    borderColor: colors.lineStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  ghostText: { ...type.heading, color: colors.ink },
  next: {
    marginTop: space.sm,
    minHeight: 56,
    borderRadius: radii.button,
    backgroundColor: colors.ink,
    alignItems: "center",
    justifyContent: "center",
  },
  nextHalf: { flex: 1, marginTop: 0 },
  nextDisabled: { opacity: 0.4 },
  nextText: { ...type.heading, color: colors.onInk, fontSize: 18 },
  pressed: { opacity: 0.8 },
});
