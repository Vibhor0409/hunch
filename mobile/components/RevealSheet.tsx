// The reveal: a bottom sheet over the deck. The market's split springs in,
// then the receipt for the real sandbox order. This is the hero moment.

import * as Haptics from "expo-haptics";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { formatContracts, formatDollars, formatPct, formatPrice } from "@/components/format";
import { colors, credit, hit, motion, radii, space, springs, type } from "@/lib/theme";
import type { Reveal, Side } from "@/lib/types";

export type SheetState =
  | { kind: "pending"; side: Side; question: string }
  | { kind: "ready"; side: Side; question: string; reveal: Reveal }
  | { kind: "error"; side: Side; question: string; message: string };

const SHEET_TRAVEL = 640;

export function RevealSheet({ state, onNext }: { state: SheetState | null; onNext: () => void }) {
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
    } else {
      progress.set(withTiming(0, { duration: motion.fadeMs }));
      const t = setTimeout(() => setRendered(null), motion.fadeMs + 20);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [state, progress]);

  useEffect(() => {
    if (state?.kind === "ready") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    }
  }, [state]);

  const backdropStyle = useAnimatedStyle(() => ({ opacity: progress.get() }));
  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: (1 - progress.get()) * SHEET_TRAVEL }],
  }));

  if (!rendered) return null;

  return (
    <View style={StyleSheet.absoluteFill}>
      <Animated.View style={[styles.backdrop, backdropStyle]} />
      <Animated.View
        testID="reveal"
        style={[styles.sheet, { paddingBottom: insets.bottom + space.lg }, sheetStyle]}
      >
        <View style={styles.grabber} />
        <ScrollView bounces={false} showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          <View style={styles.callRow}>
            <Text style={type.label}>Your call</Text>
            <SideTag side={rendered.side} />
          </View>
          <Text style={styles.question} numberOfLines={3}>
            {rendered.question}
          </Text>

          {rendered.kind === "pending" ? (
            <View style={styles.pending}>
              <ActivityIndicator color={colors.accent} />
              <Text style={type.small}>Reading the market</Text>
            </View>
          ) : null}

          {rendered.kind === "error" ? (
            <View style={styles.pending}>
              <Text style={[type.heading, styles.centerText]}>{rendered.message}</Text>
            </View>
          ) : null}

          {rendered.kind === "ready" ? <RevealBody reveal={rendered.reveal} /> : null}
        </ScrollView>

        <Pressable
          testID="btn-next"
          accessibilityRole="button"
          onPress={onNext}
          disabled={rendered.kind === "pending"}
          style={({ pressed }) => [
            styles.next,
            rendered.kind === "pending" && styles.nextDisabled,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.nextText}>Next</Text>
        </Pressable>
      </Animated.View>
    </View>
  );
}

function SideTag({ side }: { side: Side }) {
  const yes = side === "yes";
  return (
    <View style={[styles.sideTag, { borderColor: yes ? colors.yes : colors.no }]}>
      <Text style={[styles.sideTagText, { color: yes ? colors.yes : colors.no }]}>{yes ? "YES" : "NO"}</Text>
    </View>
  );
}

