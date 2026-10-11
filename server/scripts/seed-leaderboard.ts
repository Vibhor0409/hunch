// Leaderboard seed: writes 14 named players with settled practice swipes so the
// board is populated from the first launch. Real players accumulate alongside.
//
//   npx tsx scripts/seed-leaderboard.ts            add the seed (skips names that already exist)
//   npx tsx scripts/seed-leaderboard.ts --remove   delete exactly the seed players (cascade removes their swipes)
//
// Run from server/. Loads server/.env.local. Deterministic: a fixed PRNG seed
// picks the same markets, sides and results every run, so re-runs rebuild the
// same board. Markets come from docs/samples/events.json and
// events-production.json (real Gemini contracts); questions follow the card
// text rule in docs/GEMINI_API.md; Edge uses edgeFor from lib/game/scoring.ts.
// This is a script that writes database rows, not app source data.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";

loadEnv({ path: fileURLToPath(new URL("../.env.local", import.meta.url)), quiet: true });

import { getDb, leaderboardRows, type SwipeInsert } from "../lib/db";
import { edgeFor, laDayBounds, laneFor } from "../lib/game";
import { questionFor } from "../lib/gemini/cards";
import type { GeminiContract, GeminiEvent } from "../lib/gemini/client";
import type { Lane, Side } from "../lib/types";

// ---------- Seed definition ----------

interface SeedPlayer {
  name: string;
  /** Settled practice swipes to write, 6 to 24. */
  calls: number;
  /** Target average Edge per call, -1.2 to 2.4. */
  avgEdge: number;
}

/** The seed board. Edge per call runs from -10 to +10, so totals stay under 60. */
const SEED_PLAYERS: readonly SeedPlayer[] = [
  { name: "Maya R.", calls: 24, avgEdge: 2.4 },
  { name: "Devin K.", calls: 21, avgEdge: 2.1 },
  { name: "Priya S.", calls: 22, avgEdge: 1.7 },
  { name: "Jonah T.", calls: 18, avgEdge: 1.8 },
  { name: "Lena M.", calls: 16, avgEdge: 1.5 },
  { name: "Marcus W.", calls: 20, avgEdge: 0.9 },
  { name: "Sofia B.", calls: 12, avgEdge: 1.2 },
  { name: "Theo L.", calls: 14, avgEdge: 0.6 },
  { name: "Aisha N.", calls: 9, avgEdge: 0.7 },
  { name: "Caleb H.", calls: 11, avgEdge: 0.2 },
  { name: "Nora P.", calls: 8, avgEdge: 0.0 },
  { name: "Ravi D.", calls: 10, avgEdge: -0.4 },
  { name: "Elena V.", calls: 7, avgEdge: -0.8 },
  { name: "Owen F.", calls: 6, avgEdge: -1.2 },
];

/** Fixed PRNG seed. Change it to get a different (but still repeatable) board. */
const SEED = 20261011;
/** Swipes are spread over this many hours before the run, inside the LA day. */
const SPREAD_HOURS = 6;

const SAMPLE_FILES = ["events.json", "events-production.json"] as const;
const SAMPLES_DIR = fileURLToPath(new URL("../../docs/samples/", import.meta.url));

const MINUTE_MS = 60_000;

// ---------- Deterministic randomness ----------

