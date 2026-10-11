// Live context for a card back (docs/CONTEXT_DEV.md). The route and the smoke
// script both call getCardContext, so the script exercises the same path.
import { findActiveEvent, getEventOrNull, getPublicGemini } from "../gemini/client";
import { getQuote } from "../gemini/quote";
import type { CardContext, CardQuote } from "../types";
import { freshnessFor, queryFor, searchContext } from "./client";
import { dailyCreditCap, guardAllows, ttlFor } from "./guard";
import { pickContext } from "./pick";
import { cacheKeyFor, laDayOf, readCachedContext, readUsage, recordUsage, writeCachedContext, type CachedContext } from "./store";

export { ContextDevError, EXCLUDED_DOMAINS, freshnessFor, queryFor, runUsage, searchContext } from "./client";
export * from "./guard";
export { MAX_TEXT_LENGTH, mentionsOdds, pickContext, type PickedContext } from "./pick";
export { cacheKeyFor, laDayOf, readUsage } from "./store";

/** The answer when there is nothing to show; the card back says "Trust your gut." */
export function unavailableContext(): CardContext {
  return { available: false, text: null, sourceTitle: null, sourceUrl: null, sourceDomain: null, cached: false };
}

function fromCache(cached: CachedContext): CardContext {
  return {
    available: cached.text !== null,
    text: cached.text,
    sourceTitle: cached.sourceTitle,
    sourceUrl: cached.sourceUrl,
    sourceDomain: cached.sourceDomain,
    cached: true,
  };
}

function describe(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

/**
 * The event's series for the cache key, or null when the event cannot be read
 * (the ticker is used instead). Reads the sandbox like getQuote does: getEvent,
 * then a fresh listing when the sandbox answers 404 for a ticker it still
 * lists as active (seen in the smoke run for a live BTC05M event).
 */
async function seriesOf(eventTicker: string): Promise<string | null> {
  try {
    const client = await getPublicGemini("sandbox");
    const event = (await getEventOrNull(client, eventTicker)) ?? (await findActiveEvent(client, eventTicker));
    return event?.series ?? null;
  } catch (error) {
    console.warn(`[context] series lookup failed for ${eventTicker}: ${describe(error)}`);
    return null;
  }
}

/** Concurrent misses for one key on this instance share a single search. */
const inflight = new Map<string, Promise<CardContext>>();

/**
 * Context for one card. Never throws: any failure (Gemini, database,
 * Context.dev, timeout) answers available: false so the swipe still works.
 * 1. getQuote for the real question text and lane; the event's series for the key.
 * 2. Cache hit (card_context, unexpired): return it with cached: true, even when
 *    it records "nothing found".
 * 3. Credit guard (context_usage for the LA day): skip when over the cap or low on credits.
 * 4. One POST /web/search, usage recorded, pickContext, result stored (null for 30 minutes).
 */
export async function getCardContext(eventTicker: string, instrumentSymbol: string): Promise<CardContext> {
  try {
    const [quote, series] = await Promise.all([getQuote(eventTicker, instrumentSymbol), seriesOf(eventTicker)]);
    if (!quote) {
      console.log(`[context] no quote for ${eventTicker} / ${instrumentSymbol}; context unavailable`);
      return unavailableContext();
    }
    const key = cacheKeyFor(series, eventTicker);
    const cached = await readCachedContext(key);
    if (cached) return fromCache(cached);

    let pending = inflight.get(key);
    if (!pending) {
      pending = lookup(key, quote).finally(() => {
        inflight.delete(key);
      });
      inflight.set(key, pending);
    }
    return await pending;
  } catch (error) {
    console.error(`[context] ${describe(error)}`);
    return unavailableContext();
  }
}

async function lookup(key: string, quote: CardQuote): Promise<CardContext> {
  const day = laDayOf(new Date());
  const usage = await readUsage(day);
  const cap = dailyCreditCap();
  if (!guardAllows(usage, cap)) {
    console.warn(
      `[context] credit guard: used_today=${usage.creditsUsed} cap=${cap} credits_remaining=${usage.lastCreditsRemaining ?? "unknown"}; skipping search for ${key}`,
    );
    return unavailableContext();
  }

  const response = await searchContext(queryFor(quote.question), freshnessFor(quote.lane));
  await recordUsage(day, response.creditsConsumed, response.creditsRemaining);

  const picked = pickContext(response.results);
  await writeCachedContext(key, picked, ttlFor(quote.lane, picked !== null));
  if (!picked) {
    console.log(`[context] nothing usable for ${key} (${response.results.length} results); cached empty for 30 minutes`);
    return unavailableContext();
  }
  return { available: true, ...picked, cached: false };
}
