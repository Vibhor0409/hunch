// A fresh quote for one contract, within a 4 second budget.
import type { CardQuote } from "../types";
import { buyPricesOf, toCardQuote } from "./cards";
import { getEventOrNull, getPublicGemini, type GeminiContract, type GeminiEnv, type GeminiEvent } from "./client";
import { FEED_CACHE_MS, recentFeed } from "./feed";

/**
 * The current card and prices for one contract, or null when it is unknown,
 * not open, unquoted on either side, or no longer inside a lane.
 * Fast path: the card as dealt, from the memory or snapshot feed when that is
 * under 60 s old. Otherwise one getEvent on the sandbox and one on production
 * in parallel, 3 s each (see quoteLive). Throws only when both lookups failed
 * to answer, so the swipe route can say 502 instead of 410.
 */
export async function getQuote(eventTicker: string, instrumentSymbol: string): Promise<CardQuote | null> {
  const feed = await recentFeed(FEED_CACHE_MS);
  const dealt = feed?.cards.find((card) => card.instrumentSymbol === instrumentSymbol && card.eventTicker === eventTicker);
  if (dealt) return dealt;
  return quoteLive(eventTicker, instrumentSymbol);
}

interface Hit {
  event: GeminiEvent;
  contract: GeminiContract;
}

/**
 * The quote straight from Gemini: both environments are read in parallel with
 * a 3 s deadline each. The card is tradable when the sandbox has the contract
 * open, and then prefers the sandbox quote when it has one. Identity comes
 * from production when production lists the event.
 */
export async function quoteLive(eventTicker: string, instrumentSymbol: string): Promise<CardQuote | null> {
  const [sandbox, production] = await Promise.allSettled([lookup("sandbox", eventTicker, instrumentSymbol), lookup("production", eventTicker, instrumentSymbol)]);
  const sandboxHit = sandbox.status === "fulfilled" ? sandbox.value : null;
  const productionHit = production.status === "fulfilled" ? production.value : null;
  const identity = productionHit ?? sandboxHit;
  if (!identity) {
    if (sandbox.status === "rejected" && production.status === "rejected") throw production.reason;
    if (sandbox.status === "rejected" || production.status === "rejected") {
      // One side failed to answer and the other does not know the contract: unknown, not closed.
      throw sandbox.status === "rejected" ? sandbox.reason : (production as PromiseRejectedResult).reason;
    }
    return null;
  }
  const tradable = sandboxHit !== null && sandboxHit.contract.marketState === "open";
  const priced = tradable && buyPricesOf(sandboxHit.contract) ? sandboxHit.contract : identity.contract;
  return toCardQuote(identity.event, identity.contract, new Date(), { tradable, priced });
}

async function lookup(env: GeminiEnv, eventTicker: string, instrumentSymbol: string): Promise<Hit | null> {
  const client = await getPublicGemini(env);
  const event = await getEventOrNull(client, eventTicker);
  const contract = (event?.contracts ?? []).find((c) => c.instrumentSymbol === instrumentSymbol);
  return event && contract ? { event, contract } : null;
}
