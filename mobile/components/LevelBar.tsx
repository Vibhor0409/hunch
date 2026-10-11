// The level card on Me: the ring, what the next level takes, and the rule.

import { memo } from "react";
import { StyleSheet, Text, View } from "react-native";

import { formatEdge, formatInt } from "@/components/format";
import { LevelRing } from "@/components/LevelRing";
import { colors, radii, shadows, space, type } from "@/lib/theme";
import type { LevelProgress } from "@/lib/types";

const STAKES: Record<1 | 2 | 3 | 4, string> = { 1: "$1", 2: "$2", 3: "$3", 4: "$5" };

export const LevelBar = memo(function LevelBar({ progress, dailyCap, stake }: { progress: LevelProgress; dailyCap: number; stake: number }) {
  const top = progress.nextLevel === null;
  const callsNeeded = progress.callsNeeded;
  const callsFrac = top || !callsNeeded ? 1 : Math.min(1, progress.settledCalls / callsNeeded);
  const edgeNeeded = progress.avgEdgeNeeded;
  const edgeMet =
    top || edgeNeeded === null ? true : edgeNeeded === 0 ? progress.avgEdge > 0 : progress.avgEdge >= edgeNeeded;
  const callsMet = top || !callsNeeded ? true : progress.settledCalls >= callsNeeded;

  return (
    <View testID="level-bar" style={styles.wrap}>
      <View style={styles.row}>
        <LevelRing level={progress.level} progress={callsFrac} />
        <View style={styles.text}>
          <Text style={styles.level}>Level {progress.level}</Text>
          <Text style={styles.perks}>
            {formatInt(dailyCap)} paid swipes a day at {STAKES[progress.level] ?? `$${stake}`} each
          </Text>
        </View>
      </View>

      {top ? (
        <Text style={styles.next}>Top level. Keep your Edge above zero to stay here.</Text>
      ) : (
        <View style={styles.needs}>
          <Text style={styles.next}>Level {progress.nextLevel} needs</Text>
          <View style={styles.needRow}>
            <Text style={[styles.need, callsMet && styles.needMet]}>
              {formatInt(progress.settledCalls)} of {formatInt(callsNeeded ?? 0)} settled calls
            </Text>
            <Text style={[styles.need, edgeMet && styles.needMet]}>
              Avg Edge {formatEdge(progress.avgEdge)}
              {edgeNeeded === null ? "" : edgeNeeded === 0 ? ", needs above 0" : `, needs ${edgeNeeded.toFixed(1)}`}
            </Text>
          </View>
        </View>
      )}

      <Text style={styles.rule}>{progress.rule}</Text>
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: {
    gap: space.md,
    padding: space.lg,
    borderRadius: radii.tile,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    ...shadows.tile,
  },
  row: { flexDirection: "row", alignItems: "center", gap: space.lg },
  text: { flex: 1, gap: 2 },
  level: { ...type.title, fontSize: 22, lineHeight: 26 },
  perks: { ...type.small, fontVariant: ["tabular-nums"] },
  needs: { gap: 4 },
  next: { ...type.caption, color: colors.ink2 },
  needRow: { gap: 2 },
  need: { ...type.small, fontVariant: ["tabular-nums"] },
  needMet: { color: colors.accentDeep, fontWeight: "700" },
  rule: { ...type.caption, color: colors.ink3 },
});
