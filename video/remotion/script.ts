// Typed access to script.json plus the frame math every scene shares.
import scriptJson from "../script.json";

export type SceneId = "hook" | "intro" | "blind" | "real" | "limit" | "traction" | "end";
export type ClipId = "intro" | "blind" | "real" | "settled" | "limit" | "traction";
export const CLIP_IDS: ClipId[] = ["intro", "blind", "real", "settled", "limit", "traction"];

export type ClipSegment = {
  type: "clip";
  clip: ClipId;
  start: number;
  end: number;
  clipIn?: number;
  rate?: number;
};
export type TitleSegment = { type: "title"; text: string; start: number; end: number };
export type DiagramSegment = { type: "diagram"; start: number; end: number };
export type Segment = ClipSegment | TitleSegment | DiagramSegment;

export type Scene = {
  id: SceneId;
  kind: "kinetic" | "app" | "end";
  start: number;
  end: number;
  voiceover: string;
  captions: string[];
  overlay?: string | string[];
  beats?: Record<string, number>;
  segments?: Segment[];
};

export type Script = {
  title: string;
  fps: number;
  width: number;
  height: number;
  maxSeconds: number;
  scenes: Scene[];
};

/** Live counters for the traction scene. Filled from GET /api/leaderboard, never typed in. */
export type Counters = {
  players: number;
  calls: number;
  leader: string;
  leaderEdge: number;
};

export const script = scriptJson as unknown as Script;

export function validateScript(s: Script): void {
  if (!Array.isArray(s.scenes) || s.scenes.length === 0) throw new Error("script.json has no scenes");
  let cursor = 0;
  for (const scene of s.scenes) {
    if (scene.start !== cursor) {
      throw new Error(`script.json: scene "${scene.id}" starts at ${scene.start}s but the previous scene ends at ${cursor}s`);
    }
    if (scene.end <= scene.start) throw new Error(`script.json: scene "${scene.id}" has no length`);
    cursor = scene.end;
    for (const seg of scene.segments ?? []) {
      if (seg.start < scene.start || seg.end > scene.end || seg.end <= seg.start) {
        throw new Error(`script.json: a segment of "${scene.id}" (${seg.start}s to ${seg.end}s) falls outside the scene`);
      }
    }
  }
  if (cursor > s.maxSeconds) {
    throw new Error(`script.json runs ${cursor}s, over the ${s.maxSeconds}s limit`);
  }
}

export const toFrames = (seconds: number, fps: number = script.fps): number => Math.round(seconds * fps);

export const totalSeconds = (s: Script = script): number => s.scenes[s.scenes.length - 1]?.end ?? 0;

export const sceneById = (id: SceneId, s: Script = script): Scene => {
  const scene = s.scenes.find((x) => x.id === id);
  if (!scene) throw new Error(`script.json has no scene "${id}"`);
  return scene;
};

export const appScenes = (s: Script = script): Scene[] => s.scenes.filter((x) => x.kind === "app");

/** All clip segments across the app scenes, in order. */
export const clipSegments = (s: Script = script): ClipSegment[] =>
  appScenes(s).flatMap((scene) => (scene.segments ?? []).filter((seg): seg is ClipSegment => seg.type === "clip"));

export const PLACEHOLDER = /\{(players|calls|leader|leaderEdge)\}/g;

export const hasPlaceholders = (text: string): boolean => {
  PLACEHOLDER.lastIndex = 0;
  return PLACEHOLDER.test(text);
};

/** Digits for on-screen text. Edge keeps one decimal, as the database stores it. */
export const formatCounter = (key: keyof Counters, counters: Counters): string => {
  const value = counters[key];
  if (typeof value === "string") return value;
  if (key === "leaderEdge") return Number.isInteger(value) ? String(value) : value.toFixed(1);
  return value.toLocaleString("en-US");
};

export function fillDigits(text: string, counters: Counters | null): string | null {
  if (!hasPlaceholders(text)) return text;
  if (!counters) return null;
  return text.replace(PLACEHOLDER, (_m, key: keyof Counters) => formatCounter(key, counters));
}

/**
 * Caption windows: spread a scene's captions across its speech window in
 * proportion to their length. Voiceover rarely fills the whole scene, so the
 * last caption ends a little before the scene does.
 */
export const SPEECH_SHARE = 0.92;

export function captionWindows(captions: string[], startFrame: number, endFrame: number) {
  const span = Math.round((endFrame - startFrame) * SPEECH_SHARE);
  const total = captions.reduce((n, c) => n + Math.max(c.length, 1), 0);
  let cursor = startFrame;
  return captions.map((text, i) => {
    const share = Math.max(text.length, 1) / total;
    const length = i === captions.length - 1 ? startFrame + span - cursor : Math.round(span * share);
    const from = cursor;
    cursor += length;
    return { text, from, durationInFrames: Math.max(length, 1) };
  });
}
