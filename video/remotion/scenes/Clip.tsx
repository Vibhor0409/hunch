// A captured clip inside the phone, or a dark placeholder when the file is
// missing so the composition still renders for timing checks.
import { OffthreadVideo, staticFile, useVideoConfig } from "remotion";
import type { ClipSegment } from "../script";
import { colors, fonts } from "../theme";

export const Clip = ({ segment, available }: { segment: ClipSegment; available: boolean }) => {
  const { fps } = useVideoConfig();
  if (!available) return <Placeholder id={segment.clip} />;
  return (
    <OffthreadVideo
      src={staticFile(`capture/${segment.clip}.mp4`)}
      trimBefore={Math.round((segment.clipIn ?? 2) * fps)}
      playbackRate={segment.rate ?? 1}
      muted
      style={{ width: "100%", height: "100%", objectFit: "cover" }}
    />
  );
};

const Placeholder = ({ id }: { id: string }) => {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        background: `linear-gradient(180deg, ${colors.surface} 0%, ${colors.bg} 100%)`,
        paddingBottom: 48,
        fontFamily: fonts.mono,
        fontSize: 16,
        color: colors.faint,
        letterSpacing: 1,
      }}
    >
      capture/{id}.mp4 missing
    </div>
  );
};
