// ElevenLabs voiceover: one text-to-speech call per scene in script.json,
// saved as video/audio/<scene>.mp3. Plain fetch, no SDK.
//
//   npx tsx voiceover.ts --dry-run                       print the lines, call nothing
//   npx tsx voiceover.ts --api https://hunch.vercel.app  fill traction from GET /api/leaderboard
//   npx tsx voiceover.ts --counters counters.json        fill traction from a saved JSON
//   npx tsx voiceover.ts --only hook                     regenerate one scene
//   npx tsx voiceover.ts --model eleven_v4               another model id
//
// Endpoint confirmed against the ElevenLabs API reference on 2026-10-11:
//   POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}?output_format=mp3_44100_128
//   headers: xi-api-key, Content-Type: application/json
//   body: { text, model_id, voice_settings }. Default model id: eleven_multilingual_v2
//   (the docs' recommendation for video narration; eleven_v4 is the newer high quality option).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(here, ".env"), quiet: true });

const API_BASE = "https://api.elevenlabs.io/v1/text-to-speech";
const OUTPUT_FORMAT = "mp3_44100_128";
const DEFAULT_MODEL = "eleven_multilingual_v2";
const MP3_KBPS = 128;

type Scene = { id: string; start: number; end: number; voiceover: string };
type Script = { scenes: Scene[] };
type Counters = { players: number; calls: number; leader: string; leaderEdge: number };
type LeaderboardResponse = {
  rows?: Array<{ rank: number; name: string; edgeTotal: number }>;
  counters?: { players: number; calls: number; geminiOrders: number };
};

const PLACEHOLDER = /\{(players|calls|leader|leaderEdge)\}/g;

// ---------- args ----------

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return undefined;
  const value = process.argv[i + 1];
  if (!value || value.startsWith("--")) fail(`--${name} needs a value`);
  return value;
}
const flag = (name: string): boolean => process.argv.includes(`--${name}`);

function fail(message: string, code = 1): never {
  console.error(message);
  process.exit(code);
}

// ---------- numbers as words ----------

const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

function integerWords(n: number): string {
  if (n < 20) return ONES[n] as string;
  if (n < 100) return (TENS[Math.floor(n / 10)] as string) + (n % 10 ? `-${ONES[n % 10]}` : "");
  if (n < 1000) return `${ONES[Math.floor(n / 100)]} hundred${n % 100 ? ` ${integerWords(n % 100)}` : ""}`;
  if (n < 1_000_000) return `${integerWords(Math.floor(n / 1000))} thousand${n % 1000 ? ` ${integerWords(n % 1000)}` : ""}`;
  return `${integerWords(Math.floor(n / 1_000_000))} million${n % 1_000_000 ? ` ${integerWords(n % 1_000_000)}` : ""}`;
}

/** 12 -> "twelve"; 12.5 -> "twelve point five"; -3 -> "minus three". Edge keeps one decimal. */
export function numberWords(value: number): string {
  if (!Number.isFinite(value)) fail(`Cannot say ${value} in words`);
  const sign = value < 0 ? "minus " : "";
  const abs = Math.abs(value);
  const rounded = Math.round(abs * 10) / 10;
  const whole = Math.floor(rounded);
  const tenth = Math.round((rounded - whole) * 10);
  if (tenth === 0) return sign + integerWords(whole);
  return `${sign}${integerWords(whole)} point ${ONES[tenth]}`;
}

function fillWords(text: string, counters: Counters | null): string {
  if (!counters) return text;
  return text.replace(PLACEHOLDER, (_m, key: keyof Counters) => {
    const v = counters[key];
    return typeof v === "string" ? v : numberWords(v);
  });
}

// ---------- counters ----------

function countersFromLeaderboard(data: LeaderboardResponse, source: string): Counters {
  const row = data.rows?.[0];
  if (!data.counters || typeof data.counters.players !== "number" || typeof data.counters.calls !== "number") {
    fail(`${source} has no counters.players / counters.calls (expected { rows, counters } from GET /api/leaderboard)`);
  }
  if (!row || typeof row.name !== "string" || typeof row.edgeTotal !== "number") {
    fail(`${source} has no leaderboard rows yet, so there is no leader to name. Wait for a settled call or skip the traction scene.`);
  }
  return { players: data.counters.players, calls: data.counters.calls, leader: row.name, leaderEdge: row.edgeTotal };
}

