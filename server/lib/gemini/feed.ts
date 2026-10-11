// The card feed: every open sandbox contract that expires inside a lane and has
// a buy price on both sides, on the sandbox or, failing that, on production.
//
// Phase 2 finding (docs/GEMINI_API.md, Unknowns): the sandbox quotes about 37
// contracts across 9 events, all within the hour plus one gold market, so the
// Tomorrow lane would be empty. Production quotes about 4,200 contracts, and
// 234 of them share an instrumentSymbol with an open sandbox contract. Cards
// for those take their prices from production; orders still go to the sandbox
// (an immediate-or-cancel with no sandbox liquidity cancels and the swipe
// counts as practice, which the swipe route already handles).
import type { CardQuote } from "../types";
import { buyPricesOf, toCardQuote } from "./cards";
import { getPublicGemini, listActiveEventsOnce, type GeminiClient, type GeminiContract, type GeminiEvent } from "./client";

/** How long one feed is reused per server instance. */
export const FEED_CACHE_MS = 60_000;
/** A failed refresh may serve a cached feed up to this old instead of failing. */
const STALE_LIMIT_MS = 10 * 60_000;
/** Parallel listings merged into one view (see listActiveEvents). */
const LIST_ATTEMPTS = 3;

interface Cached {
  at: number;
  cards: CardQuote[];
}

let cached: Cached | null = null;
let inflight: Promise<CardQuote[]> | null = null;

/**
 * Active cards with prices, cached 60 seconds per instance. Concurrent callers
 * share one refresh. An empty result is not cached, so the next request tries
 * again. When a refresh fails and a feed less than 10 minutes old exists, that
 * feed is returned (the feed route re-checks every card's lane against its own
 * clock, so expired cards are dropped there).
 */
export async function fetchActiveCards(): Promise<CardQuote[]> {
  const now = Date.now();
  if (cached && now - cached.at < FEED_CACHE_MS) return cached.cards;
  if (!inflight) {
    inflight = loadCards()
      .then((cards) => {
        if (cards.length > 0) cached = { at: Date.now(), cards };
        return cards;
      })
      .catch((error: unknown) => {
        if (cached && Date.now() - cached.at < STALE_LIMIT_MS) return cached.cards;
        throw error;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

async function loadCards(): Promise<CardQuote[]> {
  const [sandboxEvents, productionBySymbol] = await Promise.all([
    getPublicGemini("sandbox").then(listActiveEvents),
    quotedProductionContracts(),
  ]);
  return orderCards(sandboxEvents, productionBySymbol, new Date());
}

/**
 * Quoted production contracts by instrumentSymbol, from one unauthenticated
 * listing. Production is optional: when it fails the feed is sandbox-only.
 */
async function quotedProductionContracts(): Promise<Map<string, GeminiContract>> {
  const bySymbol = new Map<string, GeminiContract>();
  try {
    const client = await getPublicGemini("production");
    for (const event of await listActiveEventsOnce(client)) {
      for (const contract of event.contracts ?? []) {
        if (contract.instrumentSymbol && contract.marketState === "open" && buyPricesOf(contract)) {
          bySymbol.set(contract.instrumentSymbol, contract);
        }
      }
    }
  } catch {
    // Sandbox-only feed this time.
  }
  return bySymbol;
}

/**
 * Every active event, read as several parallel paginated listings merged by
 * ticker. The sandbox is served by replicas that disagree: in Phase 2 the same
 * call returned about 90 events with 35 quoted contracts or about 65 events with
 * 1 quoted contract, at random. Merging a few listings and keeping, per
 * contract, the copy that carries prices recovers the full view most of the
 * time. Throws only when every listing fails.
 */
async function listActiveEvents(client: GeminiClient): Promise<GeminiEvent[]> {
  const results = await Promise.allSettled(Array.from({ length: LIST_ATTEMPTS }, () => listActiveEventsOnce(client)));
  const listings = results.filter((r): r is PromiseFulfilledResult<GeminiEvent[]> => r.status === "fulfilled").map((r) => r.value);
  if (listings.length === 0) {
    const failure = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
    throw failure?.reason instanceof Error ? failure.reason : new Error("listEvents failed");
  }
  return mergeListings(listings);
}

function hasBuyPrices(contract: GeminiContract): boolean {
  const buy = contract.prices?.buy;
  return typeof buy?.yes === "string" && buy.yes !== "" && typeof buy?.no === "string" && buy.no !== "";
}

/** Union of listings by event ticker; per contract, a quoted copy wins over an unquoted one. */
function mergeListings(listings: GeminiEvent[][]): GeminiEvent[] {
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
        else if (!hasBuyPrices(contracts[index]) && hasBuyPrices(contract)) contracts[index] = contract;
      }
      existing.contracts = contracts;
    }
  }
  return [...byTicker.values()];
}

/**
 * Cards in deck order: events soonest-expiring first, and one card from each
 * event in turn (round robin) so a ladder of eight strikes on one event does
 * not arrive as eight cards in a row. Contracts keep their sortOrder. A
 * contract the sandbox quotes uses sandbox prices; otherwise its production
 * copy's prices when there is one; otherwise it is not a card.
 */
function orderCards(events: GeminiEvent[], productionBySymbol: Map<string, GeminiContract>, now: Date): CardQuote[] {
  const perEvent: CardQuote[][] = [];
  for (const event of events) {
    const contracts = [...(event.contracts ?? [])].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    const cards: CardQuote[] = [];
    for (const contract of contracts) {
      const production = contract.instrumentSymbol ? productionBySymbol.get(contract.instrumentSymbol) : undefined;
      const card = toCardQuote(event, contract, now) ?? (production ? toCardQuote(event, contract, now, production) : null);
      if (card) cards.push(card);
    }
    if (cards.length > 0) perEvent.push(cards);
  }
  perEvent.sort((a, b) => {
    const byExpiry = new Date(a[0].expiresAt).getTime() - new Date(b[0].expiresAt).getTime();
    return byExpiry !== 0 ? byExpiry : a[0].eventTicker.localeCompare(b[0].eventTicker);
  });

  const ordered: CardQuote[] = [];
  const total = perEvent.reduce((sum, cards) => sum + cards.length, 0);
  for (let round = 0; ordered.length < total; round++) {
    for (const cards of perEvent) {
      if (round < cards.length) ordered.push(cards[round]);
    }
  }
  return ordered;
}
