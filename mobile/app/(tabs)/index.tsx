// Deck: lane chips, the swipe limit header, the card stack, three buttons and the reveal.

import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { LaneChips } from "@/components/LaneChips";
import { usePlayer } from "@/components/PlayerContext";
import { RevealSheet, type SheetState } from "@/components/RevealSheet";
import { EmptyView, ErrorView, LoadingView } from "@/components/StateViews";
import { SwipeCard, type CardAction, type SwipeCardHandle } from "@/components/SwipeCard";
import { isHidden, markSkipped, markSwiped } from "@/components/session";
import { ApiError, errorMessage, getFeed, swipe as postSwipe } from "@/lib/api";
import { colors, hit, radii, space, type } from "@/lib/theme";
import type { CardPublic, LaneFilter, PlayerStatus, Side } from "@/lib/types";

type Phase = "loading" | "ready" | "error";

const PREFETCH_AT = 3;
const VISIBLE = 3;
const CLOCK_MS = 20_000;

export default function DeckScreen() {
  const { playerId } = usePlayer();
  const [lane, setLane] = useState<LaneFilter>("foryou");
  const [cards, setCards] = useState<CardPublic[]>([]);
  const [status, setStatus] = useState<PlayerStatus | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [error, setError] = useState("");
  const [sheet, setSheet] = useState<SheetState | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [exhausted, setExhausted] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const topRef = useRef<SwipeCardHandle>(null);
  const requestId = useRef(0);
  const prefetching = useRef(false);

  // Clock for "closes in 4m".
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), CLOCK_MS);
    return () => clearInterval(t);
  }, []);

  // Reset the deck synchronously (in the event handler), then the effect below fetches.
  const resetDeck = useCallback(() => {
    setPhase("loading");
    setError("");
    setCards([]);
    setExhausted(false);
    setSheet(null);
  }, []);

  const onLaneChange = useCallback(
    (next: LaneFilter) => {
      if (next === lane) return;
      setLane(next);
      resetDeck();
    },
    [lane, resetDeck],
  );

  const retry = useCallback(() => {
    resetDeck();
    setReloadKey((k) => k + 1);
  }, [resetDeck]);

  // Load the lane. State updates happen only after the response arrives.
  useEffect(() => {
    if (!playerId) return;
    const id = ++requestId.current;
    getFeed(lane, playerId)
      .then((res) => {
        if (id !== requestId.current) return;
        setCards(res.cards.filter((c) => !isHidden(c.instrumentSymbol)));
        setStatus(res.status);
        setPhase("ready");
      })
      .catch((err: unknown) => {
        if (id !== requestId.current) return;
        setError(errorMessage(err));
        setPhase("error");
      });
  }, [lane, playerId, reloadKey]);

  // Prefetch when the stack runs low. Stops once a fetch brings nothing new.
  useEffect(() => {
    if (phase !== "ready" || !playerId || exhausted || prefetching.current) return;
    if (cards.length > PREFETCH_AT) return;
    prefetching.current = true;
    const id = requestId.current;
    getFeed(lane, playerId)
      .then((res) => {
        if (id !== requestId.current) return;
        setStatus(res.status);
        setCards((current) => {
          const seen = new Set(current.map((c) => c.instrumentSymbol));
          const fresh = res.cards.filter((c) => !seen.has(c.instrumentSymbol) && !isHidden(c.instrumentSymbol));
          if (fresh.length === 0) setExhausted(true);
          return fresh.length ? [...current, ...fresh] : current;
        });
      })
      .catch(() => {
        // The stack keeps what it has; the next low point tries again.
      })
      .finally(() => {
        prefetching.current = false;
      });
  }, [cards.length, phase, lane, playerId, exhausted]);

  const removeTop = useCallback((symbol: string) => {
    setCards((current) => current.filter((c) => c.instrumentSymbol !== symbol));
  }, []);

  const onCommit = useCallback(
    (card: CardPublic, side: Side) => {
      if (!playerId) return;
      setBusy(true);
      removeTop(card.instrumentSymbol);
      setSheet({ kind: "pending", side, question: card.question });
      postSwipe({
        playerId,
        eventTicker: card.eventTicker,
        instrumentSymbol: card.instrumentSymbol,
        side,
      })
        .then((reveal) => {
          markSwiped(card.instrumentSymbol);
          setStatus(reveal.status);
          setSheet({ kind: "ready", side, question: card.question, reveal });
        })
        .catch((err: unknown) => {
          if (err instanceof ApiError && (err.code === "already_swiped" || err.code === "market_closed")) {
            markSwiped(card.instrumentSymbol);
          }
          setSheet({ kind: "error", side, question: card.question, message: errorMessage(err) });
        })
        .finally(() => setBusy(false));
    },
    [playerId, removeTop],
  );

  const onSkip = useCallback(
    (card: CardPublic) => {
      markSkipped(card.instrumentSymbol);
      removeTop(card.instrumentSymbol);
    },
    [removeTop],
  );

  const onNext = useCallback(() => setSheet(null), []);

  const act = (action: CardAction) => topRef.current?.fling(action);

  const interactive = phase === "ready" && cards.length > 0 && !busy && sheet === null;
  const visible = cards.slice(0, VISIBLE);

  return (
    <SafeAreaView style={styles.screen} edges={["top", "left", "right"]}>
      <Header status={status} />
      <LaneChips value={lane} onChange={onLaneChange} disabled={busy || sheet !== null} />

      <View style={styles.stack}>
        {phase === "loading" ? <LoadingView label="Finding live markets" /> : null}
        {phase === "error" ? <ErrorView message={error} onRetry={retry} /> : null}
        {phase === "ready" && cards.length === 0 ? (
          <EmptyView title="No markets in this lane right now." hint="Try another lane or pull again later." />
        ) : null}
        {phase === "ready"
          ? visible
              .map((card, index) => (
                <SwipeCard
                  key={card.instrumentSymbol}
                  ref={index === 0 ? topRef : undefined}
                  card={card}
                  index={index}
                  now={now}
                  enabled={index === 0 && interactive}
                  onCommit={(side) => onCommit(card, side)}
                  onSkip={() => onSkip(card)}
                />
              ))
              .reverse()
          : null}
      </View>

      <View style={styles.buttons}>
        <CallButton testID="btn-no" label="NO" color={colors.no} onPress={() => act("no")} disabled={!interactive} />
        <Pressable
          testID="btn-skip"
          accessibilityRole="button"
          accessibilityState={{ disabled: !interactive }}
          disabled={!interactive}
          onPress={() => act("skip")}
          style={({ pressed }) => [styles.skip, !interactive && styles.disabled, pressed && styles.pressed]}
        >
          <Text style={styles.skipText}>Skip</Text>
        </Pressable>
        <CallButton testID="btn-yes" label="YES" color={colors.yes} onPress={() => act("yes")} disabled={!interactive} />
      </View>

      <RevealSheet state={sheet} onNext={onNext} />
    </SafeAreaView>
  );
}

