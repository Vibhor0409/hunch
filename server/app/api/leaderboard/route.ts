import { counters, leaderboardRows, settledSwipesByPlayers } from "@/lib/db";
import { levelFor } from "@/lib/game";
import type { LeaderboardRow } from "@/lib/types";
import { internalError, json } from "../_lib/http";
import { round1 } from "../_lib/numbers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LIMIT = 100;

/**
 * GET /api/leaderboard -> 200 { rows: LeaderboardRow[], counters: Counters }
 * Rows come from the leaderboard view (Edge total descending); rank is the
 * position and level comes from each player's settled swipes in one query.
 */
export async function GET(): Promise<Response> {
  try {
    const [entries, totals] = await Promise.all([leaderboardRows(LIMIT), counters()]);
    const settledByPlayer = await settledSwipesByPlayers(entries.map((entry) => entry.playerId));

    const rows: LeaderboardRow[] = entries.map((entry, index) => ({
      rank: index + 1,
      playerId: entry.playerId,
      name: entry.name,
      edgeTotal: round1(entry.edgeTotal),
      settledCalls: entry.settledCalls,
      level: levelFor(settledByPlayer.get(entry.playerId) ?? []),
    }));
    return json({ rows, counters: totals });
  } catch (error) {
    return internalError("leaderboard", error);
  }
}
