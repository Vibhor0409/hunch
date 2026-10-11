// Settlement lookups, following docs/GEMINI_API.md ("Settlement").
import type { Side } from "../types";
import { findRecentlySettledEvent, getEventOrNull, getPublicGemini, type GeminiEvent } from "./client";

/**
 * The winning side of one contract, or null while it is unknown.
 * Reads getEvent and returns contracts[].resolutionSide ("yes" | "no", confirmed
 * in docs/samples/settled-event.json) only once the contract or its event has
 * status "settled". Contracts can settle while the event is still
 * "under_review", and an under_review contract may already show a side that
 * could still change, so that state returns null. When getEvent answers 404 on
 * every attempt (a sandbox replica miss, seen in Phase 2 for a settled 5-minute
 * event) the event is looked up among the recently settled events instead, and
 * production is read as a second source for the same ticker.
 * Never guesses: a missing event, contract or side returns null and the swipe
 * waits. Throws when Gemini cannot be reached, so the settle route logs it and
 * retries on a later call.
 */
export async function resolveOutcome(eventTicker: string, instrumentSymbol: string): Promise<Side | null> {
  const sandbox = await getPublicGemini("sandbox");
  const event = (await getEventOrNull(sandbox, eventTicker)) ?? (await findRecentlySettledEvent(sandbox, eventTicker));
  const outcome = event ? outcomeOf(event, instrumentSymbol) : null;
  if (outcome) return outcome;

  // Production lists the same tickers and settles them from the same index, so
  // its settled resolutionSide is a second reading of the same result. Used
  // only when the sandbox has not reported one.
  const production = await getPublicGemini("production");
  const productionEvent = await getEventOrNull(production, eventTicker);
  return productionEvent ? outcomeOf(productionEvent, instrumentSymbol) : null;
}

/** The settled side of one contract of an event, or null. Pure, for tests. */
export function outcomeOf(event: GeminiEvent, instrumentSymbol: string): Side | null {
  const contract = (event.contracts ?? []).find((c) => c.instrumentSymbol === instrumentSymbol);
  if (!contract) return null;
  const settled = contract.status === "settled" || event.status === "settled";
  if (!settled) return null;
  const side = contract.resolutionSide;
  return side === "yes" || side === "no" ? side : null;
}
