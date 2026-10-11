import type { NextRequest } from "next/server";
import { getCardContext, unavailableContext } from "@/lib/context";
import { describe, errorJson, json } from "../_lib/http";
import { requireString } from "../_lib/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * GET /api/context?eventTicker=&instrumentSymbol=&playerId= -> 200 CardContext
 * 400 missing_params when any of the three is absent or empty.
 * Every other failure answers 200 with available: false, so the card back
 * shows "Trust your gut." and the swipe still works. playerId is required so
 * only the app's users can trigger a lookup; the result is per market, not per
 * player (cached in card_context, see docs/CONTEXT_DEV.md).
 */
export async function GET(req: NextRequest): Promise<Response> {
  const params = req.nextUrl.searchParams;
  const eventTicker = requireString(params.get("eventTicker"));
  const instrumentSymbol = requireString(params.get("instrumentSymbol"));
  const playerId = requireString(params.get("playerId"));
  if (!eventTicker || !instrumentSymbol || !playerId) return errorJson("missing_params", 400);

  try {
    return json(await getCardContext(eventTicker, instrumentSymbol));
  } catch (error) {
    // getCardContext catches its own failures; this is a last resort.
    console.error(`[api/context] ${describe(error)}`);
    return json(unavailableContext());
  }
}
