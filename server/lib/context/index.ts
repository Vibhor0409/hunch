// Context for a card back (docs/CONTEXT_DEV.md, "Always-on context"). The
// route and the smoke script both go through resolveCardContext, so the script
// exercises the same path. Three tiers, and CardContext.kind says which answered:
//   1. web, exact: the question plus "latest news", the lane's freshness
//   2. web, broad: the market's subject plus "news", the last month
//   3. market rules: Gemini's own event data, free and always there
import { expiresAtOf, laneOf, questionFor } from "../gemini/cards";
import { getEventOrNull, getPublicGemini, type GeminiContract, type GeminiEnv, type GeminiEvent } from "../gemini/client";
import { getQuote } from "../gemini/quote";
import type { CardContext, CardPublic } from "../types";
import {
  BROAD_FRESHNESS,
  ContextDevError,
  TIER1_BUDGET,
  TIER2_BUDGET,
  broadQueryFor,
  budgetWithin,
  freshnessFor,
  hasContextKey,
  queryFor,
  searchContext,
  type Freshness,
  type SearchBudget,
  type SearchResponse,
} from "./client";
import { guardAllows, ttlFor, type UsageSnapshot } from "./guard";
import { MARKET_SOURCE_TITLE, marketContext, type MarketContext } from "./market";
import { pickContext, type PickOptions, type PickedContext } from "./pick";
import { cacheKeyFor, laDayOf, readCachedContext, readUsage, recordUsage, writeCachedContext } from "./store";
import { subjectFor } from "./subject";

export { ContextDevError, EXCLUDED_DOMAINS, broadQueryFor, freshnessFor, hasContextKey, queryFor, runUsage, searchContext } from "./client";
export * from "./guard";
export { MARKET_SOURCE_TITLE, MAX_MARKET_TEXT_LENGTH, marketContext, type MarketContext } from "./market";
export { MAX_TEXT_LENGTH, mentionsOdds, pickContext, type PickOptions, type PickedContext } from "./pick";
export { cacheKeyFor, clearCachedMisses, laDayOf, readUsage } from "./store";
export { subjectFor } from "./subject";

/** One Gemini event lookup per request, bounded to this long. */
const EVENT_LOOKUP_MS = 3_000;
/** The web tiers stop inside this window from the start of the request; tier 3 then answers at once. */
const LOOKUP_BUDGET_MS = 7_000;
/** Once the event is known, the dealt card is waited for only this much longer. */
const DEALT_GRACE_MS = 250;
/** How long one instance reuses a market it has just read (a second tap on the same card). */
const MARKET_MEMO_MS = 60_000;
const MARKET_MEMO_LIMIT = 300;

export type ContextTier = 1 | 2 | 3;

/** A card context plus how it was reached, for the log line and the smoke script. */
export interface ContextLookup {
  context: CardContext;
  tier: ContextTier;
  ms: number;
  /** Context.dev credits this request spent (0 on a cache hit and on tier 3 without a search). */
  credits: number;
  /** Web searches this request sent (0 to 2). */
  searches: number;
}

/** The parts of a card the lookup needs. Prices are not among them. */
type ContextCard = Pick<CardPublic, "question" | "category" | "lane" | "expiresAt">;

/** The answer when the market itself cannot be found; the card back says "Trust your gut." */
export function unavailableContext(): CardContext {
  return { available: false, kind: "market", text: null, sourceTitle: null, sourceUrl: null, sourceDomain: null, cached: false };
}

// ---------- The market: one event lookup, reused for the cache key, the subject and tier 3 ----------

/** Resolves with the promise's value, or null when it fails or takes longer than `ms`. */
function within<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
    );
  });
}

async function eventFrom(env: GeminiEnv, eventTicker: string): Promise<GeminiEvent | null> {
  const client = await getPublicGemini(env);
  return getEventOrNull(client, eventTicker, EVENT_LOOKUP_MS);
}

function contractOf(event: GeminiEvent | null, instrumentSymbol: string): GeminiContract | null {
  return (event?.contracts ?? []).find((contract) => contract.instrumentSymbol === instrumentSymbol) ?? null;
}

/**
 * The event behind a card, or null. Production and the sandbox are asked in
 * parallel under one 3 s deadline, like getQuote does: production lists every
 * category, the sandbox only some, and production wins when it knows the
 * contract. Never throws.
 */
async function findEvent(eventTicker: string, instrumentSymbol: string): Promise<GeminiEvent | null> {
  const production = within(eventFrom("production", eventTicker), EVENT_LOOKUP_MS);
  const sandbox = within(eventFrom("sandbox", eventTicker), EVENT_LOOKUP_MS);
  let chosen = await production;
  if (!chosen || !contractOf(chosen, instrumentSymbol)) {
    const fromSandbox = await sandbox;
    if (fromSandbox && (!chosen || contractOf(fromSandbox, instrumentSymbol))) chosen = fromSandbox;
  }
  return chosen;
}

