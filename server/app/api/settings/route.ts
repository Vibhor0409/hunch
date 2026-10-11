import { getPlayer } from "@/lib/db";
import { setStakePerTrade } from "@/lib/db/wallet";
import { errorJson, handle, json, readJsonObject } from "../_lib/http";
import { buildStatus } from "../_lib/status";
import { parseStake, requireString } from "../_lib/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/settings { playerId, stakePerTrade } -> 200 PlayerStatus
 * 400 invalid_stake unless stakePerTrade is a finite number from 1 to 100
 * (rounded to 2 decimals); 400 invalid_body without a playerId; 404 player_not_found.
 */
export function POST(req: Request): Promise<Response> {
  return handle("settings", async () => {
    const body = await readJsonObject(req);
    const playerId = requireString(body?.playerId);
    if (!playerId) return errorJson("invalid_body", 400);
    const amount = parseStake(body?.stakePerTrade);
    if (amount === null) return errorJson("invalid_stake", 400);

    const player = await getPlayer(playerId);
    if (!player) return errorJson("player_not_found", 404);

    const wallet = await setStakePerTrade(player.id, amount);
    return json(await buildStatus({ ...player, balance: wallet.balance, stakePerTrade: wallet.stakePerTrade }));
  });
}
