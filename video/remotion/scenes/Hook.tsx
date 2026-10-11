// Kinetic type for the hook: two bets stamped LOST, then the market line.
// Beat times come from script.json so they can follow the voiceover.
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { Scene } from "../script";
import { toFrames } from "../script";
import { colors, fonts, tabular } from "../theme";

const DEFAULT_BEATS = { line1: 0.4, stamp1: 3.3, line2: 4.7, stamp2: 7.4, market: 8.6, dim: 11.3 };

export const Hook = ({ scene }: { scene: Scene }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const beats = { ...DEFAULT_BEATS, ...(scene.beats ?? {}) };
  const lines = Array.isArray(scene.overlay) ? scene.overlay : [];
  const [line1 = "$50 on Argentina", line2 = "$50 on a hat trick", market = "Market: Spain 61%"] = lines;

  const at = (s: number) => toFrames(s, fps);
  const outro = interpolate(frame, [durationInFrames - at(0.4), durationInFrames], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const dim = interpolate(frame, [at(beats.dim), at(beats.dim) + at(0.6)], [1, 0.35], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // The market percentage counts up as the line lands.
  const marketIn = spring({ frame: frame - at(beats.market), fps, config: { damping: 200 } });
  const pctMatch = market.match(/(\d+)%/);
  const pctTarget = pctMatch ? Number(pctMatch[1]) : null;
  const pctNow = pctTarget === null ? null : Math.round(interpolate(marketIn, [0, 1], [0, pctTarget]));
  const marketText = pctTarget === null || pctNow === null ? market : market.replace(/\d+%/, `${pctNow}%`);

  return (
    <AbsoluteFill style={{ background: colors.bg, opacity: outro, fontFamily: fonts.sans }}>
      <div style={{ position: "absolute", left: 220, top: 250, display: "flex", flexDirection: "column", gap: 56 }}>
        <BetLine text={line1} lineAt={at(beats.line1)} stampAt={at(beats.stamp1)} frame={frame} fps={fps} dim={dim} />
        <BetLine text={line2} lineAt={at(beats.line2)} stampAt={at(beats.stamp2)} frame={frame} fps={fps} dim={dim} />
        <div
          style={{
            marginTop: 40,
            opacity: marketIn,
            transform: `translateY(${interpolate(marketIn, [0, 1], [40, 0])}px)`,
            fontSize: 132,
            fontWeight: 800,
            letterSpacing: -4,
            lineHeight: 1,
            color: colors.accent,
            ...tabular,
          }}
        >
          {marketText}
        </div>
      </div>
    </AbsoluteFill>
  );
};

const BetLine = ({
  text,
  lineAt,
  stampAt,
  frame,
  fps,
  dim,
}: {
  text: string;
  lineAt: number;
  stampAt: number;
  frame: number;
  fps: number;
  dim: number;
}) => {
  const enter = spring({ frame: frame - lineAt, fps, config: { damping: 200 } });
  const stamp = spring({ frame: frame - stampAt, fps, config: { damping: 12, stiffness: 220, mass: 0.8 } });
  const stamped = frame >= stampAt;
  return (
    <div style={{ position: "relative", height: 120, opacity: enter * dim, transform: `translateY(${interpolate(enter, [0, 1], [50, 0])}px)` }}>
      <div
        style={{
          fontSize: 104,
          fontWeight: 700,
          letterSpacing: -3,
          lineHeight: "120px",
          color: stamped ? colors.muted : colors.paper,
          textDecoration: stamped ? "line-through" : "none",
          textDecorationColor: colors.loss,
          textDecorationThickness: 8,
          whiteSpace: "nowrap",
          ...tabular,
        }}
      >
        {text}
      </div>
      {stamped ? (
        <div
          style={{
            position: "absolute",
            left: "100%",
            top: 2,
            marginLeft: 48,
            padding: "6px 22px",
            border: `8px solid ${colors.loss}`,
            borderRadius: 14,
            color: colors.loss,
            fontSize: 72,
            fontWeight: 900,
            letterSpacing: 6,
            lineHeight: 1.1,
            opacity: Math.min(1, stamp * 1.4),
            transform: `rotate(-12deg) scale(${interpolate(stamp, [0, 1], [1.9, 1])})`,
            transformOrigin: "center",
          }}
        >
          LOST
        </div>
      ) : null}
    </div>
  );
};
