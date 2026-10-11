// Leaderboard: counters from the database, a podium for the top three, ranked rows,
// and your own row pinned at the bottom. Settlement runs alongside the load, never before it.

import { useFocusEffect } from "expo-router";
import { memo, useCallback, useRef, useState } from "react";
import { FlatList, RefreshControl, StyleSheet, Text, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { count, formatEdge, formatInt, formatOrdinal } from "@/components/format";
import { usePlayer } from "@/components/PlayerContext";
import { Podium } from "@/components/Podium";
import { EmptyView, ErrorView, LoadingView } from "@/components/StateViews";
import { errorMessage, getLeaderboard, isAbort, settle, type LeaderboardResponse } from "@/lib/api";
import { colors, radii, shadows, space, type } from "@/lib/theme";
import type { LeaderboardRow } from "@/lib/types";

type Phase = "loading" | "ready" | "error";

export default function LeaderboardScreen() {
  const { playerId } = usePlayer();
  const insets = useSafeAreaInsets();
  const [data, setData] = useState<LeaderboardResponse | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const hasData = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  const fetchRows = useCallback(async (pull: boolean) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    if (pull) setRefreshing(true);
    else if (!hasData.current) setPhase("loading");
    try {
      const res = await getLeaderboard(controller.signal);
      if (controller.signal.aborted) return;
      hasData.current = true;
      setData(res);
      setNotice("");
      setPhase("ready");
    } catch (err) {
      if (isAbort(err)) return;
      if (hasData.current) setNotice(errorMessage(err));
      else {
        setError(errorMessage(err));
        setPhase("error");
      }
    } finally {
      if (!controller.signal.aborted) setRefreshing(false);
    }
  }, []);

  // Load now; settle in parallel and reload if anything settled.
  const load = useCallback(
    (pull: boolean) => {
      fetchRows(pull);
      settle()
        .then((res) => {
          if (res.settled > 0) fetchRows(false);
        })
        .catch(() => {});
    },
    [fetchRows],
  );

  useFocusEffect(
    useCallback(() => {
      load(false);
      return () => abortRef.current?.abort();
    }, [load]),
  );

  const renderItem = useCallback(
    ({ item }: { item: LeaderboardRow }) => <Row row={item} me={item.playerId === playerId} />,
    [playerId],
  );

  const rows = data?.rows ?? [];
  const top = rows.slice(0, 3);
  const rest = rows.slice(3);
  const mine = rows.find((r) => r.playerId === playerId) ?? null;
  const pinnedHeight = mine ? 72 + insets.bottom : 0;

  return (
    <SafeAreaView style={styles.screen} edges={["top", "left", "right"]}>
      {phase === "loading" ? <LoadingView label="Ranking players" /> : null}
      {phase === "error" ? <ErrorView message={error} onRetry={() => load(true)} refreshing={refreshing} /> : null}
      {phase === "ready" && data ? (
        <>
          <FlatList
            data={rest}
            keyExtractor={keyExtractor}
            contentContainerStyle={[styles.list, { paddingBottom: space.huge + pinnedHeight }]}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={colors.ink2} />}
            ListHeaderComponent={
              <View style={styles.headerGap}>
                <Text style={styles.title}>Leaderboard</Text>
                {notice ? <Text style={styles.notice}>{notice}</Text> : null}
                <View testID="counters" style={styles.counters}>
                  <Counter label="Players" value={data.counters.players} />
                  <View style={styles.counterDivider} />
                  <Counter label="Calls" value={data.counters.calls} />
                  <View style={styles.counterDivider} />
                  <Counter label="Gemini orders" value={data.counters.geminiOrders} />
                </View>
                {top.length > 0 ? <Podium rows={top} myId={playerId} /> : null}
                {rest.length > 0 ? <Text style={styles.sectionLabel}>Everyone else</Text> : null}
              </View>
            }
            ListEmptyComponent={
              top.length === 0 ? <EmptyView title="No players yet." hint="Be the first to make a call." /> : null
            }
            renderItem={renderItem}
            initialNumToRender={12}
            windowSize={7}
            removeClippedSubviews
          />
          {mine ? (
            <View style={[styles.pinned, { paddingBottom: insets.bottom + space.sm }]} pointerEvents="box-none">
              <View style={styles.pinnedCard} accessibilityLabel={`You are ${formatOrdinal(mine.rank)}`}>
                <Text style={styles.pinnedRank}>{formatOrdinal(mine.rank)}</Text>
                <View style={styles.pinnedBody}>
                  <Text style={styles.pinnedName} numberOfLines={1}>
                    {mine.name}
                  </Text>
                  <Text style={styles.pinnedMeta}>
                    {count("settled call", mine.settledCalls)}, Level {mine.level}
                  </Text>
                </View>
                <Text style={[styles.pinnedEdge, mine.edgeTotal > 0 && styles.edgePositive]}>{formatEdge(mine.edgeTotal)}</Text>
              </View>
            </View>
          ) : null}
        </>
      ) : null}
    </SafeAreaView>
  );
}

