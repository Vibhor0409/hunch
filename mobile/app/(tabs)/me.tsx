// Me: name, Edge total, the level bar, Edge by category, the insight line and Recent calls.
// Settles before it loads. Sections render only from real profile data.

import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { FlatList, RefreshControl, StyleSheet, Text, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";

import { CategoryBars } from "@/components/CategoryBars";
import { formatDollars, formatEdge } from "@/components/format";
import { LevelBar } from "@/components/LevelBar";
import { usePlayer } from "@/components/PlayerContext";
import { EmptyView, ErrorView, LoadingView } from "@/components/StateViews";
import { errorMessage, getProfile, settle } from "@/lib/api";
import { colors, credit, motion, radii, space, type } from "@/lib/theme";
import type { Profile, RecentCall } from "@/lib/types";

type Phase = "loading" | "ready" | "error";

export default function MeScreen() {
  const { playerId } = usePlayer();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const known = useRef<Map<string, RecentCall["result"]>>(new Map());
  const hasData = useRef(false);

  const load = useCallback(
    async (pull: boolean) => {
      if (!playerId) return;
      if (pull) setRefreshing(true);
      else if (!hasData.current) setPhase("loading");
      try {
        await settle().catch(() => {});
        const res = await getProfile(playerId);
        // Rows that were pending last time and are settled now get a short highlight.
        const settledNow = new Set<string>();
        for (const call of res.recent) {
          const before = known.current.get(call.instrumentSymbol);
          if (before === "pending" && call.result !== "pending") settledNow.add(call.instrumentSymbol);
          known.current.set(call.instrumentSymbol, call.result);
        }
        hasData.current = true;
        setProfile(res);
        setNotice("");
        setPhase("ready");
        if (settledNow.size) {
          setFresh(settledNow);
          setTimeout(() => setFresh(new Set()), motion.highlightMs);
        }
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
    [playerId],
  );

  useFocusEffect(
    useCallback(() => {
      load(false);
    }, [load]),
  );

  return (
    <SafeAreaView style={styles.screen} edges={["top", "left", "right"]}>
      {phase === "loading" ? <LoadingView /> : null}
      {phase === "error" ? <ErrorView message={error} onRetry={() => load(true)} refreshing={refreshing} /> : null}
      {phase === "ready" && profile ? (
        <FlatList
          data={profile.recent}
          keyExtractor={(call) => call.instrumentSymbol}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={colors.accent} />}
          ListHeaderComponent={
            <View style={styles.headerGap}>
              <View style={styles.identity}>
                <View style={styles.identityText}>
                  <Text style={type.title} numberOfLines={1}>
                    {profile.status.name}
                  </Text>
                  <Text style={styles.levelText}>Level {profile.status.level}</Text>
                </View>
                <View style={styles.edgeTile}>
                  <Text style={type.label}>Edge</Text>
                  <Text style={[styles.edgeTotal, { color: edgeColor(profile.edgeTotal) }]}>
                    {formatEdge(profile.edgeTotal)}
                  </Text>
                </View>
              </View>
              {notice ? <Text style={styles.notice}>{notice}</Text> : null}

              <LevelBar progress={profile.progress} />

              {profile.progress.settledCalls === 0 ? (
                <Text style={styles.fillIn}>Settled calls fill this in.</Text>
              ) : (
                <>
                  {profile.categories.length > 0 ? <CategoryBars categories={profile.categories} /> : null}
                  {profile.insight ? <Text style={styles.insight}>{profile.insight}</Text> : null}
                </>
              )}

              <Text style={[type.label, styles.sectionLabel]}>Recent calls</Text>
            </View>
          }
          ListEmptyComponent={<EmptyView title="No calls yet." hint="Swipe a card in the Deck." />}
          ListFooterComponent={<Text style={styles.footer}>{credit.builtOn}</Text>}
          renderItem={({ item }) => <CallRow call={item} highlight={fresh.has(item.instrumentSymbol)} />}
        />
      ) : null}
    </SafeAreaView>
  );
}

function edgeColor(edge: number): string {
  if (edge > 0) return colors.accent;
  if (edge < 0) return colors.loss;
  return colors.muted;
}

function CallRow({ call, highlight }: { call: RecentCall; highlight: boolean }) {
  const glow = useSharedValue(0);
  useEffect(() => {
    if (highlight) {
      glow.set(1);
      glow.set(withTiming(0, { duration: motion.highlightMs }));
    }
  }, [highlight, glow]);
  const glowStyle = useAnimatedStyle(() => ({
    backgroundColor: `rgba(255, 178, 36, ${0.18 * glow.get()})`,
  }));

  const yes = call.side === "yes";
  const result = call.result === "won" ? "Won" : call.result === "lost" ? "Lost" : "Pending";
  const resultColor = call.result === "won" ? colors.accent : call.result === "lost" ? colors.loss : colors.muted;
  const payout =
    call.result === "pending" || call.payout === null ? null : formatDollars(call.payout);

  return (
    <Animated.View testID="recent-call" style={[styles.call, glowStyle]}>
      <Text style={styles.question} numberOfLines={2}>
        {call.question}
      </Text>
      <View style={styles.callMeta}>
        <View style={[styles.sideTag, { borderColor: yes ? colors.yes : colors.no }]}>
          <Text style={[styles.sideTagText, { color: yes ? colors.yes : colors.no }]}>{yes ? "YES" : "NO"}</Text>
        </View>
        <Text style={styles.mode}>{call.mode === "paid" ? "Paid" : "Practice"}</Text>
        <Text style={[styles.result, { color: resultColor }]}>{result}</Text>
        <View style={styles.spacer} />
        {payout !== null ? <Text style={styles.payout}>{payout}</Text> : null}
        {call.edge !== null ? (
          <Text style={[styles.edge, { color: edgeColor(call.edge) }]}>{formatEdge(call.edge)}</Text>
        ) : null}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  list: { paddingHorizontal: space.xl, paddingTop: space.sm, paddingBottom: space.huge, flexGrow: 1 },
  headerGap: { gap: space.md, marginBottom: space.sm },
  identity: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.md },
  identityText: { flex: 1, gap: 2 },
  levelText: { ...type.small, fontVariant: ["tabular-nums"] },
  edgeTile: {
    alignItems: "flex-end",
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderRadius: radii.tile,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
  },
  edgeTotal: { ...type.bigNumber, fontSize: 28, lineHeight: 34 },
  notice: { ...type.small, color: colors.loss },
  fillIn: { ...type.small, color: colors.faint },
  insight: { ...type.body, color: colors.paper },
  sectionLabel: { marginTop: space.sm },
  call: {
    paddingVertical: space.md,
    paddingHorizontal: space.md,
    borderRadius: radii.tile,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
    gap: space.sm,
  },
  question: { ...type.body },
  callMeta: { flexDirection: "row", alignItems: "center", gap: space.sm },
  sideTag: { borderWidth: 1.5, borderRadius: 5, paddingHorizontal: 6, paddingVertical: 1 },
  sideTagText: { fontSize: 11, fontWeight: "800", letterSpacing: 1 },
  mode: { ...type.small },
  result: { ...type.small, fontWeight: "600" },
  spacer: { flex: 1 },
  payout: { ...type.small, color: colors.paper, fontVariant: ["tabular-nums"] },
  edge: { ...type.heading, fontVariant: ["tabular-nums"] },
  footer: { ...type.small, color: colors.faint, textAlign: "center", paddingVertical: space.xxl },
});
