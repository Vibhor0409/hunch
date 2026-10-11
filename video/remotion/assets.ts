// Probes for the files the composition may or may not have yet. Runs in the
// browser inside calculateMetadata, in the Studio and once per render.
import { staticFile } from "remotion";
import { CLIP_IDS, type ClipId, type Counters, type Script } from "./script";

export type ClipAvailability = Record<ClipId, boolean>;
export type AudioAvailability = Record<string, boolean>;

async function fileExists(url: string, signal?: AbortSignal): Promise<boolean> {
  try {
    const res = await fetch(url, { method: "GET", headers: { Range: "bytes=0-0" }, signal });
    const type = res.headers.get("content-type") ?? "";
    // Dev servers answer unknown paths with the index page; treat that as missing.
    const ok = (res.ok || res.status === 206) && !type.includes("text/html");
    try {
      await res.body?.cancel();
    } catch {
      // nothing to release
    }
    return ok;
  } catch {
    return false;
  }
}

export async function probeClips(signal?: AbortSignal): Promise<ClipAvailability> {
  const entries = await Promise.all(
    CLIP_IDS.map(async (id) => [id, await fileExists(staticFile(`capture/${id}.mp4`), signal)] as const),
  );
  return Object.fromEntries(entries) as ClipAvailability;
}

export async function probeAudio(script: Script, signal?: AbortSignal): Promise<AudioAvailability> {
  const entries = await Promise.all(
    script.scenes.map(async (scene) => [scene.id, await fileExists(staticFile(`audio/${scene.id}.mp3`), signal)] as const),
  );
  return Object.fromEntries(entries);
}

/** voiceover.ts writes audio/counters.json after filling the traction line. */
export async function readCounters(signal?: AbortSignal): Promise<Counters | null> {
  try {
    const res = await fetch(staticFile("audio/counters.json"), { signal });
    const type = res.headers.get("content-type") ?? "";
    if (!res.ok || type.includes("text/html")) return null;
    const data = (await res.json()) as Partial<Counters>;
    if (
      typeof data.players !== "number" ||
      typeof data.calls !== "number" ||
      typeof data.leader !== "string" ||
      typeof data.leaderEdge !== "number"
    ) {
      return null;
    }
    return { players: data.players, calls: data.calls, leader: data.leader, leaderEdge: data.leaderEdge };
  } catch {
    return null;
  }
}
