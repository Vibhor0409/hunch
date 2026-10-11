// Edge by category: diverging bars from a center axis, drawn with react-native-svg.
// Positive Edge runs right in amber, negative runs left in rose. Values stay in text ink.

import { useState } from "react";
import { StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";
import Svg, { Line, Path } from "react-native-svg";

import { formatEdge, formatInt, formatPct } from "@/components/format";
import { colors, space, type } from "@/lib/theme";
import type { CategoryStat } from "@/lib/types";

const ROW_H = 14;
const BAR_H = 10;
const RADIUS = BAR_H / 2;
const GAP = 2; // surface gap between the axis and the bar

export function CategoryBars({ categories }: { categories: CategoryStat[] }) {
  const [width, setWidth] = useState(0);
  const max = categories.reduce((m, c) => Math.max(m, Math.abs(c.edgeTotal)), 0);
  const onLayout = (e: LayoutChangeEvent) => setWidth(Math.floor(e.nativeEvent.layout.width));

  return (
    <View style={styles.wrap} onLayout={onLayout}>
      <Text style={type.label}>Edge by category</Text>
      {categories.map((stat) => (
        <CategoryBar key={stat.category} stat={stat} max={max} width={width} />
      ))}
    </View>
  );
}

function CategoryBar({ stat, max, width }: { stat: CategoryStat; max: number; width: number }) {
  const half = Math.floor(width / 2) + 0.5;
  const positive = stat.edgeTotal >= 0;
  const room = half - GAP - 1;
  const scaled = max > 0 ? room * Math.min(1, Math.abs(stat.edgeTotal) / max) : 0;
  const barLen = stat.edgeTotal === 0 ? 0 : Math.max(scaled, RADIUS + 1);

  return (
    <View testID="category-bar" style={styles.row}>
      <View style={styles.meta}>
        <Text style={styles.name} numberOfLines={1}>
          {stat.category}
        </Text>
        <Text style={styles.value}>{formatEdge(stat.edgeTotal)}</Text>
      </View>

      {width > 0 ? (
        <Svg width={width} height={ROW_H}>
          <Line x1={half} y1={0} x2={half} y2={ROW_H} stroke={colors.lineStrong} strokeWidth={1} />
          {barLen > 0 ? (
            <Path d={barPath(half, barLen, positive)} fill={positive ? colors.accent : colors.loss} />
          ) : null}
        </Svg>
      ) : (
        <View style={styles.placeholder} />
      )}

      <Text style={styles.sub}>
        {formatInt(stat.settledCalls)} {stat.settledCalls === 1 ? "call" : "calls"} {"·"} hit{" "}
        {formatPct(stat.hitRate * 100)} {"·"} implied {formatPct(stat.avgImplied * 100)}
      </Text>
    </View>
  );
}

/** A bar anchored square at the axis with a rounded far end. */
function barPath(axis: number, length: number, positive: boolean): string {
  const y = (ROW_H - BAR_H) / 2;
  const r = RADIUS;
  if (positive) {
    const x0 = axis + GAP;
    const x1 = x0 + length;
    return `M${x0},${y} H${x1 - r} A${r},${r} 0 0 1 ${x1},${y + r} V${y + BAR_H - r} A${r},${r} 0 0 1 ${x1 - r},${y + BAR_H} H${x0} Z`;
  }
  const x0 = axis - GAP;
  const x1 = x0 - length;
  return `M${x0},${y} H${x1 + r} A${r},${r} 0 0 0 ${x1},${y + r} V${y + BAR_H - r} A${r},${r} 0 0 0 ${x1 + r},${y + BAR_H} H${x0} Z`;
}

const styles = StyleSheet.create({
  wrap: { gap: space.md },
  row: { gap: 6 },
  meta: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.md },
  name: { ...type.body, flexShrink: 1 },
  value: { ...type.body, fontVariant: ["tabular-nums"] },
  placeholder: { height: ROW_H },
  sub: { ...type.small, fontVariant: ["tabular-nums"] },
});
