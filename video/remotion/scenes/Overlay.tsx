// Overlay text for the app scenes, in the left column beside the phone.
// Traction shows the live counters; nothing numeric appears until they exist.
import { getRemotionEnvironment, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { Counters, Scene } from "../script";
import { fillDigits } from "../script";
import { colors, fonts, layout, tabular } from "../theme";

export const Overlay = ({ scene, counters }: { scene: Scene; counters: Counters | null }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const lines = scene.overlay === undefined ? [] : Array.isArray(scene.overlay) ? scene.overlay : [scene.overlay];
  const { isRendering } = getRemotionEnvironment();

  const resolved = lines.map((line) => fillDigits(line, counters));
  const missing = resolved.some((l) => l === null);
  const shown = resolved.filter((l): l is string => l !== null);

  const outro = interpolate(frame, [durationInFrames - Math.round(fps * 0.3), durationInFrames], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const isTraction = scene.id === "traction";

  return (
    <div
      style={{
        position: "absolute",
        left: layout.leftColumn.x,
        top: 0,
        width: layout.leftColumn.width,
        height: layout.height - 160,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "flex-start",
        gap: isTraction ? 18 : 24,
        opacity: outro,
        fontFamily: fonts.sans,
      }}
    >
      {shown.map((text, i) => {
        const enter = spring({ frame: frame - Math.round(fps * (0.5 + i * 0.25)), fps, config: { damping: 200 } });
        const isNote = isTraction && i === shown.length - 1 && !/\d/.test(text);
        return (
          <div
            key={`${scene.id}-${i}`}
            style={{
              opacity: enter,
              transform: `translateY(${interpolate(enter, [0, 1], [30, 0])}px)`,
              fontSize: isTraction ? (isNote ? 34 : 64) : 60,
              fontWeight: isNote ? 500 : 700,
              letterSpacing: isNote ? 0 : -1.5,
              lineHeight: 1.08,
              color: isNote ? colors.muted : isTraction ? colors.accent : colors.paper,
              marginTop: isNote ? 18 : 0,
              ...tabular,
            }}
          >
            {text}
          </div>
        );
      })}
      {missing && !isRendering ? (
        <div style={{ marginTop: 24, fontFamily: fonts.mono, fontSize: 18, color: colors.faint }}>
          counters pending: run voiceover.ts with --api or --counters
        </div>
      ) : null}
    </div>
  );
};
