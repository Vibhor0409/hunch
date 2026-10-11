// "5 minutes later": a full-frame card over the stage.
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { colors, fonts, tabular } from "../theme";

export const TitleCard = ({ text }: { text: string }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const fade = Math.round(fps * 0.25);
  const opacity = interpolate(frame, [0, fade, durationInFrames - fade, durationInFrames], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const rise = interpolate(frame, [0, fade * 2], [24, 0], { extrapolateRight: "clamp" });
  const [lead, ...rest] = text.split(" ");
  return (
    <AbsoluteFill style={{ background: "rgba(11, 11, 15, 0.96)", opacity, alignItems: "center", justifyContent: "center" }}>
      <div
        style={{
          transform: `translateY(${rise}px)`,
          fontFamily: fonts.sans,
          fontWeight: 700,
          fontSize: 120,
          letterSpacing: -3,
          color: colors.paper,
          ...tabular,
        }}
      >
        <span style={{ color: colors.accent }}>{lead}</span> {rest.join(" ")}
      </div>
    </AbsoluteFill>
  );
};
