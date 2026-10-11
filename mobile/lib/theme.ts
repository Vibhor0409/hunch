// Hunch theme. Every screen and component reads from here.
// Paper and ink: a warm light base, strong type, marigold as the one brand accent,
// stamp blue and stamp red for YES and NO, and a fixed set of category hues.
// Numbers are always tabular.

import { Platform, type TextStyle, type ViewStyle } from "react-native";

export const colors = {
  paper: "#F6F1E7", // screen background, matches the splash color in app.json
  paperDeep: "#ECE5D7", // recessed tracks, skeleton base
  card: "#FFFCF6", // raised surfaces: cards, sheets, tiles

  ink: "#1F1B16", // primary text and primary buttons
  ink2: "#5E574C", // secondary text
  ink3: "#8E8678", // tertiary text, placeholders
  line: "#E2DACB",
  lineStrong: "#CBC1AE",

  accent: "#F0A42B", // marigold: the mark, fills, the level ring
  accentDeep: "#8A5600", // marigold as text, passes AA on paper
  accentSoft: "#FBE8C5",

  // Call sides: rubber stamp inks. Validated as a pair for colorblind separation.
  yes: "#2B4DA6",
  yesSoft: "#DCE3F6",
  no: "#C43C2B",
  noSoft: "#F7DCD7",

  onInk: "#FBF7EE",
  onAccent: "#1F1B16",
  overlay: "rgba(31, 27, 22, 0.42)",
  shadow: "#4A3A1E", // warm shadow tint, never pure black
} as const;

/** Category hues, in a fixed order that passes the dataviz six checks on paper. */
export interface CategoryTone {
  key: CategoryKey;
  label: string;
  ink: string;
  soft: string;
}

export type CategoryKey =
  | "crypto"
  | "politics"
  | "economics"
  | "commodities"
  | "science"
  | "sports"
  | "weather"
  | "entertainment"
  | "other";

export const categoryTones: Record<CategoryKey, CategoryTone> = {
  crypto: { key: "crypto", label: "Crypto", ink: "#C9601A", soft: "#FAE3D2" },
  politics: { key: "politics", label: "Politics", ink: "#4A47A8", soft: "#E3E2F6" },
  economics: { key: "economics", label: "Economics", ink: "#0087A0", soft: "#D6ECF0" },
  commodities: { key: "commodities", label: "Commodities", ink: "#8A6F0A", soft: "#EFE6CB" },
  science: { key: "science", label: "Science", ink: "#7A3FB0", soft: "#EADDF6" },
  sports: { key: "sports", label: "Sports", ink: "#2A7F4D", soft: "#D9EEE0" },
  weather: { key: "weather", label: "Weather", ink: "#2A74BE", soft: "#D9E7F7" },
  entertainment: { key: "entertainment", label: "Entertainment", ink: "#B9306F", soft: "#F7D9E7" },
  other: { key: "other", label: "Other", ink: "#6B655B", soft: "#E8E2D6" },
};

export const monoFamily = Platform.select({ ios: "Menlo", default: "monospace" });

export const tabular: TextStyle = { fontVariant: ["tabular-nums"] };

export const type = {
  // The card question.
  display: {
    fontSize: 30,
    lineHeight: 36,
    fontWeight: "800",
    letterSpacing: -0.7,
    color: colors.ink,
  } satisfies TextStyle,
  // The reveal percentages.
  hero: {
    fontSize: 60,
    lineHeight: 64,
    fontWeight: "800",
    letterSpacing: -2,
    color: colors.ink,
    ...tabular,
  } satisfies TextStyle,
  title: {
    fontSize: 26,
    lineHeight: 31,
    fontWeight: "800",
    letterSpacing: -0.6,
    color: colors.ink,
  } satisfies TextStyle,
  stat: {
    fontSize: 28,
    lineHeight: 32,
    fontWeight: "800",
    letterSpacing: -0.6,
    color: colors.ink,
    ...tabular,
  } satisfies TextStyle,
  heading: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: "700",
    color: colors.ink,
  } satisfies TextStyle,
  body: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "500",
    color: colors.ink,
  } satisfies TextStyle,
  small: {
    fontSize: 14,
    lineHeight: 19,
    fontWeight: "500",
    color: colors.ink2,
  } satisfies TextStyle,
  caption: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "600",
    color: colors.ink3,
  } satisfies TextStyle,
  // Small caps label. Used for stamps and the brand strip only.
  label: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "700",
    letterSpacing: 1.1,
    textTransform: "uppercase",
    color: colors.ink3,
  } satisfies TextStyle,
  mono: {
    fontFamily: monoFamily,
    fontSize: 13,
    lineHeight: 18,
    color: colors.ink,
    ...tabular,
  } satisfies TextStyle,
} as const;

export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 40,
} as const;

// One radius system: pills for controls, 16 for tiles, 24 for cards and sheets.
export const radii = {
  pill: 999,
  button: 16,
  tile: 16,
  card: 24,
  sheet: 28,
} as const;

export const hit = {
  min: 44, // minimum tap target in points
} as const;

/** Layered warm shadows. iOS reads shadow*, Android reads elevation. */
export const shadows = {
  card: {
    shadowColor: colors.shadow,
    shadowOpacity: 0.16,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 8,
  } satisfies ViewStyle,
  tile: {
    shadowColor: colors.shadow,
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  } satisfies ViewStyle,
  sheet: {
    shadowColor: colors.shadow,
    shadowOpacity: 0.22,
    shadowRadius: 32,
    shadowOffset: { width: 0, height: -8 },
    elevation: 12,
  } satisfies ViewStyle,
} as const;

export const springs = {
  // Card snapping back under the thumb. A gentle overshoot.
  snap: { damping: 16, stiffness: 220, mass: 0.8 },
  // Cards behind the top card settling into place.
  stack: { damping: 20, stiffness: 200 },
  // The reveal split bar. Overshoot on purpose: this is the hero moment.
  reveal: { damping: 14, stiffness: 120, mass: 1 },
  // The reveal sheet rising.
  sheet: { damping: 26, stiffness: 300 },
  // Segmented control thumb, small toggles.
  quick: { damping: 24, stiffness: 340 },
} as const;

export const motion = {
  flyOutMinMs: 180,
  flyOutMaxMs: 320,
  flipMs: 420,
  fadeMs: 180,
  countMs: 900,
  highlightMs: 2400,
} as const;

export const swipe = {
  // Horizontal travel that commits a YES or NO.
  commitX: 100,
  // Upward travel that commits a skip.
  commitY: 110,
  // Fling velocity (points per second) that commits regardless of travel.
  flingVelocity: 850,
  maxRotationDeg: 16,
} as const;

export const credit = {
  poweredBy: "Powered by Gemini Prediction Markets",
  liveOrder: "Live order on Gemini sandbox",
  context: "Context by Context.dev",
} as const;
