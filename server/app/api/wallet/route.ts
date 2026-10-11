import type { NextRequest } from "next/server";
import { getPlayer } from "@/lib/db";
import { errorJson, handle, json } from "../_lib/http";
import { walletFor } from "../_lib/wallet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/wallet?playerId= -> 200 Wallet (balance, amount per trade,
 * starting balance, last 50 transactions newest first)
 * 404 player_not_found when the id is missing or unknown.
 */
export function GET(req: NextRequest): Promise<Response> {
  return handle("wallet", async () => {
    const playerId = req.nextUrl.searchParams.get("playerId");
    const player = playerId ? await getPlayer(playerId) : null;
    if (!player) return errorJson("player_not_found", 404);
    return json(await walletFor(player.id, player.balance, player.stakePerTrade));
  });
}
