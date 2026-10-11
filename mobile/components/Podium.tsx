// The top three on the leaderboard. First stands in the middle on the tallest plinth.

import { memo } from "react";
import { StyleSheet, Text, View } from "react-native";

import { formatEdge, formatInt } from "@/components/format";
import { colors, radii, shadows, space, type } from "@/lib/theme";
import type { LeaderboardRow } from "@/lib/types";

const HEIGHTS = [84, 112, 68]; // second, first, third

export const Podium = memo(function Podium({ rows, myId }: { rows: LeaderboardRow[]; myId: string | null }) {
  const [first, second, third] = rows;
  const order = [second, first, third];
  return (
    <View style={styles.row} accessibilityRole="summary">
      {order.map((row, i) =>
        row ? (
          <Plinth key={row.playerId} row={row} height={HEIGHTS[i]} first={i === 1} me={row.playerId === myId} />
        ) : (
          <View key={`empty-${i}`} style={styles.slot} />
        ),
      )}
    </View>
  );
});

function Plinth({ row, height, first, me }: { row: LeaderboardRow; height: number; first: boolean; me: boolean }) {
  return (
    <View testID="leaderboard-row" style={styles.slot}>
      <Text style={[styles.name, first && styles.nameFirst]} numberOfLines={1}>
        {row.name}
      </Text>
      {me ? <Text style={styles.you}>You</Text> : null}
      <View style={[styles.plinth, { height }, first && styles.plinthFirst]}>
        <View style={[styles.medal, first && styles.medalFirst]}>
          <Text style={[styles.medalText, first && styles.medalTextFirst]}>{row.rank}</Text>
        </View>
        <Text style={[styles.edge, row.edgeTotal > 0 && styles.edgePositive]}>{formatEdge(row.edgeTotal)}</Text>
        <Text style={styles.calls}>{formatInt(row.settledCalls)} settled</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "flex-end", gap: space.sm },
  slot: { flex: 1, alignItems: "center", gap: 4 },
  name: { ...type.small, color: colors.ink, fontWeight: "700", maxWidth: "100%" },
  nameFirst: { ...type.heading },
  you: { ...type.caption, color: colors.accentDeep },
  plinth: {
    alignSelf: "stretch",
    alignItems: "center",
    justifyContent: "flex-start",
    paddingTop: space.md,
    gap: 2,
    borderTopLeftRadius: radii.tile,
    borderTopRightRadius: radii.tile,
    borderBottomLeftRadius: 6,
    borderBottomRightRadius: 6,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    ...shadows.tile,
  },
  plinthFirst: { borderColor: colors.accent, borderTopWidth: 4 },
  medal: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.paperDeep,
  },
  medalFirst: { backgroundColor: colors.accent },
  medalText: { fontSize: 13, fontWeight: "800", color: colors.ink2, fontVariant: ["tabular-nums"] },
  medalTextFirst: { color: colors.onAccent },
  edge: { ...type.heading, fontVariant: ["tabular-nums"], marginTop: 4 },
  edgePositive: { color: colors.accentDeep },
  calls: { ...type.caption, fontVariant: ["tabular-nums"] },
});
