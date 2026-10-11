// One ElevenLabs clip per scene, starting with the scene, when the mp3 exists.
import { Audio, Sequence, staticFile, useVideoConfig } from "remotion";
import type { AudioAvailability } from "../assets";
import type { Scene } from "../script";
import { toFrames } from "../script";

export const Voiceover = ({ scenes, audio }: { scenes: Scene[]; audio: AudioAvailability }) => {
  const { fps } = useVideoConfig();
  return (
    <>
      {scenes.map((scene) =>
        audio[scene.id] ? (
          <Sequence key={`vo-${scene.id}`} from={toFrames(scene.start, fps)} name={`voiceover ${scene.id}`}>
            <Audio src={staticFile(`audio/${scene.id}.mp3`)} />
          </Sequence>
        ) : null,
      )}
    </>
  );
};