/** mulberry32: small, fast, repeatable. Returns numbers in [0, 1). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function between(rng: () => number, min: number, max: number): number {
  return min + rng() * (max - min);
}

/** Fisher-Yates on a copy, driven by rng. */
function shuffle<T>(items: readonly T[], rng: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// ---------- Market pool from the samples ----------

interface Market {
  eventTicker: string;
  instrumentSymbol: string;
  question: string;
  category: string;
  /** Real contract expiry, used only to pick the lane the deck would have shown. */
  expiryDate: string | null;
  /** Buy prices as numbers strictly inside (0, 1); null when the sample had none. */
  yesPrice: number | null;
  noPrice: number | null;
}

function parsePrice(value: unknown): number | null {
  if (typeof value !== "string" || value === "") return null;
  const price = Number(value);
  return Number.isFinite(price) && price > 0 && price < 1 ? price : null;
}

function loadEvents(file: string): GeminiEvent[] {
  const raw = JSON.parse(readFileSync(SAMPLES_DIR + file, "utf8")) as { data?: unknown[] };
  return (raw.data ?? []) as GeminiEvent[];
}

/**
 * Every open, active contract across both samples, de-duplicated by
 * instrument symbol, in file order (so the pool is stable between runs).
 */
function marketPool(): Market[] {
  const seen = new Set<string>();
  const pool: Market[] = [];
  for (const file of SAMPLE_FILES) {
    for (const event of loadEvents(file)) {
      if (event.status !== "active" || !event.ticker) continue;
      for (const contract of event.contracts ?? []) {
        if (!contract.instrumentSymbol || seen.has(contract.instrumentSymbol)) continue;
        if (contract.marketState !== "open" || contract.status !== "active") continue;
        seen.add(contract.instrumentSymbol);
        const buy = (contract as GeminiContract).prices?.buy;
        pool.push({
          eventTicker: event.ticker,
          instrumentSymbol: contract.instrumentSymbol,
          question: questionFor(event, contract),
          category: event.category ?? "Other",
          expiryDate: contract.expiryDate ?? event.expiryDate ?? null,
          yesPrice: parsePrice(buy?.yes),
          noPrice: parsePrice(buy?.no),
        });
      }
    }
  }
  return pool;
}

/** Contracts quoted on both sides between 5 and 95 cents read as real calls, not ladder tails. */
function isMidRange(market: Market): boolean {
  return (
    market.yesPrice !== null &&
    market.noPrice !== null &&
    market.yesPrice >= 0.05 &&
    market.yesPrice <= 0.95 &&
    market.noPrice >= 0.05 &&
    market.noPrice <= 0.95
  );
}

// ---------- Building one player's swipes ----------

interface PlannedSwipe {
  market: Market;
  side: Side;
  price: number;
  won: boolean;
  edge: number;
  lane: Lane;
  createdAt: Date;
  expiresAt: Date;
  settledAt: Date;
}

function tenths(edge: number): number {
  return Math.round(edge * 10);
}

/**
 * Picks `calls` distinct markets, a side and the price of that side (0.50
 * when the sample had no quote), then chooses won/lost so the average Edge
 * lands near the target: greedy toward the target with a coin flip when
 * already close, then one corrective flip of whichever call helps most.
 */
function planSwipes(player: SeedPlayer, pool: readonly Market[], rng: () => number, now: Date): PlannedSwipe[] {
  const preferred = shuffle(pool.filter(isMidRange), rng);
  const fallback = shuffle(pool.filter((market) => !isMidRange(market)), rng);
  const picks = [...preferred, ...fallback].slice(0, player.calls);
  if (picks.length < player.calls) throw new Error(`market pool too small for ${player.name}: ${picks.length} < ${player.calls}`);

  // Time window: the last SPREAD_HOURS, clipped to the LA day, ending two minutes ago.
  const dayStart = new Date(laDayBounds(now).startIso).getTime() + MINUTE_MS;
  const windowEnd = now.getTime() - 2 * MINUTE_MS;
  const windowStart = Math.max(windowEnd - SPREAD_HOURS * 60 * MINUTE_MS, dayStart);
  if (windowEnd - windowStart < 15 * MINUTE_MS) throw new Error("too early in the LA day to spread the seed; run again after 12:20 AM Pacific");

  const planned: PlannedSwipe[] = picks.map((market) => {
    const side: Side = rng() < 0.5 ? "yes" : "no";
    const quoted = side === "yes" ? market.yesPrice : market.noPrice;
    const price = quoted ?? 0.5;
    const createdMs = between(rng, windowStart, windowEnd - 6 * MINUTE_MS);
    const expiresMs = createdMs + between(rng, 1, 3) * MINUTE_MS;
    const settledMs = Math.min(expiresMs + between(rng, 1, 3) * MINUTE_MS, windowEnd);
    const createdAt = new Date(createdMs);
    return {
      market,
      side,
      price,
      won: false,
      edge: 0,
      lane: (market.expiryDate ? laneFor(market.expiryDate, createdAt) : null) ?? "week",
      createdAt,
      expiresAt: new Date(expiresMs),
      settledAt: new Date(settledMs),
    };
  });
  planned.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  // Outcomes: steer the running average toward the target.
  let total = 0; // integer tenths
  planned.forEach((swipe, index) => {
    const runningAvg = index === 0 ? 0 : total / (10 * index);
    const gap = player.avgEdge - runningAvg;
    const won = gap > 0.3 ? true : gap < -0.3 ? false : rng() < 0.5;
    swipe.won = won;
    swipe.edge = edgeFor(swipe.price, won);
    total += tenths(swipe.edge);
  });

  // One corrective flip if it brings the average closer to the target.
  const targetTenths = Math.round(player.avgEdge * 10 * planned.length);
  let bestIndex = -1;
  let bestError = Math.abs(total - targetTenths);
  planned.forEach((swipe, index) => {
    const flipped = tenths(edgeFor(swipe.price, !swipe.won));
    const error = Math.abs(total - tenths(swipe.edge) + flipped - targetTenths);
    if (error < bestError) {
      bestError = error;
      bestIndex = index;
    }
  });
  if (bestIndex >= 0) {
    const swipe = planned[bestIndex];
    swipe.won = !swipe.won;
    swipe.edge = edgeFor(swipe.price, swipe.won);
  }
  return planned;
}

function toInsert(playerId: string, swipe: PlannedSwipe): SwipeInsert {
  return {
    player_id: playerId,
    event_ticker: swipe.market.eventTicker,
    instrument_symbol: swipe.market.instrumentSymbol,
    question: swipe.market.question,
    category: swipe.market.category,
    lane: swipe.lane,
    side: swipe.side,
    price: swipe.price,
    mode: "practice",
    stake: 0,
    contracts: 0,
    order_id: null,
    order_status: null,
    expires_at: swipe.expiresAt.toISOString(),
    settled: true,
    won: swipe.won,
    edge: swipe.edge,
    payout: 0,
    settled_at: swipe.settledAt.toISOString(),
    created_at: swipe.createdAt.toISOString(),
  };
}

// ---------- Database steps ----------

/** Existing players whose name matches a seed name ignoring case: id by lower(name). */
async function existingSeedPlayers(): Promise<Map<string, { id: string; name: string }>> {
  const wanted = new Set(SEED_PLAYERS.map((player) => player.name.toLowerCase()));
  const { data, error } = await getDb().from("players").select("id, name");
  if (error) throw new Error(`reading players failed: ${error.message}`);
  const found = new Map<string, { id: string; name: string }>();
  for (const row of data) {
    const key = row.name.toLowerCase();
    if (wanted.has(key)) found.set(key, row);
  }
  return found;
}

async function insertPlayerWithSwipes(player: SeedPlayer, swipes: PlannedSwipe[]): Promise<void> {
  const db = getDb();
  const firstSwipe = swipes[0].createdAt.getTime();
  const createdAt = new Date(firstSwipe - between(mulberry32(firstSwipe), 3, 20) * MINUTE_MS).toISOString();
  const created = await db.from("players").insert({ name: player.name, created_at: createdAt }).select().single();
  if (created.error) throw new Error(`insert player ${player.name} failed: ${created.error.message} (code ${created.error.code})`);
  const playerId = created.data.id;

  const inserted = await db.from("swipes").insert(swipes.map((swipe) => toInsert(playerId, swipe)));
  if (inserted.error) {
    await db.from("players").delete().eq("id", playerId); // cascade removes any partial swipes
    throw new Error(`insert swipes for ${player.name} failed: ${inserted.error.message} (code ${inserted.error.code})`);
  }
}

function pad(value: string | number, width: number, right = false): string {
  const text = String(value);
  return right ? text.padStart(width) : text.padEnd(width);
}

async function printTop5(): Promise<void> {
  const top = await leaderboardRows(5);
  console.log("\nLeaderboard view, top 5:");
  console.log(`${pad("#", 3)} ${pad("name", 16)} ${pad("edge", 7, true)} ${pad("settled", 8, true)} ${pad("total", 6, true)}`);
  top.forEach((row, index) => {
    console.log(`${pad(index + 1, 3)} ${pad(row.name, 16)} ${pad(row.edgeTotal.toFixed(1), 7, true)} ${pad(row.settledCalls, 8, true)} ${pad(row.totalCalls, 6, true)}`);
  });
}

async function seed(): Promise<void> {
  const now = new Date();
  const pool = marketPool();
  const midRange = pool.filter(isMidRange).length;
  console.log(`market pool: ${pool.length} open contracts from ${SAMPLE_FILES.join(" and ")} (${midRange} quoted mid-range)`);

  const existing = await existingSeedPlayers();
  console.log(`\n${pad("name", 16)} ${pad("calls", 6, true)} ${pad("edge", 7, true)}  note`);

  let added = 0;
  for (const [index, player] of SEED_PLAYERS.entries()) {
    const found = existing.get(player.name.toLowerCase());
    if (found) {
      console.log(`${pad(player.name, 16)} ${pad("-", 6, true)} ${pad("-", 7, true)}  skipped, "${found.name}" already exists`);
      continue;
    }
    const rng = mulberry32(SEED + index * 7919);
    const swipes = planSwipes(player, pool, rng, now);
    const edgeTotal = swipes.reduce((sum, swipe) => sum + tenths(swipe.edge), 0) / 10;
    await insertPlayerWithSwipes(player, swipes);
    added += 1;
    const won = swipes.filter((swipe) => swipe.won).length;
    console.log(`${pad(player.name, 16)} ${pad(swipes.length, 6, true)} ${pad(edgeTotal.toFixed(1), 7, true)}  added (${won} right, avg ${(edgeTotal / swipes.length).toFixed(2)}, target ${player.avgEdge.toFixed(1)})`);
  }
  console.log(`\nseeded ${added} player(s), skipped ${SEED_PLAYERS.length - added}`);
  await printTop5();
}

async function remove(): Promise<void> {
  const existing = await existingSeedPlayers();
  if (existing.size === 0) {
    console.log("no seed players found; nothing removed");
    await printTop5();
    return;
  }
  const ids = [...existing.values()].map((row) => row.id);
  const { error } = await getDb().from("players").delete().in("id", ids);
  if (error) throw new Error(`delete failed: ${error.message} (code ${error.code})`);
  for (const row of existing.values()) console.log(`removed ${row.name} (${row.id})`);
  console.log(`\nremoved ${ids.length} seed player(s) and their swipes`);
  await printTop5();
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const unknown = args.filter((arg) => arg !== "--remove");
  if (unknown.length > 0) throw new Error(`unknown argument(s): ${unknown.join(" ")}. Use --remove or no arguments.`);
  if (args.includes("--remove")) await remove();
  else await seed();
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`SEED FAILED: ${message}`);
  process.exitCode = 1;
});
