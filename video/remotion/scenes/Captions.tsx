// Burned-in captions from script.json, one chunk at a time at the bottom.
import { getRemotionEnvironment, interpolate, Sequence, useCurrentFrame, useVideoConfig } from "remotion";
import type { Counters, Scene } from "../script";
import { captionWindows, fillDigits, toFrames } from "../script";
import { colors, fonts, layout, tabular } from "../theme";

export const Captions = ({ scenes, counters }: { scenes: Scene[]; counters: Counters | null }) => {
  const { fps } = useVideoConfig();
  const { isRendering } = getRemotionEnvironment();
  return (
    <>
      {scenes.flatMap((scene) =>
        captionWindows(scene.captions, toFrames(scene.start, fps), toFrames(scene.end, fps)).map((win, i) => {
          const text = fillDigits(win.text, counters);
          // Unfilled placeholders never reach a render. The Studio shows them raw for timing.
          const shown = text ?? (isRendering ? null : win.text);
          if (shown === null) return null;
          return (
            <Sequence key={`${scene.id}-cap-${i}`} from={win.from} durationInFrames={win.durationInFrames} name={`caption ${scene.id} ${i + 1}`}>
              <Caption text={shown} />
            </Sequence>
          );
        }),
      )}
    </>
  );
};

const Caption = ({ text }: { text: string }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const fade = Math.min(Math.round(fps * 0.15), Math.floor(durationInFrames / 2));
  const opacity = interpolate(frame, [0, fade, durationInFrames - fade, durationInFrames], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: layout.captionBottom,
        display: "flex",
        justifyContent: "center",
        opacity,
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          maxWidth: 1500,
          padding: "14px 28px",
          borderRadius: 18,
          background: colors.overlay,
          color: colors.paper,
          fontFamily: fonts.sans,
          fontSize: 38,
          fontWeight: 600,
          lineHeight: 1.25,
          textAlign: "center",
          ...tabular,
        }}
      >
        {text}
      </div>
    </div>
  );
};
