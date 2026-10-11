import { Composition, type CalculateMetadataFunction } from "remotion";
import { probeAudio, probeClips, readCounters } from "./assets";
import { HunchDemo, type HunchDemoProps } from "./HunchDemo";
import { CLIP_IDS, script, toFrames, totalSeconds, validateScript } from "./script";

const defaultProps: HunchDemoProps = {
  // Pass the real repo URL at render time: --props '{"github":"https://github.com/<owner>/hunch"}'
  github: "",
  // Filled from audio/counters.json (written by voiceover.ts) or from --props. Never typed in.
  counters: null,
  clips: Object.fromEntries(CLIP_IDS.map((id) => [id, false])) as HunchDemoProps["clips"],
  audio: {},
};

const calculateMetadata: CalculateMetadataFunction<HunchDemoProps> = async ({ props, abortSignal }) => {
  validateScript(script);
  const [clips, audio, fileCounters] = await Promise.all([
    probeClips(abortSignal),
    probeAudio(script, abortSignal),
    props.counters ? Promise.resolve(null) : readCounters(abortSignal),
  ]);
  return {
    durationInFrames: toFrames(totalSeconds(script)),
    fps: script.fps,
    width: script.width,
    height: script.height,
    props: { ...props, clips, audio, counters: props.counters ?? fileCounters },
  };
};

export const Root = () => {
  return (
    <Composition
      id="HunchDemo"
      component={HunchDemo}
      durationInFrames={toFrames(totalSeconds(script))}
      fps={script.fps}
      width={script.width}
      height={script.height}
      defaultProps={defaultProps}
      calculateMetadata={calculateMetadata}
    />
  );
};
