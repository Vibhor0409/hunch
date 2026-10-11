// Category colors and glyphs. Each market category gets one hue and one simple
// line glyph drawn with react-native-svg. Unknown categories fall back to a neutral.

import { memo } from "react";
import { StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Path, Rect } from "react-native-svg";

import { categoryTones, colors, radii, type, type CategoryKey, type CategoryTone } from "@/lib/theme";

const ALIASES: Record<string, CategoryKey> = {
  crypto: "crypto",
  cryptocurrency: "crypto",
  politics: "politics",
  political: "politics",
  elections: "politics",
  economics: "economics",
  economy: "economics",
  finance: "economics",
  financials: "economics",
  commodities: "commodities",
  commodity: "commodities",
  science: "science",
  tech: "science",
  technology: "science",
  sports: "sports",
  sport: "sports",
  weather: "weather",
  climate: "weather",
  entertainment: "entertainment",
  culture: "entertainment",
  media: "entertainment",
};

/** Resolve a category string from the API to its tone. Never throws. */
export function categoryTone(raw: string | null | undefined): CategoryTone {
  const key = raw ? ALIASES[raw.trim().toLowerCase()] : undefined;
  if (key) return categoryTones[key];
  // Unknown but non-empty: keep the API's own label on the neutral tone.
  if (raw && raw.trim().length > 0) {
    return { ...categoryTones.other, label: titleCase(raw.trim()) };
  }
  return categoryTones.other;
}

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const STROKE = 1.9;

/** A 24-grid line glyph for a category, in the given color. */
export const CategoryGlyph = memo(function CategoryGlyph({
  category,
  color,
  size = 16,
}: {
  category: CategoryKey;
  color: string;
  size?: number;
}) {
  const common = { stroke: color, strokeWidth: STROKE, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, fill: "none" };
  switch (category) {
    case "crypto":
      // A coin, seen edge on.
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Circle cx={12} cy={12} r={8.5} {...common} />
          <Path d="M9.5 8.5h4a2 2 0 0 1 0 4h-4m0 0h4.5a2 2 0 0 1 0 4h-4.5M11 6.5v11" {...common} />
        </Svg>
      );
    case "politics":
      // A ballot going into a box.
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Path d="M4 12h16v8H4z" {...common} />
          <Path d="M8 12V5.5h8V12M10 8.5h4" {...common} />
        </Svg>
      );
    case "economics":
      // A rising line with a baseline.
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Path d="M4 19h16" {...common} />
          <Path d="M5 15l4.5-5 3.5 3 6-7" {...common} />
          <Path d="M15.5 6H19v3.5" {...common} />
        </Svg>
      );
    case "commodities":
      // Two stacked ingots.
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Path d="M5 19l1.5-5h11L19 19z" {...common} />
          <Path d="M8 14l1.5-5h5L16 14" {...common} />
        </Svg>
      );
    case "science":
      // A flask.
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Path d="M9.5 4h5M10 4v5.5L5.5 18a1.6 1.6 0 0 0 1.4 2.4h10.2a1.6 1.6 0 0 0 1.4-2.4L14 9.5V4" {...common} />
          <Path d="M8 15h8" {...common} />
        </Svg>
      );
    case "sports":
      // A ball with a seam.
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Circle cx={12} cy={12} r={8.5} {...common} />
          <Path d="M6.5 6.5c3 3 3 8 0 11M17.5 6.5c-3 3-3 8 0 11" {...common} />
        </Svg>
      );
    case "weather":
      // A cloud with the sun behind it.
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Circle cx={15.5} cy={8} r={3.2} {...common} />
          <Path d="M15.5 2.5v1.5M20.5 8H19M19.4 4.2l-1 1" {...common} />
          <Path d="M7 19.5h8.5a3.25 3.25 0 0 0 .6-6.45A4.5 4.5 0 0 0 7.4 13.6 3 3 0 0 0 7 19.5z" {...common} />
        </Svg>
      );
    case "entertainment":
      // A clapperboard.
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Rect x={4} y={9} width={16} height={11} rx={1.5} {...common} />
          <Path d="M4 9l2-4.5 14 2.5-1 2M9 5.3l-1.5 3.7M14 6.2l-1.5 3.3" {...common} />
        </Svg>
      );
    default:
      // A small compass rose for anything else.
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Circle cx={12} cy={12} r={8.5} {...common} />
          <Path d="M12 7l1.8 3.2L17 12l-3.2 1.8L12 17l-1.8-3.2L7 12l3.2-1.8z" {...common} />
        </Svg>
      );
  }
});

/** A tinted chip with the glyph and the category label. */
export const CategoryChip = memo(function CategoryChip({ category, compact = false }: { category: string; compact?: boolean }) {
  const tone = categoryTone(category);
  return (
    <View style={[styles.chip, { backgroundColor: tone.soft }, compact && styles.chipCompact]}>
      <CategoryGlyph category={tone.key} color={tone.ink} size={compact ? 13 : 15} />
      <Text style={[styles.chipText, compact && styles.chipTextCompact, { color: tone.ink }]} numberOfLines={1}>
        {tone.label}
      </Text>
    </View>
  );
});

const styles = StyleSheet.create({
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingLeft: 9,
    paddingRight: 11,
    height: 28,
    borderRadius: radii.pill,
    alignSelf: "flex-start",
  },
  chipCompact: { height: 22, paddingLeft: 7, paddingRight: 8, gap: 4 },
  chipText: { ...type.caption, fontSize: 13, lineHeight: 16, fontWeight: "700", color: colors.ink },
  chipTextCompact: { fontSize: 11, lineHeight: 14 },
});
