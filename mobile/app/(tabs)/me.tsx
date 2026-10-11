// Me: name, the stats strip, the level card, Edge by category, the insight line and
// Recent calls. Settlement runs alongside the load. Sections render only from real profile data.

import { router, useFocusEffect } from "expo-router";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import Svg, { Circle, Line } from "react-native-svg";

import { BrandStrip } from "@/components/BrandStrip";
import { CategoryBars } from "@/components/CategoryBars";
import { formatDollars, formatEdge, formatMoney } from "@/components/format";
import { LevelBar } from "@/components/LevelBar";
import { usePlayer } from "@/components/PlayerContext";
import { Stamp } from "@/components/Stamp";
import { EmptyView, ErrorView, LoadingView } from "@/components/StateViews";
import { errorMessage, getProfile, isAbort, settle } from "@/lib/api";
import { colors, hit, motion, radii, space, type } from "@/lib/theme";
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
  const abortRef = useRef<AbortController | null>(null);

  const fetchProfile = useCallback(
    async (pull: boolean) => {
      if (!playerId) return;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      if (pull) setRefreshing(true);
      else if (!hasData.current) setPhase("loading");
      try {
        const res = await getProfile(playerId, controller.signal);
        if (controller.signal.aborted) return;
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
        if (isAbort(err)) return;
        if (hasData.current) setNotice(errorMessage(err));
        else {
          setError(errorMessage(err));
          setPhase("error");
        }
      } finally {
        if (!controller.signal.aborted) setRefreshing(false);
      }
    },
    [playerId],
  );

  // Load now; settle in parallel and reload if anything settled.
  const load = useCallback(
    (pull: boolean) => {
      fetchProfile(pull);
      settle()
        .then((res) => {
          if (res.settled > 0) fetchProfile(false);
        })
        .catch(() => {});
    },
    [fetchProfile],
  );

  useFocusEffect(
    useCallback(() => {
      load(false);
      return () => abortRef.current?.abort();
    }, [load]),
  );

  const openSettings = useCallback(() => router.push("/settings"), []);

  const renderItem = useCallback(
    ({ item }: { item: RecentCall }) => <CallRow call={item} highlight={fresh.has(item.instrumentSymbol)} />,
    [fresh],
  );

  const balance = profile && typeof profile.status.balance === "number" ? formatMoney(profile.status.balance) : null;

  return (
    <SafeAreaView style={styles.screen} edges={["top", "left", "right"]}>
      {phase === "loading" ? <LoadingView label="Adding up your calls" /> : null}
      {phase === "error" ? <ErrorView message={error} onRetry={() => load(true)} refreshing={refreshing} /> : null}
      {phase === "ready" && profile ? (
        <FlatList
          data={profile.recent}
          keyExtractor={keyExtractor}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={colors.ink2} />}
          ListHeaderComponent={
            <View style={styles.headerGap}>
              <View style={styles.identity}>
                <Text style={styles.name} numberOfLines={1}>
                  {profile.status.name}
                </Text>
                <Pressable
                  testID="settings-open"
                  accessibilityRole="button"
                  accessibilityLabel="Settings"
                  onPress={openSettings}
                  hitSlop={8}
                  style={({ pressed }) => [styles.gear, pressed && styles.pressed]}
                >
                  <SlidersGlyph color={colors.ink} />
                </Pressable>
              </View>
              {notice ? <Text style={styles.notice}>{notice}</Text> : null}

              <View style={styles.statsRow}>
                <View style={styles.stat}>
                  <Text style={[styles.statValue, profile.edgeTotal > 0 && styles.edgePositive]}>{formatEdge(profile.edgeTotal)}</Text>
                  <Text style={styles.statLabel}>Edge</Text>
                </View>
                {balance ? (
                  <>
                    <View style={styles.statDivider} />
                    <View style={styles.stat}>
                      <Text style={styles.statValue}>{balance}</Text>
                      <Text style={styles.statLabel}>Play money</Text>
                    </View>
                  </>
                ) : null}
                <View style={styles.statDivider} />
                <View style={styles.stat}>
                  <Text style={styles.statValue}>{profile.progress.settledCalls}</Text>
                  <Text style={styles.statLabel}>Settled</Text>
                </View>
              </View>

              <LevelBar progress={profile.progress} dailyCap={profile.status.dailyCap} stake={profile.status.stake} />

              {profile.progress.settledCalls === 0 ? (
                <Text style={styles.fillIn}>Your first settled calls fill this in.</Text>
              ) : (
                <>
                  {profile.categories.length > 0 ? <CategoryBars categories={profile.categories} /> : null}
                  {profile.insight ? <Text style={styles.insight}>{profile.insight}</Text> : null}
                </>
              )}

              <Text style={styles.sectionTitle}>Recent calls</Text>
            </View>
          }
          ListEmptyComponent={<EmptyView title="No calls yet." hint="Swipe a card in the Deck." />}
          ListFooterComponent={<BrandStrip style={styles.footer} />}
          renderItem={renderItem}
          initialNumToRender={10}
          windowSize={5}
        />
      ) : null}
    </SafeAreaView>
  );
}

