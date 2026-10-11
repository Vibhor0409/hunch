// The card feed: a diverse, capped list of yes/no cards across every Gemini
// category, built from the production public listing (all categories, four
// pages in parallel) plus the sandbox listing (which contracts are tradable and
// their quotes), served from three tiers: memory (60 s), the feed_snapshot
// table (120 s), then a live build that refreshes both.
import type { CardQuote, Lane } from "../types";
import { buyPricesOf, isInformative, toCardQuote } from "./cards";
import { getPublicGemini, listActiveEvents, type GeminiClient, type GeminiContract, type GeminiEvent } from "./client";
import { loadSnapshot, saveSnapshot } from "./snapshot";

/** How long one feed is reused from memory per server instance. */
export const FEED_CACHE_MS = 60_000;
/** How long the database snapshot is served; past this a build is awaited. */
export const SNAPSHOT_TTL_MS = 120_000;
/** A failed build may serve a feed up to this old instead of failing. */
const STALE_LIMIT_MS = 10 * 60_000;
export const SNAPSHOT_KEY = "cards";
/** Production listing pages requested in parallel (952 events fit in two). */
const PRODUCTION_PAGES = 4;
/** Cards per category, applied separately to live cards and to the rest. */
export const CATEGORY_CAP = 40;
const LANE_ORDER: Lane[] = ["live", "tomorrow", "week", "later"];

export interface FeedState {
  /** Build time, epoch ms. */
  builtAt: number;
  cards: CardQuote[];
  source: "memory" | "snapshot" | "live";
}

interface FeedPayload {
  version: 1;
  cards: CardQuote[];
}

let memory: FeedState | null = null;
let building: Promise<FeedState> | null = null;
let lastSave: boolean | null = null;

/** Active cards with prices (see currentFeed for freshness). */
export async function fetchActiveCards(): Promise<CardQuote[]> {
  return (await currentFeed()).cards;
}

/**
 * The freshest feed within the TTLs: memory under 60 s; else the snapshot
 * under 120 s (kicking a background refresh once it passes 60 s); else a live
 * build, awaited. When the build fails, a feed under 10 minutes old is served
 * instead (the feed route re-checks every card's lane against its own clock).
 */
export async function currentFeed(): Promise<FeedState> {
  const now = Date.now();
  if (memory && now - memory.builtAt < FEED_CACHE_MS) return memory;
  const snapshot = await readSnapshot();
  if (snapshot && now - snapshot.builtAt < SNAPSHOT_TTL_MS) {
    adopt(snapshot);
    if (now - snapshot.builtAt >= FEED_CACHE_MS) refresh().catch(() => undefined);
    return snapshot;
  }
  try {
    return await refresh();
  } catch (error) {
    const fallback = memory ?? snapshot;
    if (fallback && now - fallback.builtAt < STALE_LIMIT_MS) return fallback;
    throw error;
  }
}

/** The feed from memory or the snapshot when it is younger than `maxAgeMs`, without building. */
export async function recentFeed(maxAgeMs: number): Promise<FeedState | null> {
  const now = Date.now();
  if (memory && now - memory.builtAt < maxAgeMs) return memory;
  const snapshot = await readSnapshot();
  if (snapshot && now - snapshot.builtAt < maxAgeMs) {
    adopt(snapshot);
    return snapshot;
  }
  return null;
}

/** Builds the feed live, then stores it in memory and in feed_snapshot. One build at a time. */
export function refresh(): Promise<FeedState> {
  if (!building) {
    building = buildFeed()
      .then(async (state) => {
        memory = state;
        const payload: FeedPayload = { version: 1, cards: state.cards };
        lastSave = await saveSnapshot(SNAPSHOT_KEY, payload);
        return state;
      })
      .finally(() => {
        building = null;
      });
  }
  return building;
}

/** Alias for scripts: a forced live build. */
export const rebuildFeed = refresh;

/** Whether the last snapshot write succeeded (null before any build). */
export function lastSnapshotSaved(): boolean | null {
  return lastSave;
}

