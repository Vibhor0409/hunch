import { getPlayer } from "@/lib/db";
import { resetWallet } from "@/lib/db/wallet";
import { errorJson, handle, json, readJsonObject } from "../../_lib/http";
import { requireString } from "../../_lib/validate";
import { walletFor } from "../../_lib/wallet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/wallet/reset { playerId } -> 200 Wallet with the balance back at
 * the starting amount and a "reset" transaction on top.
 * 400 invalid_body, 404 player_not_found.
 */
export function POST(req: Request): Promise<Response> {
  return handle("wallet/reset", async () => {
    const body = await readJsonObject(req);
    const playerId = requireString(body?.playerId);
    if (!playerId) return errorJson("invalid_body", 400);

    const player = await getPlayer(playerId);
    if (!player) return errorJson("player_not_found", 404);

    const balance = await resetWallet(player.id);
    return json(await walletFor(player.id, balance, player.stakePerTrade));
  });
}
