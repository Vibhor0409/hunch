// Deck: the header, lane control, a stack of three slips, three buttons and the reveal.
// The feed loads as soon as the player is known, lane changes cancel the request they
// replace, the next lane is fetched while the deck is idle, and at most 20 cards sit in state.

import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSharedValue } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";

import { BrandStrip } from "@/components/BrandStrip";
import { CardSkeleton } from "@/components/CardSkeleton";
import { formatInt, formatMoney } from "@/components/format";
import { HunchMark } from "@/components/HunchMark";
import { LaneChips, nextLane } from "@/components/LaneChips";
import { usePlayer } from "@/components/PlayerContext";
import { RevealSheet, type SheetState } from "@/components/RevealSheet";
import { SessionToggle, useSessionMode } from "@/components/SessionMode";
import { EmptyView, ErrorView } from "@/components/StateViews";
import { SwipeCard, type SwipeCardHandle } from "@/components/SwipeCard";
import { isHidden, markSkipped, markSwiped } from "@/components/session";
import { ApiError, errorMessage, getFeed, isAbort, swipe as postSwipe, type FeedResponse } from "@/lib/api";
import { colors, hit, radii, shadows, space, type } from "@/lib/theme";
import type { CardPublic, LaneFilter, PlayerStatus, Side } from "@/lib/types";

type Phase = "loading" | "ready" | "error";

const VISIBLE = 3;
const MAX_CARDS = 20;
const REFILL_AT = 4;
const CLOCK_MS = 15_000;
const CACHE_TTL_MS = 60_000;
const PREFETCH_DELAY_MS = 900;

interface CacheEntry {
  res: FeedResponse;
  at: number;
}

