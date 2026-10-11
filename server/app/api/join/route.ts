import { createPlayer } from "@/lib/db";
import { errorJson, internalError, json, readJsonObject } from "../_lib/http";
import { cleanName } from "../_lib/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/join { name } -> 200 { playerId, name }
 * 400 invalid_name (2 to 20 letters, digits, spaces after trimming)
 * 409 name_taken (names are unique ignoring case; existing players are never overwritten)
 */
export async function POST(req: Request): Promise<Response> {
  try {
    const body = await readJsonObject(req);
    const name = cleanName(body?.name);
    if (!name) return errorJson("invalid_name", 400);

    const result = await createPlayer(name);
    if (!result.ok) return errorJson("name_taken", 409);
    return json({ playerId: result.player.id, name: result.player.name });
  } catch (error) {
    return internalError("join", error);
  }
}