function adopt(state: FeedState): void {
  if (!memory || state.builtAt > memory.builtAt) memory = state;
}

async function readSnapshot(): Promise<FeedState | null> {
  const snapshot = await loadSnapshot<unknown>(SNAPSHOT_KEY);
  if (!snapshot || !isFeedPayload(snapshot.payload)) return null;
  const builtAt = new Date(snapshot.fetchedAt).getTime();
  if (!Number.isFinite(builtAt)) return null;
  return { builtAt, cards: snapshot.payload.cards, source: "snapshot" };
}

function isFeedPayload(value: unknown): value is FeedPayload {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return record.version === 1 && Array.isArray(record.cards) && record.cards.every(isCardQuote);
}

function isCardQuote(value: unknown): value is CardQuote {
  if (typeof value !== "object" || value === null) return false;
  const card = value as Record<string, unknown>;
  return (
    typeof card.eventTicker === "string" &&
    typeof card.instrumentSymbol === "string" &&
    typeof card.question === "string" &&
    typeof card.category === "string" &&
    typeof card.lane === "string" &&
    (LANE_ORDER as string[]).includes(card.lane) &&
    typeof card.expiresAt === "string" &&
    typeof card.tradable === "boolean" &&
    typeof card.yesPrice === "number" &&
    typeof card.noPrice === "number"
  );
}

/**
 * One live build. Production (all categories) and the sandbox are read in
 * parallel; the sandbox is optional (its cards are then not tradable), and
 * production is optional when the sandbox answered. Throws when both failed.
 */
async function buildFeed(): Promise<FeedState> {
  const [production, sandbox] = await Promise.allSettled([
    getPublicGemini("production").then((client) => listActiveEvents(client, PRODUCTION_PAGES)),
    getPublicGemini("sandbox").then(listSandboxEvents),
  ]);
  if (production.status === "rejected" && sandbox.status === "rejected") {
    throw production.reason instanceof Error ? production.reason : new Error("feed build failed");
  }
  const productionEvents = production.status === "fulfilled" ? production.value : [];
  const sandboxEvents = sandbox.status === "fulfilled" ? sandbox.value : [];
  return { builtAt: Date.now(), cards: assemble(productionEvents, sandboxEvents, new Date()), source: "live" };
}

/**
 * The sandbox listing, read twice in parallel and merged, because the sandbox
 * answers from replicas that disagree (one lists about 90 events with 35
 * quoted contracts, another about 65 with 1). Per contract the quoted copy wins.
 */
async function listSandboxEvents(client: GeminiClient): Promise<GeminiEvent[]> {
  const results = await Promise.allSettled([listActiveEvents(client, 1), listActiveEvents(client, 1)]);
  const listings = results.filter((r): r is PromiseFulfilledResult<GeminiEvent[]> => r.status === "fulfilled").map((r) => r.value);
  if (listings.length === 0) {
    const failure = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
    throw failure?.reason instanceof Error ? failure.reason : new Error("sandbox listEvents failed");
  }
  const byTicker = new Map<string, GeminiEvent>();
  for (const listing of listings) {
    for (const event of listing) {
      if (!event.ticker) continue;
      const existing = byTicker.get(event.ticker);
      if (!existing) {
        byTicker.set(event.ticker, { ...event, contracts: [...(event.contracts ?? [])] });
        continue;
      }
      const contracts = existing.contracts ?? [];
      for (const contract of event.contracts ?? []) {
        const index = contracts.findIndex((c) => c.instrumentSymbol === contract.instrumentSymbol);
        if (index === -1) contracts.push(contract);
        else if (!buyPricesOf(contracts[index]) && buyPricesOf(contract)) contracts[index] = contract;
      }
      existing.contracts = contracts;
    }
  }
  return [...byTicker.values()];
}