/** The card as dealt (question, category, lane, close time), or null. Never throws. */
async function dealtCard(eventTicker: string, instrumentSymbol: string): Promise<ContextCard | null> {
  try {
    const quote = await getQuote(eventTicker, instrumentSymbol);
    return quote ? { question: quote.question, category: quote.category, lane: quote.lane, expiresAt: quote.expiresAt } : null;
  } catch {
    return null;
  }
}

/** The same card text built from the event, for a market that is no longer dealt (closed or unquoted). */
function cardFromEvent(event: GeminiEvent, contract: GeminiContract, now: Date): { card: ContextCard; open: boolean } | null {
  const expiresAt = expiresAtOf(event, contract);
  if (!expiresAt) return null;
  const lane = laneOf(expiresAt, now);
  return {
    card: { question: questionFor(event, contract), category: event.category ?? "Other", lane: lane ?? "week", expiresAt },
    open: lane !== null && contract.marketState === "open",
  };
}

interface Market {
  card: ContextCard;
  /** Null when the event lookup failed; tier 3 is then built from the card alone. */
  event: GeminiEvent | null;
  contract: GeminiContract | null;
  /** False for a market that is no longer open: it gets its rules, not a web search. */
  searchable: boolean;
}

const marketMemo = new Map<string, { at: number; market: Market }>();

/**
 * The card as dealt and the event, read in parallel, or null when neither
 * knows the market. The dealt card comes from the feed in a few milliseconds;
 * when the feed is stale getQuote reads Gemini itself, which can take 3 s (the
 * sandbox often times out), so once the event has answered with the contract
 * the card is rebuilt from it instead of waited for. A market read with its
 * event is reused on this instance for a minute. Never throws.
 */
async function findMarket(eventTicker: string, instrumentSymbol: string): Promise<Market | null> {
  const memoKey = `${eventTicker}|${instrumentSymbol}`;
  const memo = marketMemo.get(memoKey);
  if (memo && Date.now() - memo.at < MARKET_MEMO_MS) return memo.market;

  const dealing = dealtCard(eventTicker, instrumentSymbol);
  const event = await findEvent(eventTicker, instrumentSymbol);
  const contract = contractOf(event, instrumentSymbol);
  const dealt = event && contract ? await within(dealing, DEALT_GRACE_MS) : await dealing;
  const rebuilt = !dealt && event && contract ? cardFromEvent(event, contract, new Date()) : null;
  const card = dealt ?? rebuilt?.card ?? null;
  if (!card) return null;
  const market: Market = { card, event, contract, searchable: dealt !== null || rebuilt?.open === true };
  if (event) {
    if (marketMemo.size >= MARKET_MEMO_LIMIT) marketMemo.clear();
    marketMemo.set(memoKey, { at: Date.now(), market });
  }
  return market;
}

/** Tier 3. Falls back to the card alone, then to a fixed line, so it is never empty and never throws. */
function rulesFor(event: GeminiEvent | null, contract: GeminiContract | null, card: ContextCard, now: Date): MarketContext {
  try {
    return marketContext(event, contract, card, now);
  } catch {
    try {
      return marketContext(null, null, card, now);
    } catch {
      return { text: "This is a yes or no market.", sourceTitle: MARKET_SOURCE_TITLE, sourceUrl: null, sourceDomain: null };
    }
  }
}

// ---------- The web tiers ----------

type WebText = Pick<CardContext, "text" | "sourceTitle" | "sourceUrl" | "sourceDomain">;

interface WebOutcome {
  /** The web context, or null when the web has nothing (then tier 3 answers). */
  web: WebText | null;
  /** True when the answer, hit or miss, came from card_context. */
  cached: boolean;
  tier: ContextTier;
  credits: number;
  searches: number;
}

const NO_WEB: WebOutcome = { web: null, cached: false, tier: 3, credits: 0, searches: 0 };

/** Concurrent misses for one key on this instance share a single search. */
const inflight = new Map<string, Promise<WebOutcome>>();
/**
 * Which web tier filled a key, as far as this instance saw. card_context does
 * not record it, so a hit cached by another instance is logged as tier 1.
 */
const tierOfKey = new Map<string, 1 | 2>();

/** Statuses that will repeat on the next call (bad request, bad key, rate limit): the broad tier is skipped. */
function willRepeat(error: unknown): boolean {
  return error instanceof ContextDevError && [400, 401, 403, 429].includes(error.status);
}

/**
 * Tier 1, then tier 2 when tier 1 picked nothing. One POST /web/search per
 * tier. The credit guard is asked before each search; a search that fails or
 * times out falls through. When at least one search ran, the result is stored:
 * a hit with the lane's lifetime, a miss as null for 30 minutes so it is not
 * retried. When no search ran (guard tripped, no time left) nothing is stored.
 */
