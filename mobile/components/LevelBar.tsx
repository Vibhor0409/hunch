// Level bar for the Me tab: current level, progress to the next one, and the rule.

import { useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";

import { formatEdge, formatInt } from "@/components/format";
import { colors, radii, space, springs, type } from "@/lib/theme";
import type { LevelProgress } from "@/lib/types";

export function LevelBar({ progress }: { progress: LevelProgress }) {
  const top = progress.nextLevel === null;
  const callsNeeded = progress.callsNeeded;
  const callsFrac = top || !callsNeeded ? 1 : Math.min(1, progress.settledCalls / callsNeeded);
  const edgeNeeded = progress.avgEdgeNeeded;
  const edgeMet =
    top || edgeNeeded === null ? true : edgeNeeded === 0 ? progress.avgEdge > 0 : progress.avgEdge >= edgeNeeded;

  const fill = useSharedValue(0);
  useEffect(() => {
    fill.set(withSpring(callsFrac, springs.reveal));
  }, [callsFrac, fill]);
  const fillStyle = useAnimatedStyle(() => ({ width: `${fill.get() * 100}%` }));

  return (
    <View testID="level-bar" style={styles.wrap}>
      <View style={styles.row}>
        <Text style={styles.level}>Level {progress.level}</Text>
        <Text style={styles.next}>{top ? "Top level" : `Next: Level ${progress.nextLevel}`}</Text>
      </View>

      <View style={styles.track}>
        <Animated.View style={[styles.fill, fillStyle]} />
      </View>

      {top ? null : (
        <View style={styles.row}>
          <Text style={styles.stat}>
            {formatInt(progress.settledCalls)} of {formatInt(callsNeeded ?? 0)} calls
          </Text>
          <Text style={[styles.stat, edgeMet && styles.statMet]}>
            Avg Edge {formatEdge(progress.avgEdge)}
            {edgeNeeded === null ? "" : edgeNeeded === 0 ? ", needs above 0" : `, needs ${edgeNeeded.toFixed(1)}`}
          </Text>
        </View>
      )}

      <Text style={styles.rule}>{progress.rule}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: space.sm,
    padding: space.lg,
    borderRadius: radii.tile,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
  },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.md },
  level: { ...type.heading, fontVariant: ["tabular-nums"] },
  next: { ...type.small, fontVariant: ["tabular-nums"] },
  track: { height: 8, borderRadius: 4, backgroundColor: colors.line, overflow: "hidden" },
  fill: { height: "100%", borderRadius: 4, backgroundColor: colors.accent },
  stat: { ...type.small, fontVariant: ["tabular-nums"] },
  statMet: { color: colors.paper },
  rule: { ...type.small, color: colors.faint },
});
