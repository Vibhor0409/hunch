// Leaderboard: counters from the database and ranked rows. Settles before it loads.

import { useFocusEffect } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { FlatList, RefreshControl, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { formatEdge, formatInt } from "@/components/format";
import { usePlayer } from "@/components/PlayerContext";
import { EmptyView, ErrorView, LoadingView } from "@/components/StateViews";
import { errorMessage, getLeaderboard, settle, type LeaderboardResponse } from "@/lib/api";
import { colors, radii, space, type } from "@/lib/theme";
import type { LeaderboardRow } from "@/lib/types";

type Phase = "loading" | "ready" | "error";

export default function LeaderboardScreen() {
  const { playerId } = usePlayer();
  const [data, setData] = useState<LeaderboardResponse | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const hasData = useRef(false);

  const load = useCallback(
    async (pull: boolean) => {
      if (pull) setRefreshing(true);
      else if (!hasData.current) setPhase("loading");
      try {
        await settle().catch(() => {});
        const res = await getLeaderboard();
        hasData.current = true;
        setData(res);
        setNotice("");
        setPhase("ready");
      } catch (err) {
        if (hasData.current) setNotice(errorMessage(err));
        else {
          setError(errorMessage(err));
          setPhase("error");
        }
      } finally {
        setRefreshing(false);
      }
    },
    [],
  );

  useFocusEffect(
    useCallback(() => {
      load(false);
    }, [load]),
  );

  return (
    <SafeAreaView style={styles.screen} edges={["top", "left", "right"]}>
      <Text style={styles.title}>Leaderboard</Text>
      {phase === "loading" ? <LoadingView /> : null}
      {phase === "error" ? <ErrorView message={error} onRetry={() => load(true)} refreshing={refreshing} /> : null}
      {phase === "ready" && data ? (
        <FlatList
          data={data.rows}
          keyExtractor={(row) => row.playerId}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={colors.accent} />}
          ListHeaderComponent={
            <View style={styles.headerGap}>
              {notice ? <Text style={styles.notice}>{notice}</Text> : null}
              <View testID="counters" style={styles.counters}>
                <Counter label="Players" value={data.counters.players} />
                <Counter label="Calls" value={data.counters.calls} />
                <Counter label="Gemini orders" value={data.counters.geminiOrders} />
              </View>
            </View>
          }
          ListEmptyComponent={<EmptyView title="No players yet." hint="Be the first to make a call." />}
          renderItem={({ item }) => <Row row={item} me={item.playerId === playerId} />}
        />
      ) : null}
    </SafeAreaView>
  );
}

function Counter({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.counter}>
      <Text style={styles.counterValue}>{formatInt(value)}</Text>
      <Text style={styles.counterLabel}>{label}</Text>
    </View>
  );
}

function Row({ row, me }: { row: LeaderboardRow; me: boolean }) {
  const edgeColor = row.edgeTotal > 0 ? colors.accent : row.edgeTotal < 0 ? colors.loss : colors.muted;
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
          {formatInt(row.settledCalls)} settled {"·"} Level {row.level}
        </Text>
      </View>
      <Text style={[styles.edge, { color: edgeColor }]}>{formatEdge(row.edgeTotal)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  title: { ...type.title, paddingHorizontal: space.xl, paddingTop: space.sm, paddingBottom: space.md },
  list: { paddingHorizontal: space.xl, paddingBottom: space.huge, flexGrow: 1 },
  headerGap: { gap: space.md, marginBottom: space.md },
  notice: { ...type.small, color: colors.loss },
  counters: {
    flexDirection: "row",
    gap: space.sm,
  },
  counter: {
    flex: 1,
    paddingVertical: space.md,
    paddingHorizontal: space.md,
    borderRadius: radii.tile,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
  },
  counterValue: { ...type.title, fontVariant: ["tabular-nums"] },
  counterLabel: { ...type.label, marginTop: 2 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    minHeight: 60,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    borderRadius: radii.tile,
    marginBottom: space.xs,
  },
  rowMe: { backgroundColor: colors.accentSoft },
  rank: { ...type.heading, color: colors.muted, width: 28, textAlign: "right", fontVariant: ["tabular-nums"] },
  rowBody: { flex: 1 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: space.sm },
  name: { ...type.heading, flexShrink: 1 },
  youTag: { ...type.label, color: colors.accent, fontSize: 11 },
  meta: { ...type.small, fontVariant: ["tabular-nums"] },
  edge: { ...type.title, fontVariant: ["tabular-nums"] },
});
