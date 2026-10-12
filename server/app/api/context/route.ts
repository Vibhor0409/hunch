import type { NextRequest } from "next/server";
import { getCardContext, unavailableContext } from "@/lib/context";
import { errorJson, json } from "../_lib/http";
import { requireString } from "../_lib/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * GET /api/context?eventTicker=&instrumentSymbol=&playerId= -> 200 CardContext
 * 400 missing_params when any of the three is absent or empty.
 * Every other case answers 200 with the full CardContext shape, and `kind`
 * says where the text came from: "web" (live context from Context.dev) or
 * "market" (the market's own rules, always there). `available` is false only
 * when the market itself cannot be found. The lookup answers within about 7 s
 * (see lib/context/index.ts) and logs one line: tier, time, credits.
 * playerId is required so only the app's users can trigger a lookup; the
 * result is per market, not per player (cached in card_context).
 */
export async function GET(req: NextRequest): Promise<Response> {
  const params = req.nextUrl.searchParams;
  const eventTicker = requireString(params.get("eventTicker"));
  const instrumentSymbol = requireString(params.get("instrumentSymbol"));
  const playerId = requireString(params.get("playerId"));
  if (!eventTicker || !instrumentSymbol || !playerId) return errorJson("missing_params", 400);

  try {
    return json(await getCardContext(eventTicker, instrumentSymbol));
  } catch {
    // getCardContext does not throw; this keeps the 200 contract if that ever changes.
    return json(unavailableContext());
  }
}
