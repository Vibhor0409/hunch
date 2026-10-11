// The whole cut: hook, app scenes in the phone, end card, captions, voiceover.
import { AbsoluteFill, Sequence, useVideoConfig } from "remotion";
import type { AudioAvailability, ClipAvailability } from "./assets";
import { AppStage } from "./scenes/AppStage";
import { Captions } from "./scenes/Captions";
import { EndCard } from "./scenes/EndCard";
import { Hook } from "./scenes/Hook";
import { Overlay } from "./scenes/Overlay";
import { PhoneGlow } from "./scenes/PhoneFrame";
import { Voiceover } from "./scenes/Voiceover";
import type { Counters } from "./script";
import { appScenes, script, toFrames } from "./script";
import { colors } from "./theme";

export type HunchDemoProps = {
  github: string;
  counters: Counters | null;
  clips: ClipAvailability;
  audio: AudioAvailability;
};

export const HunchDemo = ({ github, counters, clips, audio }: HunchDemoProps) => {
  const { fps } = useVideoConfig();
  const app = appScenes(script);
  const firstApp = app[0];
  const lastApp = app[app.length - 1];

  return (
    <AbsoluteFill style={{ background: colors.bg }}>
      {script.scenes.map((scene) => {
        const from = toFrames(scene.start, fps);
        const length = toFrames(scene.end, fps) - from;
        if (scene.kind === "kinetic") {
          return (
            <Sequence key={scene.id} from={from} durationInFrames={length} name={`scene ${scene.id}`}>
              <Hook scene={scene} />
            </Sequence>
          );
        }
        if (scene.kind === "end") {
          return (
            <Sequence key={scene.id} from={from} durationInFrames={length} name={`scene ${scene.id}`}>
              <EndCard scene={scene} github={github} />
            </Sequence>
          );
        }
        return null;
      })}

      {/* Layer order matters: glow, then overlays, then the stage whose title card and diagram cover them. */}
      {firstApp && lastApp ? (
        <Sequence from={toFrames(firstApp.start, fps)} durationInFrames={toFrames(lastApp.end, fps) - toFrames(firstApp.start, fps)} name="phone glow">
          <PhoneGlow />
        </Sequence>
      ) : null}

      {app.map((scene) => {
        const from = toFrames(scene.start, fps);
        return (
          <Sequence key={`overlay-${scene.id}`} from={from} durationInFrames={toFrames(scene.end, fps) - from} name={`overlay ${scene.id}`}>
            <Overlay scene={scene} counters={counters} />
          </Sequence>
        );
      })}

      {firstApp && lastApp ? (
        <Sequence from={toFrames(firstApp.start, fps)} durationInFrames={toFrames(lastApp.end, fps) - toFrames(firstApp.start, fps)} name="app stage">
          <AppStage scenes={app} clips={clips} />
        </Sequence>
      ) : null}

      <Captions scenes={script.scenes} counters={counters} />
      <Voiceover scenes={script.scenes} audio={audio} />
    </AbsoluteFill>
  );
};