function keyExtractor(call: RecentCall): string {
  return call.instrumentSymbol;
}

function SlidersGlyph({ color }: { color: string }) {
  const common = { stroke: color, strokeWidth: 1.9, strokeLinecap: "round" as const };
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
      <Line x1={4} y1={7} x2={20} y2={7} {...common} />
      <Line x1={4} y1={12} x2={20} y2={12} {...common} />
      <Line x1={4} y1={17} x2={20} y2={17} {...common} />
      <Circle cx={9} cy={7} r={2.4} fill={colors.card} {...common} />
      <Circle cx={15} cy={12} r={2.4} fill={colors.card} {...common} />
      <Circle cx={7} cy={17} r={2.4} fill={colors.card} {...common} />
    </Svg>
  );
}

const CallRow = memo(function CallRow({ call, highlight }: { call: RecentCall; highlight: boolean }) {
  const glow = useSharedValue(0);
  useEffect(() => {
    if (highlight) {
      glow.set(1);
      glow.set(withTiming(0, { duration: motion.highlightMs }));
    }
  }, [highlight, glow]);
  const glowStyle = useAnimatedStyle(() => ({
    backgroundColor: `rgba(240, 164, 43, ${0.22 * glow.get()})`,
  }));

  const result = call.result === "won" ? "Won" : call.result === "lost" ? "Lost" : "Pending";
  const payout = call.result === "pending" || call.payout === null ? null : formatDollars(call.payout);

  return (
    <Animated.View testID="recent-call" style={[styles.call, glowStyle]}>
      <Text style={styles.question} numberOfLines={2}>
        {call.question}
      </Text>
      <View style={styles.callMeta}>
        <Stamp kind={call.side} size="sm" />
        <Text style={styles.mode}>{call.mode === "paid" ? "Paid" : "Practice"}</Text>
        <Text style={[styles.result, call.result === "won" && styles.resultWon, call.result === "pending" && styles.resultPending]}>{result}</Text>
        <View style={styles.spacer} />
        {payout !== null ? <Text style={styles.payout}>{payout}</Text> : null}
        {call.edge !== null ? (
          <Text style={[styles.edge, call.edge > 0 && styles.edgePositive, call.edge < 0 && styles.edgeNegative]}>{formatEdge(call.edge)}</Text>
        ) : null}
      </View>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  screen: { flex: 1 },
  list: { paddingHorizontal: space.xl, paddingTop: space.sm, paddingBottom: space.huge, flexGrow: 1 },
  headerGap: { gap: space.lg, marginBottom: space.sm },
  identity: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.md },
  name: { ...type.title, flex: 1 },
  gear: {
    width: hit.min,
    height: hit.min,
    borderRadius: radii.pill,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: "center",
    justifyContent: "center",
  },
  notice: { ...type.small, color: colors.no },
  statsRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.lineStrong,
  },
  stat: { flex: 1, alignItems: "center", gap: 2 },
  statDivider: { width: StyleSheet.hairlineWidth, height: 32, backgroundColor: colors.lineStrong },
  statValue: { ...type.stat, fontSize: 24, lineHeight: 28 },
  statLabel: { ...type.caption, color: colors.ink2 },
  fillIn: { ...type.small, color: colors.ink3 },
  insight: { ...type.body, color: colors.ink },
  sectionTitle: { ...type.heading, marginTop: space.xs },
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
  mode: { ...type.caption },
  result: { ...type.caption, color: colors.ink2, fontWeight: "700" },
  resultWon: { color: colors.accentDeep },
  resultPending: { color: colors.ink3 },
  spacer: { flex: 1 },
  payout: { ...type.small, color: colors.ink, fontVariant: ["tabular-nums"] },
  edge: { ...type.heading, fontVariant: ["tabular-nums"] },
  edgePositive: { color: colors.accentDeep },
  edgeNegative: { color: colors.ink2 },
  footer: { marginTop: space.xxl, marginBottom: space.lg },
  pressed: { opacity: 0.7 },
});