function Header({ status }: { status: PlayerStatus | null }) {
  if (!status) {
    return <View style={styles.header} />;
  }
  const practice = status.paidLeftToday <= 0;
  return (
    <View style={styles.header}>
      <View style={styles.headerRow}>
        <View>
          <Text style={type.label}>Paid swipes left today</Text>
          <Text style={styles.headerNumber}>
            {status.paidLeftToday} of {status.dailyCap}
          </Text>
        </View>
        <View style={styles.headerRight}>
          {practice ? (
            <View style={styles.practiceBadge}>
              <Text style={styles.practiceBadgeText}>Practice</Text>
            </View>
          ) : null}
          <Text style={styles.level}>Level {status.level}</Text>
        </View>
      </View>
      {practice ? <Text style={styles.practiceLine}>Practice calls still score Edge.</Text> : null}
    </View>
  );
}

function CallButton({
  testID,
  label,
  color,
  onPress,
  disabled,
}: {
  testID: string;
  label: string;
  color: string;
  onPress: () => void;
  disabled: boolean;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.call, { borderColor: color }, disabled && styles.disabled, pressed && styles.pressed]}
    >
      <Text style={[styles.callText, { color }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: { paddingHorizontal: space.xl, paddingTop: space.sm, paddingBottom: space.lg, minHeight: 72 },
  headerRow: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between" },
  headerNumber: { ...type.bigNumber, marginTop: 2 },
  headerRight: { alignItems: "flex-end", gap: space.xs },
  level: { ...type.heading, color: colors.muted, fontVariant: ["tabular-nums"] },
  practiceBadge: {
    paddingHorizontal: space.sm,
    paddingVertical: 2,
    borderRadius: radii.chip,
    backgroundColor: colors.accent,
  },
  practiceBadgeText: { ...type.label, color: colors.onAccent, fontSize: 11 },
  practiceLine: { ...type.small, color: colors.accent, marginTop: space.xs },
  stack: { flex: 1, marginHorizontal: space.xl, marginTop: space.lg },
  buttons: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    paddingHorizontal: space.xl,
    paddingTop: space.lg,
    paddingBottom: space.md,
  },
  call: {
    flex: 1,
    minHeight: 60,
    borderRadius: radii.button,
    borderWidth: 2,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  callText: { fontSize: 18, fontWeight: "800", letterSpacing: 1.5 },
  skip: {
    minWidth: 64,
    minHeight: hit.min,
    borderRadius: radii.chip,
    alignItems: "center",
    justifyContent: "center",
  },
  skipText: { ...type.small, color: colors.muted, fontWeight: "600" },
  disabled: { opacity: 0.35 },
  pressed: { opacity: 0.75 },
});
