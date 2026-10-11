import { settleSwipe, unsettledExpired, type Swipe } from "@/lib/db";
import { adjustBalance } from "@/lib/db/wallet";
import { resolveOutcome } from "@/lib/gemini/settlement";
import { edgeFor } from "@/lib/game";
import type { Side } from "@/lib/types";
import { mapLimit, withTimeout } from "../_lib/async";
import { describe, handle, json } from "../_lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Rows per call; settle is lazy and called often, so each call stays small. */
const BATCH = 200;
/** Outcome lookups in flight at once. */
const CONCURRENCY = 6;
/** Total time budget for one call. Instruments not reached wait for the next call. */
const BUDGET_MS = 20_000;
/** Longest wait for one instrument's outcome lookup. */
const LOOKUP_TIMEOUT_MS = 8_000;

interface InstrumentGroup {
  eventTicker: string;
  instrumentSymbol: string;
  swipes: Swipe[];
}

/**
 * POST /api/settle -> 200 { settled: number }
 * Selects unsettled swipes whose market expired, resolves each instrument
 * once, settles every swipe with a known outcome and credits paid wins to
 * the wallet (F8). Safe to call often:
 * already settled rows are skipped by settleSwipe and not counted. Work stops
 * at the time budget and a slow or failing instrument never holds the others.
 */
export function POST(): Promise<Response> {
  return handle("settle", async () => {
    const deadline = Date.now() + BUDGET_MS;
    const expired = await unsettledExpired(BATCH);

    const groups = new Map<string, InstrumentGroup>();
    for (const swipe of expired) {
      const key = `${swipe.eventTicker}\u0000${swipe.instrumentSymbol}`;
      const group = groups.get(key);
      if (group) group.swipes.push(swipe);
      else groups.set(key, { eventTicker: swipe.eventTicker, instrumentSymbol: swipe.instrumentSymbol, swipes: [swipe] });
    }

    const counts = await mapLimit([...groups.values()], CONCURRENCY, (group) => settleGroup(group, deadline));
    const settled = counts.reduce((sum, n) => sum + n, 0);
    console.log("[api/settle] rows=", expired.length, "instruments=", groups.size, "settled=", settled);
    return json({ settled });
  });
}

/**
 * Resolves one instrument and settles its swipes. Returns how many rows were
 * settled: 0 when the outcome is still unknown, the lookup failed or timed
 * out, or the call's time budget is spent, in which case the rows wait for a
 * later call.
 */
async function settleGroup(group: InstrumentGroup, deadline: number): Promise<number> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) return 0;

  let outcome: Side | null;
  try {
    outcome = await withTimeout(
      resolveOutcome(group.eventTicker, group.instrumentSymbol),
      Math.min(LOOKUP_TIMEOUT_MS, remaining),
      `resolveOutcome ${group.instrumentSymbol}`,
    );
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
      let row: Awaited<ReturnType<typeof settleSwipe>>;
      try {
        row = await settleSwipe(swipe.id, { won, edge, payout });
      } catch (error) {
        console.error(`[api/settle] settleSwipe failed for ${swipe.id}: ${describe(error)}`);
        return 0;
      }
      if (!row) return 0;
      // F8: a paid win credits the payout to the wallet. The row is settled
      // only once (settleSwipe skips settled rows), so the credit happens once.
      if (row.mode === "paid" && row.won && row.payout > 0) {
        try {
          await adjustBalance(row.playerId, row.payout, { kind: "payout", swipeId: row.id, note: row.question });
        } catch (error) {
          console.error(`[api/settle] payout credit failed for ${row.id}: ${describe(error)}`);
        }
      }
      return 1;
    }),
  );
  return results.reduce((sum, n) => sum + n, 0);
}