function RevealBody({ reveal }: { reveal: Reveal }) {
  const [open, setOpen] = useState(false);
  const yesWidth = useSharedValue(50);
  const fade = useSharedValue(0);

  useEffect(() => {
    yesWidth.set(50);
    fade.set(0);
    yesWidth.set(withSpring(clampPct(reveal.yesPct), springs.reveal));
    fade.set(withTiming(1, { duration: 320 }));
  }, [reveal, yesWidth, fade]);

  const yesStyle = useAnimatedStyle(() => ({ width: `${yesWidth.get()}%` }));
  const fadeStyle = useAnimatedStyle(() => ({ opacity: fade.get() }));

  const chosenYes = reveal.side === "yes";
  const paid = reveal.mode === "paid";
  const receipt = reveal.receipt;

  return (
    <View style={styles.bodyGap}>
      <Text style={type.label}>The market says</Text>

      <View style={styles.barLabels}>
        <View style={styles.barLabelGroup}>
          <Text style={[styles.barLabel, { color: colors.yes }]}>YES {formatPct(reveal.yesPct)}</Text>
          {chosenYes ? <YouTag /> : null}
        </View>
        <View style={[styles.barLabelGroup, styles.barLabelRight]}>
          {!chosenYes ? <YouTag /> : null}
          <Text style={[styles.barLabel, { color: colors.no }]}>NO {formatPct(reveal.noPct)}</Text>
        </View>
      </View>

      <View style={styles.bar}>
        <Animated.View style={[styles.barYes, yesStyle]} />
        <View style={styles.barNo} />
      </View>

      <Animated.View style={[styles.bodyGap, fadeStyle]}>
        <Text style={styles.sided}>You sided with {formatPct(reveal.sidedWithPct)} of the market</Text>

        <Text style={styles.payout}>
          {paid
            ? `${formatDollars(reveal.stake)} returns ${formatDollars(reveal.payoutIfRight)} if right`
            : "Practice call. Scores Edge only."}
        </Text>

        <View style={styles.receipt}>
          <Pressable
            testID="receipt"
            accessibilityRole="button"
            accessibilityState={{ expanded: open }}
            onPress={() => setOpen((v) => !v)}
            style={styles.receiptHeader}
            hitSlop={6}
          >
            <Text style={type.heading}>Receipt</Text>
            <Text style={styles.receiptToggle}>{open ? "Hide" : "Show"}</Text>
          </Pressable>

          {open ? (
            <View style={styles.receiptRows}>
              <ReceiptRow label="Mode" value={paid ? "Paid" : "Practice"} />
              <ReceiptRow label="Order id" value={receipt?.orderId ?? "none"} />
              <ReceiptRow label="Status" value={receipt ? receipt.status.replace("_", " ") : "not placed"} />
              <ReceiptRow label="Contracts" value={formatContracts(receipt ? receipt.contracts : reveal.contracts)} />
              {receipt ? <ReceiptRow label="Price" value={formatPrice(receipt.price)} /> : null}
              {receipt?.message ? <Text style={styles.receiptMessage}>{receipt.message}</Text> : null}
              {receipt?.orderId ? <Text style={styles.receiptTag}>{credit.liveOrder}</Text> : null}
            </View>
          ) : null}
        </View>
      </Animated.View>
    </View>
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
      <Text style={styles.receiptValue} numberOfLines={1} ellipsizeMode="middle">
        {value}
      </Text>
    </View>
  );
}

function clampPct(n: number): number {
  if (!Number.isFinite(n)) return 50;
  return Math.min(100, Math.max(0, n));
}

const styles = StyleSheet.create({
  backdrop: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: colors.overlay },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: "88%",
    backgroundColor: colors.surfaceRaised,
    borderTopLeftRadius: radii.sheet,
    borderTopRightRadius: radii.sheet,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: space.xxl,
    paddingTop: space.md,
  },
  grabber: {
    alignSelf: "center",
    width: 40,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.lineStrong,
    marginBottom: space.lg,
  },
  content: { gap: space.lg, paddingBottom: space.lg },
  callRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  question: { ...type.heading, color: colors.muted },
  pending: { alignItems: "center", gap: space.md, paddingVertical: space.xxl },
  centerText: { textAlign: "center" },
  sideTag: { borderWidth: 2, borderRadius: 6, paddingHorizontal: space.sm, paddingVertical: 2 },
  sideTagText: { fontSize: 13, fontWeight: "800", letterSpacing: 1.2 },
  bodyGap: { gap: space.lg },
  barLabels: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  barLabelGroup: { flexDirection: "row", alignItems: "center", gap: space.sm },
  barLabelRight: { justifyContent: "flex-end" },
  barLabel: { ...type.title, fontSize: 24, fontVariant: ["tabular-nums"] },
  bar: {
    flexDirection: "row",
    height: 28,
    borderRadius: radii.chip,
    overflow: "hidden",
    backgroundColor: colors.line,
  },
  barYes: { height: "100%", backgroundColor: colors.yes },
  barNo: { flex: 1, height: "100%", backgroundColor: colors.no },
  youTag: {
    paddingHorizontal: space.sm,
    paddingVertical: 2,
    borderRadius: radii.chip,
    backgroundColor: colors.lineStrong,
  },
  youTagText: { ...type.label, color: colors.paper, fontSize: 11 },
  sided: { ...type.body, fontVariant: ["tabular-nums"] },
  payout: { ...type.heading, fontVariant: ["tabular-nums"] },
  receipt: {
    borderRadius: radii.tile,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    paddingHorizontal: space.lg,
  },
  receiptHeader: {
    minHeight: hit.min,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  receiptToggle: { ...type.small, color: colors.accent, fontWeight: "600" },
  receiptRows: { paddingBottom: space.md, gap: 6 },
  receiptRow: { flexDirection: "row", justifyContent: "space-between", gap: space.lg },
  receiptLabel: { ...type.mono, color: colors.muted },
  receiptValue: { ...type.mono, flexShrink: 1, textAlign: "right" },
  receiptMessage: { ...type.small, color: colors.paper, marginTop: space.xs },
  receiptTag: { ...type.label, color: colors.faint, marginTop: space.xs },
  next: {
    marginTop: space.sm,
    minHeight: 56,
    borderRadius: radii.button,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  nextDisabled: { opacity: 0.4 },
  nextText: { ...type.heading, color: colors.onAccent, fontSize: 18 },
  pressed: { opacity: 0.8 },
});