/**
 * Candidate cards from every open contract quoted on both sides inside the
 * informative band, then diversified. Identity comes from the production copy
 * (or the sandbox copy for events production does not list). A contract is
 * tradable when the sandbox lists it as open; tradable cards carry sandbox
 * quotes when the sandbox has informative ones, production quotes otherwise.
 */
function assemble(productionEvents: GeminiEvent[], sandboxEvents: GeminiEvent[], now: Date): CardQuote[] {
  const sandboxOpen = new Map<string, GeminiContract>();
  for (const event of sandboxEvents) {
    for (const contract of event.contracts ?? []) {
      if (contract.instrumentSymbol && contract.marketState === "open") sandboxOpen.set(contract.instrumentSymbol, contract);
    }
  }
  const productionTickers = new Set(productionEvents.map((event) => event.ticker));
  const events = [...productionEvents, ...sandboxEvents.filter((event) => event.ticker && !productionTickers.has(event.ticker))];

  const seen = new Set<string>();
  const candidates: CardQuote[] = [];
  for (const event of events) {
    const contracts = [...(event.contracts ?? [])].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    for (const contract of contracts) {
      const symbol = contract.instrumentSymbol;
      if (!symbol || seen.has(symbol)) continue;
      const sandboxCopy = sandboxOpen.get(symbol);
      const sandboxPrices = sandboxCopy ? buyPricesOf(sandboxCopy) : null;
      const priced = sandboxCopy && sandboxPrices && isInformative(sandboxPrices) ? sandboxCopy : contract;
      const card = toCardQuote(event, contract, now, { tradable: sandboxCopy !== undefined, priced });
      if (!card || !isInformative({ yes: card.yesPrice, no: card.noPrice })) continue;
      seen.add(symbol);
      candidates.push(card);
    }
  }
  return diversify(candidates);
}

/**
 * Deck order. Per category: live cards and the rest are each balanced across
 * lanes, then across events inside a lane (so a ladder of strikes or a slate of
 * games does not arrive in a row), each capped at CATEGORY_CAP, then
 * interleaved. Categories, largest first, are then interleaved one card at a
 * time, so consecutive cards come from different categories.
 */
function diversify(cards: CardQuote[]): CardQuote[] {
  const byCategory = groupBy(cards, (card) => card.category);
  byCategory.sort((a, b) => b.length - a.length || a[0].category.localeCompare(b[0].category));
  const perCategory = byCategory.map((group) => {
    const live = balanced(group.filter((card) => card.lane === "live")).slice(0, CATEGORY_CAP);
    const rest = balanced(group.filter((card) => card.lane !== "live")).slice(0, CATEGORY_CAP);
    return roundRobin([live, rest]);
  });
  return roundRobin(perCategory);
}

/** One category's cards: lanes in LANE_ORDER taken in turn, events inside a lane taken in turn (soonest first). */
function balanced(cards: CardQuote[]): CardQuote[] {
  const lanes = groupBy(cards, (card) => card.lane);
  lanes.sort((a, b) => LANE_ORDER.indexOf(a[0].lane) - LANE_ORDER.indexOf(b[0].lane));
  const perLane = lanes.map((laneCards) => {
    const events = groupBy(laneCards, (card) => card.eventTicker);
    events.sort((a, b) => expiry(a[0]) - expiry(b[0]) || a[0].eventTicker.localeCompare(b[0].eventTicker));
    return roundRobin(events);
  });
  return roundRobin(perLane);
}

function expiry(card: CardQuote): number {
  return new Date(card.expiresAt).getTime();
}

/** Groups in first-seen order, preserving order inside each group. */
function groupBy<T>(items: T[], keyOf: (item: T) => string): T[][] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }
  return [...groups.values()];
}

/** One item from each group in turn until every group is empty; order inside groups is kept. */
function roundRobin<T>(groups: T[][]): T[] {
  const out: T[] = [];
  const longest = groups.reduce((max, group) => Math.max(max, group.length), 0);
  for (let index = 0; index < longest; index++) {
    for (const group of groups) if (index < group.length) out.push(group[index]);
  }
  return out;
}