async function resolveCounters(): Promise<Counters | null> {
  const file = arg("counters");
  const api = arg("api");
  if (file && api) fail("Pass --counters or --api, not both");
  if (file) {
    const raw = JSON.parse(fs.readFileSync(path.resolve(file), "utf8")) as Partial<Counters> & LeaderboardResponse;
    if (typeof raw.players === "number" && typeof raw.calls === "number" && typeof raw.leader === "string" && typeof raw.leaderEdge === "number") {
      return { players: raw.players, calls: raw.calls, leader: raw.leader, leaderEdge: raw.leaderEdge };
    }
    return countersFromLeaderboard(raw, file);
  }
  if (api) {
    const url = `${api.replace(/\/+$/, "")}/api/leaderboard`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) fail(`GET ${url} returned ${res.status}`);
    return countersFromLeaderboard((await res.json()) as LeaderboardResponse, url);
  }
  return null;
}

// ---------- ElevenLabs ----------

async function synthesize(text: string, apiKey: string, voiceId: string, model: string): Promise<Buffer> {
  const url = `${API_BASE}/${encodeURIComponent(voiceId)}?output_format=${OUTPUT_FORMAT}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "xi-api-key": apiKey, "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify({
      text,
      model_id: model,
      voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0, use_speaker_boost: true, speed: 1.0 },
    }),
  });
  if (!res.ok) {
    const body = (await res.text()).slice(0, 400);
    throw new Error(`ElevenLabs returned ${res.status}: ${body}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

// ---------- main ----------

async function main() {
  const script = JSON.parse(fs.readFileSync(path.join(here, "script.json"), "utf8")) as Script;
  const only = arg("only");
  const model = arg("model") ?? DEFAULT_MODEL;
  const dryRun = flag("dry-run");
  const audioDir = path.join(here, "audio");

  const scenes = only ? script.scenes.filter((s) => s.id === only) : script.scenes;
  if (only && scenes.length === 0) fail(`script.json has no scene "${only}"`);

  const counters = await resolveCounters();
  if (counters && counters.leaderEdge <= 0) {
    fail(`The leader (${counters.leader}) has ${counters.leaderEdge} Edge, so "beating the market by" would be false. Wait for the board to move or rephrase the traction line in script.json.`);
  }

  const jobs = scenes.map((scene) => ({ scene, text: fillWords(scene.voiceover, counters) }));
  const hasPlaceholders = (text: string) => {
    PLACEHOLDER.lastIndex = 0;
    return PLACEHOLDER.test(text);
  };
  const skipped = jobs.filter((j) => hasPlaceholders(j.text));
  const ready = jobs.filter((j) => !hasPlaceholders(j.text));

  for (const j of ready) {
    console.log(`${j.scene.id.padEnd(9)} ${j.scene.start}s to ${j.scene.end}s  ${j.text.length} chars`);
    console.log(`          ${j.text}`);
  }
  for (const j of skipped) {
    console.log(`${j.scene.id.padEnd(9)} skipped: placeholders not filled. Pass --api <url> or --counters <file>.`);
  }

  if (dryRun) {
    console.log(skipped.length ? "\nDry run. Some scenes are not ready." : "\nDry run. Every line is ready.");
    process.exit(skipped.length ? 2 : 0);
  }

  const apiKey = process.env.ELEVENLABS_API_KEY;
  const voiceId = process.env.ELEVENLABS_VOICE_ID;
  if (!apiKey) fail("Missing ELEVENLABS_API_KEY in video/.env (copy video/.env.example to video/.env and add the key from elevenlabs.io)");
  if (!voiceId) fail("Missing ELEVENLABS_VOICE_ID in video/.env (pick a voice at elevenlabs.io and paste its id)");

  fs.mkdirSync(audioDir, { recursive: true });

  for (const j of ready) {
    const out = path.join(audioDir, `${j.scene.id}.mp3`);
    const started = Date.now();
    const bytes = await synthesize(j.text, apiKey, voiceId, model);
    fs.writeFileSync(out, bytes);
    const estSeconds = (bytes.length * 8) / (MP3_KBPS * 1000);
    const window = j.scene.end - j.scene.start;
    const warn = estSeconds > window ? `  LONGER than the ${window}s scene; trim the line or move "end" in script.json` : "";
    console.log(`wrote audio/${j.scene.id}.mp3  about ${estSeconds.toFixed(1)}s of ${window}s  (${Date.now() - started} ms)${warn}`);
  }

  if (counters) {
    const countersPath = path.join(audioDir, "counters.json");
    fs.writeFileSync(countersPath, JSON.stringify({ ...counters, fetchedAt: new Date().toISOString(), model }, null, 2));
    console.log(`wrote audio/counters.json (${counters.players} players, ${counters.calls} calls, ${counters.leader} ${counters.leaderEdge} Edge) for the traction overlay`);
  }

  if (skipped.length) {
    console.log(`\n${skipped.length} scene(s) skipped. Re-run with --api <url> --only traction once the leaderboard has rows.`);
    process.exit(2);
  }
}

main().catch((err: unknown) => {
  fail(err instanceof Error ? err.message : String(err));
});
