import { settleSwipe, unsettledExpired, type Swipe } from "@/lib/db";
import { resolveOutcome } from "@/lib/gemini/settlement";
import { edgeFor } from "@/lib/game";
import type { Side } from "@/lib/types";
import { mapLimit } from "../_lib/async";
import { describe, internalError, json } from "../_lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Rows per call; settle is lazy and called often, so each call stays small. */
const BATCH = 200;
/** Outcome lookups in flight at once. */
const CONCURRENCY = 6;

interface InstrumentGroup {
  eventTicker: string;
  instrumentSymbol: string;
  swipes: Swipe[];
}

/**
 * POST /api/settle -> 200 { settled: number }
 * Selects unsettled swipes whose market expired, resolves each instrument
 * once, and settles every swipe with a known outcome. Safe to call often:
 * already settled rows are skipped by settleSwipe and not counted.
 */
export async function POST(): Promise<Response> {
  try {
    const expired = await unsettledExpired(BATCH);

    const groups = new Map<string, InstrumentGroup>();
    for (const swipe of expired) {
      const key = `${swipe.eventTicker}\u0000${swipe.instrumentSymbol}`;
      const group = groups.get(key);
      if (group) group.swipes.push(swipe);
      else groups.set(key, { eventTicker: swipe.eventTicker, instrumentSymbol: swipe.instrumentSymbol, swipes: [swipe] });
    }

    const counts = await mapLimit([...groups.values()], CONCURRENCY, settleGroup);
    const settled = counts.reduce((sum, n) => sum + n, 0);
    return json({ settled });
  } catch (error) {
    return internalError("settle", error);
  }
}

/**
 * Resolves one instrument and settles its swipes. Returns how many rows were
 * settled: 0 when the outcome is still unknown or the lookup failed, in which
 * case the rows wait for a later call.
 */
async function settleGroup(group: InstrumentGroup): Promise<number> {
  let outcome: Side | null;
  try {
    outcome = await resolveOutcome(group.eventTicker, group.instrumentSymbol);
  } catch (error) {
    console.error(`[api/settle] resolveOutcome failed for ${group.instrumentSymbol}: ${describe(error)}`);
    return 0;
  }
  if (!outcome) return 0;

  const results = await Promise.all(
    group.swipes.map(async (swipe): Promise<number> => {
      const won = swipe.side === outcome;
      const edge = edgeFor(swipe.price, won);
      const payout = won && swipe.mode === "paid" ? swipe.contracts : 0;
      try {
        const row = await settleSwipe(swipe.id, { won, edge, payout });
        return row ? 1 : 0;
      } catch (error) {
        console.error(`[api/settle] settleSwipe failed for ${swipe.id}: ${describe(error)}`);
        return 0;
      }
    }),
  );
  return results.reduce((sum, n) => sum + n, 0);
}