function keyExtractor(row: LeaderboardRow): string {
  return row.playerId;
}

const Counter = memo(function Counter({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.counter}>
      <Text style={styles.counterValue}>{formatInt(value)}</Text>
      <Text style={styles.counterLabel}>{label}</Text>
    </View>
  );
});

const Row = memo(function Row({ row, me }: { row: LeaderboardRow; me: boolean }) {
  return (
    <View testID="leaderboard-row" style={[styles.row, me && styles.rowMe]}>
      <Text style={styles.rank}>{row.rank}</Text>
      <View style={styles.rowBody}>
        <View style={styles.nameRow}>
          <Text style={styles.name} numberOfLines={1}>
            {row.name}
          </Text>
          {me ? <Text style={styles.youTag}>You</Text> : null}
        </View>
        <Text style={styles.meta}>
          {count("settled call", row.settledCalls)}, Level {row.level}
        </Text>
      </View>
      <Text style={[styles.edge, row.edgeTotal > 0 && styles.edgePositive]}>{formatEdge(row.edgeTotal)}</Text>
    </View>
  );
});

const styles = StyleSheet.create({
  screen: { flex: 1 },
  title: { ...type.title, paddingTop: space.sm },
  list: { paddingHorizontal: space.xl, flexGrow: 1 },
  headerGap: { gap: space.lg, marginBottom: space.sm },
  notice: { ...type.small, color: colors.no },
  counters: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.lineStrong,
  },
  counter: { flex: 1, alignItems: "center", gap: 2 },
  counterDivider: { width: StyleSheet.hairlineWidth, height: 32, backgroundColor: colors.lineStrong },
  counterValue: { ...type.stat, fontSize: 24, lineHeight: 28 },
  counterLabel: { ...type.caption, color: colors.ink2 },
  sectionLabel: { ...type.caption, color: colors.ink2, marginTop: space.xs },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    minHeight: 60,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    borderRadius: radii.tile,
  },
  rowMe: { backgroundColor: colors.accentSoft },
  rank: { ...type.heading, color: colors.ink3, width: 30, textAlign: "right", fontVariant: ["tabular-nums"] },
  rowBody: { flex: 1 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: space.sm },
  name: { ...type.heading, flexShrink: 1 },
  youTag: { ...type.caption, color: colors.accentDeep },
  meta: { ...type.caption, fontVariant: ["tabular-nums"] },
  edge: { ...type.title, fontSize: 22, lineHeight: 26, fontVariant: ["tabular-nums"] },
  edgePositive: { color: colors.accentDeep },
  pinned: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: space.xl },
  pinnedCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    minHeight: 64,
    paddingHorizontal: space.lg,
    borderRadius: radii.tile,
    backgroundColor: colors.ink,
    ...shadows.card,
  },
  pinnedRank: { ...type.heading, color: colors.accent, fontVariant: ["tabular-nums"], minWidth: 36 },
  pinnedBody: { flex: 1 },
  pinnedName: { ...type.heading, color: colors.onInk },
  pinnedMeta: { ...type.caption, color: colors.lineStrong, fontVariant: ["tabular-nums"] },
  pinnedEdge: { ...type.title, fontSize: 22, lineHeight: 26, color: colors.onInk, fontVariant: ["tabular-nums"] },
});
