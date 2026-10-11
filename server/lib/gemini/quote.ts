// A fresh quote for one contract, read with getEvent and never cached.
import type { CardQuote } from "../types";
import { toCardQuote } from "./cards";
import { findActiveEvent, getEventOrNull, getPublicGemini } from "./client";

/**
 * The current card and prices for one contract, or null when the event is
 * missing, the contract is missing, not open, unquoted on either side, or no
 * longer inside a lane (expired). Reads getEvent; when the sandbox answers 404
 * on every attempt (a replica miss seen in Phase 2 for events still listed as
 * active) the event is looked up in a fresh listing instead, so the quote is
 * still live and never served from the feed cache. Throws when Gemini cannot
 * be reached, so the swipe route can answer 502 instead of 410.
 */
export async function getQuote(eventTicker: string, instrumentSymbol: string): Promise<CardQuote | null> {
  const client = await getPublicGemini("sandbox");
  const event = (await getEventOrNull(client, eventTicker)) ?? (await findActiveEvent(client, eventTicker));
  if (!event) return null;
  const contract = (event.contracts ?? []).find((c) => c.instrumentSymbol === instrumentSymbol);
  if (!contract) return null;
  return toCardQuote(event, contract, new Date());
}
