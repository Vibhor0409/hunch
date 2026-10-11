// Hunch palette for the video. Mirrors mobile/lib/theme.ts: dark base, warm
// paper text, one amber accent. Loss pink is status only. No Gemini colours.

export const colors = {
  bg: "#0B0B0F",
  surface: "#15151C",
  surfaceRaised: "#1D1D26",
  line: "#2A2A35",
  lineStrong: "#3B3B48",
  paper: "#F3F1EA",
  muted: "#9B9AA6",
  faint: "#62616E",
  accent: "#FFB224",
  accentSoft: "rgba(255, 178, 36, 0.14)",
  onAccent: "#16120A",
  loss: "#F2688A",
  lossSoft: "rgba(242, 104, 138, 0.14)",
  overlay: "rgba(5, 5, 8, 0.72)",
} as const;

export const fonts = {
  sans: 'system-ui, -apple-system, "SF Pro Display", "Helvetica Neue", Helvetica, Arial, sans-serif',
  mono: '"SF Mono", Menlo, Consolas, monospace',
} as const;

export const tabular = { fontVariantNumeric: "tabular-nums" } as const;

// Canvas geometry (1920 by 1080). The phone is centred; overlays use the left column.
export const layout = {
  width: 1920,
  height: 1080,
  phone: {
    screenWidth: 378, // 9 by 19.5 at 820 tall, close to a modern iPhone
    screenHeight: 820,
    bezel: 14,
    radius: 60,
    top: 56,
  },
  captionBottom: 44,
  leftColumn: { x: 120, width: 600 },
} as const;