async function searchTiers(key: string, card: ContextCard, subject: string, started: number): Promise<WebOutcome> {
  const day = laDayOf(new Date());
  let usage: UsageSnapshot = await readUsage(day);
  let credits = 0;
  let searches = 0;
  let stop = false;
  // context_usage is written one response after the other, off the search path, and awaited before answering.
  let recording: Promise<unknown> = Promise.resolve();

  const search = async (query: string, freshness: Freshness, tierBudget: SearchBudget, options: PickOptions): Promise<PickedContext | null> => {
    const budget = budgetWithin(tierBudget, LOOKUP_BUDGET_MS - (Date.now() - started));
    if (stop || !budget || !guardAllows(usage)) return null;
    searches += 1;
    let response: SearchResponse;
    try {
      response = await searchContext(query, freshness, budget);
    } catch (error) {
      stop = willRepeat(error);
      return null;
    }
    credits += response.creditsConsumed;
    usage = {
      creditsUsed: usage.creditsUsed + response.creditsConsumed,
      lastCreditsRemaining: response.creditsRemaining ?? usage.lastCreditsRemaining,
    };
    recording = recording.then(() => recordUsage(day, response.creditsConsumed, response.creditsRemaining)).catch(() => undefined);
    return pickContext(response.results, options);
  };

  let tier: ContextTier = 1;
  let picked = await search(queryFor(card.question), freshnessFor(card.lane), TIER1_BUDGET, {});
  if (!picked) {
    tier = 2;
    picked = await search(broadQueryFor(subject), BROAD_FRESHNESS, TIER2_BUDGET, { allowDescription: true, allowLowRelevance: true });
  }
  if (searches === 0) return NO_WEB;

  // A failed cache write leaves the answer good; it is only not shared with other requests.
  await Promise.all([recording, writeCachedContext(key, picked, ttlFor(card.lane, picked !== null)).catch(() => undefined)]);
  if (!picked) return { web: null, cached: false, tier: 3, credits, searches };
  tierOfKey.set(key, tier as 1 | 2);
  return { web: picked, cached: false, tier, credits, searches };
}

/** Cache first, then the web tiers. Throws only on a database failure; the caller then answers with tier 3. */
async function webContext(key: string, card: ContextCard, subject: string, started: number): Promise<WebOutcome> {
  const cached = await readCachedContext(key);
  if (cached) {
    if (cached.text === null) return { web: null, cached: true, tier: 3, credits: 0, searches: 0 };
    const { text, sourceTitle, sourceUrl, sourceDomain } = cached;
    return { web: { text, sourceTitle, sourceUrl, sourceDomain }, cached: true, tier: tierOfKey.get(key) ?? 1, credits: 0, searches: 0 };
  }
  if (!hasContextKey()) return NO_WEB;

  const shared = inflight.get(key);
  if (shared) return { ...(await shared), credits: 0, searches: 0 };
  const pending = searchTiers(key, card, subject, started).finally(() => {
    inflight.delete(key);
  });
  inflight.set(key, pending);
  return pending;
}

// ---------- Entry points ----------

async function resolve(eventTicker: string, instrumentSymbol: string, started: number): Promise<Omit<ContextLookup, "ms">> {
  const market = await findMarket(eventTicker, instrumentSymbol);
  if (!market) return { context: unavailableContext(), tier: 3, credits: 0, searches: 0 };
  const { card, event, contract } = market;

  let outcome = NO_WEB;
  if (market.searchable) {
    try {
      outcome = await webContext(cacheKeyFor(event?.series, eventTicker), card, subjectFor(card.question, event?.title), started);
    } catch {
      outcome = NO_WEB;
    }
  }
  if (outcome.web) {
    return { context: { available: true, kind: "web", ...outcome.web, cached: outcome.cached }, tier: outcome.tier, credits: outcome.credits, searches: outcome.searches };
  }
  const rules = rulesFor(event, contract, card, new Date());
  return { context: { available: true, kind: "market", ...rules, cached: outcome.cached }, tier: 3, credits: outcome.credits, searches: outcome.searches };
}

/**
 * Context for one card, with the tier that answered. Never throws.
 * 1. The card as dealt and one Gemini event lookup (3 s), in parallel.
 *    `available: false` only when neither knows the market.
 * 2. card_context: a stored web line is returned with cached: true; a stored
 *    miss returns tier 3 at once, also with cached: true.
 * 3. No key, or the credit guard tripped: the web tiers are skipped.
 * 4. Tier 1 (4.5 s at most), then tier 2 (3.5 s at most), inside 7 s overall.
 * 5. Tier 3, built fresh on every call.
 * Logs one line per lookup: the tier, the time and the credits spent.
 */
export async function resolveCardContext(eventTicker: string, instrumentSymbol: string): Promise<ContextLookup> {
  const started = Date.now();
  let result: Omit<ContextLookup, "ms">;
  try {
    result = await resolve(eventTicker, instrumentSymbol, started);
  } catch {
    result = { context: unavailableContext(), tier: 3, credits: 0, searches: 0 };
  }
  const ms = Date.now() - started;
  console.log(`[context] tier=${result.tier} ms=${ms} credits=${result.credits}`);
  return { ...result, ms };
}

/** Context for one card (the body of GET /api/context). Never throws. */
export async function getCardContext(eventTicker: string, instrumentSymbol: string): Promise<CardContext> {
  return (await resolveCardContext(eventTicker, instrumentSymbol)).context;
}
