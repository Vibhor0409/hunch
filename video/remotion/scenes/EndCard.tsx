// End card: the Hunch mark, the line, the plain-text credit, the repo URL.
import { AbsoluteFill, getRemotionEnvironment, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { Scene } from "../script";
import { colors, fonts } from "../theme";
import { HunchMark } from "./HunchMark";

export const EndCard = ({ scene, github }: { scene: Scene; github: string }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { isRendering } = getRemotionEnvironment();
  const [tagline = "Call it blind. Earn your limit.", credit = "Built on Gemini Prediction Markets"] = Array.isArray(scene.overlay)
    ? scene.overlay
    : [scene.overlay ?? ""];

  const bg = interpolate(frame, [0, Math.round(fps * 0.4)], [0, 1], { extrapolateRight: "clamp" });
  const mark = spring({ frame: frame - Math.round(fps * 0.2), fps, config: { damping: 14, stiffness: 120 } });
  const name = spring({ frame: frame - Math.round(fps * 0.6), fps, config: { damping: 200 } });
  const line = spring({ frame: frame - Math.round(fps * 1.1), fps, config: { damping: 200 } });
  const rest = spring({ frame: frame - Math.round(fps * 1.8), fps, config: { damping: 200 } });
  const url = github.replace(/^https?:\/\//, "");

  return (
    <AbsoluteFill style={{ background: colors.bg, opacity: bg, alignItems: "center", justifyContent: "center", fontFamily: fonts.sans }}>
      <div style={{ transform: `scale(${interpolate(mark, [0, 1], [0.6, 1])}) rotate(${interpolate(mark, [0, 1], [-20, 0])}deg)`, opacity: mark }}>
        <HunchMark size={200} color={colors.accent} paper={colors.paper} />
      </div>
      <div
        style={{
          marginTop: 10,
          opacity: name,
          transform: `translateY(${interpolate(name, [0, 1], [20, 0])}px)`,
          fontSize: 120,
          fontWeight: 800,
          letterSpacing: -5,
          color: colors.paper,
          lineHeight: 1,
        }}
      >
        Hunch
      </div>
      <div
        style={{
          marginTop: 28,
          opacity: line,
          transform: `translateY(${interpolate(line, [0, 1], [20, 0])}px)`,
          fontSize: 56,
          fontWeight: 600,
          letterSpacing: -1,
          color: colors.accent,
        }}
      >
        {tagline}
      </div>
      <div style={{ marginTop: 56, opacity: rest, display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
        <div style={{ fontSize: 30, fontWeight: 500, color: colors.muted }}>{credit}</div>
        {url ? (
          <div style={{ fontFamily: fonts.mono, fontSize: 30, color: colors.paper }}>{url}</div>
        ) : !isRendering ? (
          <div style={{ fontFamily: fonts.mono, fontSize: 18, color: colors.faint }}>github prop not set: pass --props with the repo URL</div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};
