// Hunch theme. Every screen and component reads from here.
// Dark base, warm paper text, one amber accent. Numbers are always tabular.

import { Platform, type TextStyle } from "react-native";

export const colors = {
  bg: "#0B0B0F", // matches the splash background in app.json
  surface: "#15151C",
  surfaceRaised: "#1D1D26",
  line: "#2A2A35",
  lineStrong: "#3B3B48",

  paper: "#F3F1EA", // primary text
  muted: "#9B9AA6",
  faint: "#62616E",

  accent: "#FFB224", // amber, the one bold accent
  accentSoft: "rgba(255, 178, 36, 0.14)",
  onAccent: "#16120A",

  // Call sides: YES is lit (amber), NO is paper.
  yes: "#FFB224",
  no: "#E6E3DA",

  // Status only, never decoration.
  win: "#FFB224",
  loss: "#F2688A",
  lossSoft: "rgba(242, 104, 138, 0.14)",
  pending: "#9B9AA6",

  overlay: "rgba(5, 5, 8, 0.72)",
} as const;

export const monoFamily = Platform.select({ ios: "Menlo", default: "monospace" });

export const tabular: TextStyle = { fontVariant: ["tabular-nums"] };

export const type = {
  display: {
    fontSize: 30,
    lineHeight: 36,
    fontWeight: "700",
    letterSpacing: -0.6,
    color: colors.paper,
  } satisfies TextStyle,
  title: {
    fontSize: 22,
    lineHeight: 27,
    fontWeight: "700",
    letterSpacing: -0.3,
    color: colors.paper,
  } satisfies TextStyle,
  heading: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: "600",
    color: colors.paper,
  } satisfies TextStyle,
  body: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "500",
    color: colors.paper,
  } satisfies TextStyle,
  small: {
    fontSize: 14,
    lineHeight: 19,
    fontWeight: "500",
    color: colors.muted,
  } satisfies TextStyle,
  label: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "600",
    letterSpacing: 0.9,
    textTransform: "uppercase",
    color: colors.muted,
  } satisfies TextStyle,
  mono: {
    fontFamily: monoFamily,
    fontSize: 13,
    lineHeight: 19,
    color: colors.paper,
    ...tabular,
  } satisfies TextStyle,
  bigNumber: {
    fontSize: 34,
    lineHeight: 40,
    fontWeight: "700",
    letterSpacing: -0.8,
    color: colors.paper,
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

export const radii = {
  chip: 999,
  button: 14,
  tile: 16,
  card: 24,
  sheet: 28,
} as const;

export const hit = {
  min: 44, // minimum tap target in points
} as const;

export const springs = {
  // Card snapping back under the thumb.
  snap: { damping: 20, stiffness: 240, mass: 0.9 },
  // Cards behind the top card settling into place.
  stack: { damping: 18, stiffness: 180 },
  // The reveal bar. A little overshoot on purpose: this is the hero moment.
  reveal: { damping: 13, stiffness: 110, mass: 1 },
  // The reveal sheet rising.
  sheet: { damping: 24, stiffness: 280 },
  // Chips and small toggles.
  quick: { damping: 22, stiffness: 320 },
} as const;

export const motion = {
  flyOutMs: 260,
  fadeMs: 180,
  highlightMs: 2400,
} as const;

export const swipe = {
  // Horizontal travel that commits a YES or NO.
  commitX: 110,
  // Upward travel that commits a skip.
  commitY: 120,
  // Fling velocity that commits regardless of travel.
  flingVelocity: 900,
  maxRotationDeg: 14,
} as const;

export const credit = {
  builtOn: "Built on Gemini Prediction Markets",
  liveOrder: "Live order on Gemini sandbox",
} as const;
