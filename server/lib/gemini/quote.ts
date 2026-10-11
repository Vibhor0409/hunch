// A fresh quote for one contract, read with getEvent and never cached.
import type { CardQuote } from "../types";
import { toCardQuote } from "./cards";
import { findActiveEvent, getEventOrNull, getPublicGemini } from "./client";

/**
 * The current card and prices for one contract, or null when the event is
 * missing, the contract is missing, not open, unquoted on either side, or no
 * longer inside a lane (expired).
 * Reads the sandbox with getEvent; when the sandbox answers 404 on every attempt
 * (a replica miss seen in Phase 2 for events still listed as active) the event
 * is taken from a fresh listing instead, so the quote is still live and never
 * served from the feed cache. An open sandbox contract without a sandbox quote
 * takes its prices from the production copy of the same contract, which is
 * where the feed found them (see feed.ts). Throws when Gemini cannot be
 * reached, so the swipe route can answer 502 instead of 410.
 */
export async function getQuote(eventTicker: string, instrumentSymbol: string): Promise<CardQuote | null> {
  const sandbox = await getPublicGemini("sandbox");
  const event = (await getEventOrNull(sandbox, eventTicker)) ?? (await findActiveEvent(sandbox, eventTicker));
  if (!event) return null;
  const contract = (event.contracts ?? []).find((c) => c.instrumentSymbol === instrumentSymbol);
  if (!contract) return null;
  const now = new Date();
  const card = toCardQuote(event, contract, now);
  if (card || contract.marketState !== "open") return card;

  const production = await getPublicGemini("production");
  const productionEvent = await getEventOrNull(production, eventTicker);
  const productionContract = (productionEvent?.contracts ?? []).find((c) => c.instrumentSymbol === instrumentSymbol);
  return productionContract ? toCardQuote(event, contract, now, productionContract) : null;
}
