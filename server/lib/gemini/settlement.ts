// Settlement lookups, following docs/GEMINI_API.md ("Settlement").
import type { Side } from "../types";
import { getEventOrNull, getPublicGemini, type GeminiEnv, type GeminiEvent } from "./client";

/**
 * The winning side of one contract, or null while it is unknown.
 * Both environments are read in parallel (one getEvent each, 3 s deadline):
 * production lists every instrument and settles from the same index as the
 * sandbox, the sandbox is the venue of any paid order. The side comes from
 * contracts[].resolutionSide ("yes" | "no", confirmed in
 * docs/samples/settled-event.json) once the contract or its event has status
 * "settled" (an under_review side can still change). The sandbox answer wins
 * when both have settled; when they disagree, nothing is settled (never guess).
 * Throws only when neither environment answered, so the settle route logs it
 * and retries later; a 404 or an unsettled event is simply null.
 */
export async function resolveOutcome(eventTicker: string, instrumentSymbol: string): Promise<Side | null> {
  const [sandbox, production] = await Promise.allSettled([read("sandbox", eventTicker), read("production", eventTicker)]);
  const sandboxOutcome = sandbox.status === "fulfilled" && sandbox.value ? outcomeOf(sandbox.value, instrumentSymbol) : null;
  const productionOutcome = production.status === "fulfilled" && production.value ? outcomeOf(production.value, instrumentSymbol) : null;
  if (sandboxOutcome && productionOutcome && sandboxOutcome !== productionOutcome) return null;
  const outcome = sandboxOutcome ?? productionOutcome;
  if (outcome) return outcome;
  if (sandbox.status === "rejected" && production.status === "rejected") throw production.reason;
  return null;
}

async function read(env: GeminiEnv, eventTicker: string): Promise<GeminiEvent | null> {
  const client = await getPublicGemini(env);
  return getEventOrNull(client, eventTicker);
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
