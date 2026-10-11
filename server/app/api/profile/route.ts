import type { NextRequest } from "next/server";
import { getPlayer, recentSwipes, settledSwipes, toRecentCall } from "@/lib/db";
import { categoryStats, insight, progressFor } from "@/lib/game";
import type { Profile } from "@/lib/types";
import { errorJson, handle, json } from "../_lib/http";
import { edgeTotalOf } from "../_lib/numbers";
import { buildStatus } from "../_lib/status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Recent calls shown on the Me tab (SPEC F4). */
const RECENT_CALLS = 10;

/**
 * GET /api/profile?playerId= -> 200 Profile
 * 404 player_not_found when the id is missing or unknown.
 */
export function GET(req: NextRequest): Promise<Response> {
  return handle("profile", async () => {
    const playerId = req.nextUrl.searchParams.get("playerId");
    const player = playerId ? await getPlayer(playerId) : null;
    if (!player) return errorJson("player_not_found", 404);

    const settledPromise = settledSwipes(player.id);
    const [settled, recent, status] = await Promise.all([
      settledPromise,
      recentSwipes(player.id, RECENT_CALLS),
      buildStatus(player, settledPromise),
    ]);

    const categories = categoryStats(settled);
    const profile: Profile = {
      status,
      edgeTotal: edgeTotalOf(settled),
      progress: progressFor(settled),
      categories,
      insight: insight(categories),
      recent: recent.map(toRecentCall),
    };
    return json(profile);
  });
}
