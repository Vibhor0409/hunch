// The phone stays on screen from the intro to the traction scene. Clips, the
// "5 minutes later" card and the architecture diagram are segments inside it.
// Transparent root: the composition draws the background and the glow below,
// so the full-frame title card and diagram cover the scene overlays.
import { AbsoluteFill, interpolate, Sequence, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { ClipAvailability } from "../assets";
import type { Scene, Segment } from "../script";
import { toFrames } from "../script";
import { Clip } from "./Clip";
import { Diagram } from "./Diagram";
import { PhoneFrame } from "./PhoneFrame";
import { TitleCard } from "./TitleCard";

export const AppStage = ({ scenes, clips }: { scenes: Scene[]; clips: ClipAvailability }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const first = scenes[0];
  if (!first) return null;
  const stageStart = toFrames(first.start, fps);
  const segments: Segment[] = scenes.flatMap((s) => s.segments ?? []);
  const rel = (seconds: number) => toFrames(seconds, fps) - stageStart;

  // Slide the phone in at the start of the intro.
  const slide = spring({ frame, fps, config: { damping: 18, stiffness: 90, mass: 1.1 } });
  const translateY = interpolate(slide, [0, 1], [1100, 0]);

  // Fade the phone out when the diagram takes over, and at the very end of the stage.
  const diagram = segments.find((s): s is Extract<Segment, { type: "diagram" }> => s.type === "diagram");
  const phoneOut = diagram
    ? interpolate(frame, [rel(diagram.start) - Math.round(fps * 0.2), rel(diagram.start)], [1, 0], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      })
    : interpolate(frame, [durationInFrames - Math.round(fps * 0.3), durationInFrames], [1, 0], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      });

  return (
    <AbsoluteFill>
      <PhoneFrame style={{ transform: `translateY(${translateY}px)`, opacity: phoneOut }}>
        {segments.map((seg) => {
          if (seg.type !== "clip") return null;
          return (
            <Sequence key={`${seg.clip}-${seg.start}`} from={rel(seg.start)} durationInFrames={rel(seg.end) - rel(seg.start)} name={`clip ${seg.clip}`}>
              <Clip segment={seg} available={clips[seg.clip]} />
            </Sequence>
          );
        })}
      </PhoneFrame>
      {segments.map((seg) => {
        if (seg.type === "title") {
          return (
            <Sequence key={`title-${seg.start}`} from={rel(seg.start)} durationInFrames={rel(seg.end) - rel(seg.start)} name="title card">
              <TitleCard text={seg.text} />
            </Sequence>
          );
        }
        if (seg.type === "diagram") {
          return (
            <Sequence key={`diagram-${seg.start}`} from={rel(seg.start)} durationInFrames={rel(seg.end) - rel(seg.start)} name="architecture">
              <Diagram />
            </Sequence>
          );
        }
        return null;
      })}
    </AbsoluteFill>
  );
};