export default function DeckScreen() {
  const { playerId } = usePlayer();
  const { mode: sessionMode } = useSessionMode();
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
  const [flipped, setFlipped] = useState(false);

  const topRef = useRef<SwipeCardHandle>(null);
  const requestId = useRef(0);
  const cache = useRef(new Map<LaneFilter, CacheEntry>());
  const inflight = useRef(new Map<LaneFilter, Promise<FeedResponse>>());
  const refilling = useRef(false);
  const cardsRef = useRef<CardPublic[]>(cards);
  useEffect(() => {
    cardsRef.current = cards;
  }, [cards]);
  // The session mode is read at swipe time through a ref, so flipping the toggle
  // changes nothing the card stack receives.
  const sessionModeRef = useRef(sessionMode);
  useEffect(() => {
    sessionModeRef.current = sessionMode;
  }, [sessionMode]);

  // How far the top card has travelled toward a commit. The cards behind read it.
  const topProgress = useSharedValue(0);

  // Clock for "closes in 4m".
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), CLOCK_MS);
    return () => clearInterval(t);
  }, []);

  const applyFeed = useCallback((res: FeedResponse) => {
    setCards(res.cards.filter((c) => !isHidden(c.instrumentSymbol)).slice(0, MAX_CARDS));
    setStatus(res.status);
    setExhausted(false);
    setError("");
    setPhase("ready");
  }, []);

  // One fetch per lane at a time. Results land in the cache for instant lane switches.
  const fetchLane = useCallback(
    (target: LaneFilter, signal?: AbortSignal): Promise<FeedResponse> => {
      if (!playerId) return Promise.reject(new ApiError("offline"));
      const existing = inflight.current.get(target);
      if (existing) return existing;
      const p = getFeed(target, playerId, signal)
        .then((res) => {
          cache.current.set(target, { res, at: Date.now() });
          return res;
        })
        .finally(() => {
          inflight.current.delete(target);
        });
      inflight.current.set(target, p);
      return p;
    },
    [playerId],
  );

  const freshCache = useCallback((target: LaneFilter): FeedResponse | null => {
    const entry = cache.current.get(target);
    return entry && Date.now() - entry.at < CACHE_TTL_MS ? entry.res : null;
  }, []);

  const resetDeck = useCallback(() => {
    setPhase("loading");
    setError("");
    setCards([]);
    setExhausted(false);
    setSheet(null);
    setFlipped(false);
    topProgress.set(0);
  }, [topProgress]);

  const onLaneChange = useCallback(
    (next: LaneFilter) => {
      if (next === lane) return;
      requestId.current += 1; // anything in flight for the old lane is now stale
      setLane(next);
      setSheet(null);
      setFlipped(false);
      topProgress.set(0);
      const cached = freshCache(next);
      if (cached) applyFeed(cached);
      else resetDeck();
    },
    [lane, applyFeed, resetDeck, topProgress, freshCache],
  );

  const retry = useCallback(() => {
    cache.current.delete(lane);
    resetDeck();
    setReloadKey((k) => k + 1);
  }, [lane, resetDeck]);

  // Load the lane. A lane change or retry aborts the request it replaces.
  useEffect(() => {
    if (!playerId) return;
    // A fresh cache entry was already applied by the lane handler; nothing to fetch.
    if (freshCache(lane)) return;
    const id = ++requestId.current;
    const controller = new AbortController();
    fetchLane(lane, controller.signal)
      .then((res) => {
        if (id !== requestId.current) return;
        applyFeed(res);
      })
      .catch((err: unknown) => {
        if (id !== requestId.current || isAbort(err)) return;
        setError(errorMessage(err));
        setPhase("error");
      });
    return () => {
      controller.abort();
    };
  }, [lane, playerId, reloadKey, fetchLane, applyFeed, freshCache]);

  // Refill the same lane when the stack runs low. Stops once a fetch brings nothing new.
  useEffect(() => {
    if (phase !== "ready" || !playerId || exhausted || busy || refilling.current) return;
    if (cards.length > REFILL_AT) return;
    refilling.current = true;
    const id = requestId.current;
    getFeed(lane, playerId)
      .then((res) => {
        if (id !== requestId.current) return;
        cache.current.set(lane, { res, at: Date.now() });
        setStatus(res.status);
        const seen = new Set(cardsRef.current.map((c) => c.instrumentSymbol));
        const fresh = res.cards.filter((c) => !seen.has(c.instrumentSymbol) && !isHidden(c.instrumentSymbol));
        if (fresh.length === 0) {
          setExhausted(true);
          return;
        }
        setCards((current) => [...current, ...fresh.filter((c) => !current.some((x) => x.instrumentSymbol === c.instrumentSymbol))].slice(0, MAX_CARDS));
      })
      .catch(() => {
        // The stack keeps what it has; the next low point tries again.
      })
      .finally(() => {
        refilling.current = false;
      });
  }, [cards.length, phase, lane, playerId, exhausted, busy]);

  // Prefetch the next lane while the deck is idle, so switching feels instant.
  useEffect(() => {
    if (phase !== "ready" || !playerId || busy || sheet !== null) return;
    const target = nextLane(lane);
    if (freshCache(target)) return;
    const t = setTimeout(() => {
      fetchLane(target).catch(() => {});
    }, PREFETCH_DELAY_MS);
    return () => clearTimeout(t);
  }, [phase, lane, playerId, busy, sheet, fetchLane, freshCache]);

  const removeTop = useCallback(
    (symbol: string) => {
      topProgress.set(0);
      setCards((current) => current.filter((c) => c.instrumentSymbol !== symbol));
      setFlipped(false);
    },
    [topProgress],
  );

  const onCommit = useCallback(
    (card: CardPublic, side: Side) => {
      if (!playerId) return;
      setBusy(true);
      removeTop(card.instrumentSymbol);
      setSheet({ kind: "pending", card, side });
      postSwipe({
        playerId,
        eventTicker: card.eventTicker,
        instrumentSymbol: card.instrumentSymbol,
        side,
        mode: sessionModeRef.current,
      })
        .then((reveal) => {
          markSwiped(card.instrumentSymbol);
          setStatus(reveal.status);
          setSheet({ kind: "ready", card, side, reveal });
        })
        .catch((err: unknown) => {
          const final = err instanceof ApiError && (err.code === "already_swiped" || err.code === "market_closed");
          if (final) {
            markSwiped(card.instrumentSymbol);
            setSheet({ kind: "error", card, side, message: errorMessage(err), restorable: false });
            return;
          }
          // Put the card back on top so the call can be retried.
          setCards((current) =>
            current.some((c) => c.instrumentSymbol === card.instrumentSymbol) ? current : [card, ...current],
          );
          setSheet({ kind: "error", card, side, message: errorMessage(err), restorable: true });
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
  const onDismiss = useCallback(() => setSheet(null), []);
  const onRetry = useCallback((card: CardPublic, side: Side) => onCommit(card, side), [onCommit]);

  const actNo = useCallback(() => topRef.current?.fling("no"), []);
  const actSkip = useCallback(() => topRef.current?.fling("skip"), []);
  const actYes = useCallback(() => topRef.current?.fling("yes"), []);

  const interactive = phase === "ready" && cards.length > 0 && !busy && sheet === null && !flipped;
  const visible = cards.slice(0, VISIBLE);

  return (
    <SafeAreaView style={styles.screen} edges={["top", "left", "right"]}>
      <Header status={status} />
      <LaneChips value={lane} onChange={onLaneChange} disabled={busy || sheet !== null} />

      <View style={styles.stack}>
        {phase === "loading" ? <CardSkeleton label="Finding live markets" /> : null}
        {phase === "error" ? <ErrorView message={error} onRetry={retry} /> : null}
        {phase === "ready" && cards.length === 0 ? (
          <EmptyView title="Nothing left in this lane right now." hint="Try another lane, or come back in a few minutes." />
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
                  topProgress={topProgress}
                  onCommit={onCommit}
                  onSkip={onSkip}
                  onFlip={index === 0 ? setFlipped : undefined}
                />
              ))
              .reverse()
          : null}
      </View>

      <View style={styles.buttons}>
        <CallButton testID="btn-no" label="NO" color={colors.no} onPress={actNo} disabled={!interactive} />
        <Pressable
          testID="btn-skip"
          accessibilityRole="button"
          accessibilityLabel="Skip"
          accessibilityState={{ disabled: !interactive }}
          disabled={!interactive}
          onPress={actSkip}
          style={({ pressed }) => [styles.skip, !interactive && styles.disabled, pressed && styles.pressed]}
        >
          <Text style={styles.skipText}>Skip</Text>
        </Pressable>
        <CallButton testID="btn-yes" label="YES" color={colors.yes} onPress={actYes} disabled={!interactive} />
      </View>
      <BrandStrip variant="plain" style={styles.footer} />

      <RevealSheet state={sheet} onNext={onNext} onRetry={onRetry} onDismiss={onDismiss} />
    </SafeAreaView>
  );
}

const Header = memo(function Header({ status }: { status: PlayerStatus | null }) {
  const { mode: sessionMode } = useSessionMode();
  const practice = status !== null && status.paidLeftToday <= 0;
  const balance = status && typeof status.balance === "number" ? formatMoney(status.balance) : null;
  return (
    <View style={styles.header}>
      <View style={styles.headerRow}>
        <View style={styles.brand}>
          <HunchMark size={26} />
          <Text style={styles.wordmark}>Hunch</Text>
        </View>
        {status ? (
          <View style={styles.levelPill}>
            <Text style={styles.levelText}>Level {status.level}</Text>
          </View>
        ) : null}
      </View>
      <SessionToggle />
      <View style={styles.statsRow}>
        <View style={styles.stat}>
          <View style={styles.statLine}>
            <Text style={styles.statNumber}>{status ? `${formatInt(status.paidLeftToday)} of ${formatInt(status.dailyCap)}` : " "}</Text>
            {practice ? (
              <View style={styles.practiceBadge}>
                <Text style={styles.practiceBadgeText}>Practice</Text>
              </View>
            ) : null}
          </View>
          <Text style={styles.statLabel}>{practice ? "Practice calls still score Edge." : "Paid swipes left today"}</Text>
        </View>
        {balance ? (
          <View style={[styles.stat, styles.statRight]}>
            <View style={styles.statLine}>
              {sessionMode === "practice" ? (
                <View testID="mode-badge" style={styles.practiceBadge}>
                  <Text style={styles.practiceBadgeText}>Practice</Text>
                </View>
              ) : null}
              <Text style={styles.statNumber}>{balance}</Text>
            </View>
            <Text style={styles.statLabel}>Play money</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
});

const CallButton = memo(function CallButton({
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
});

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { paddingHorizontal: space.xl, paddingTop: space.sm, paddingBottom: space.md, gap: space.sm },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  brand: { flexDirection: "row", alignItems: "center", gap: space.sm },
  wordmark: { ...type.heading, fontSize: 19, letterSpacing: -0.4 },
  levelPill: {
    height: 28,
    paddingHorizontal: space.md,
    borderRadius: radii.pill,
    backgroundColor: colors.accentSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  levelText: { ...type.caption, color: colors.accentDeep, fontVariant: ["tabular-nums"] },
  statsRow: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: space.md, minHeight: 44 },
  stat: { gap: 1 },
  statRight: { alignItems: "flex-end" },
  statLine: { flexDirection: "row", alignItems: "center", gap: space.sm },
  statNumber: { ...type.stat, fontSize: 24, lineHeight: 28 },
  statLabel: { ...type.caption, color: colors.ink2 },
  practiceBadge: {
    height: 22,
    paddingHorizontal: space.sm,
    borderRadius: 6,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  practiceBadgeText: { ...type.caption, color: colors.onAccent },
  stack: { flex: 1, marginHorizontal: space.xl, marginTop: space.lg },
  buttons: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    paddingHorizontal: space.xl,
    paddingTop: space.xl,
    paddingBottom: space.sm,
  },
  call: {
    flex: 1,
    minHeight: 60,
    borderRadius: radii.button,
    borderWidth: 2.5,
    backgroundColor: colors.card,
    alignItems: "center",
    justifyContent: "center",
    ...shadows.tile,
  },
  callText: { fontSize: 18, fontWeight: "900", letterSpacing: 2 },
  skip: {
    minWidth: 72,
    minHeight: hit.min,
    borderRadius: radii.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.paperDeep,
  },
  skipText: { ...type.small, color: colors.ink, fontWeight: "700" },
  footer: { paddingBottom: space.sm },
  disabled: { opacity: 0.35 },
  pressed: { opacity: 0.75, transform: [{ scale: 0.98 }] },
});
