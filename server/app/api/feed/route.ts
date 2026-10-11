import type { NextRequest } from "next/server";
import { getPlayer, swipedSymbols } from "@/lib/db";
import { fetchActiveCards } from "@/lib/gemini/feed";
import { laneFor, mixForYou } from "@/lib/game";
import type { CardPublic, CardQuote, Lane, LaneFilter } from "@/lib/types";
import { describe, errorJson, handle, json } from "../_lib/http";
import { buildStatus } from "../_lib/status";
import { isLaneFilter } from "../_lib/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MAX_CARDS = 20;

/**
 * The only place a CardQuote becomes a CardPublic. Field by field, so a price
 * can never ride along (CLAUDE.md rule 5: blind means blind).
 */
function toPublic(card: CardQuote, lane: Lane): CardPublic {
  return {
    eventTicker: card.eventTicker,
    instrumentSymbol: card.instrumentSymbol,
    question: card.question,
    category: card.category,
    lane,
    expiresAt: card.expiresAt,
    tradable: card.tradable,
  };
}

/**
 * GET /api/feed?lane=foryou|live|tomorrow|week|later&playerId=
 * -> 200 { cards: CardPublic[], status: PlayerStatus }
 * 400 invalid_lane, 404 player_not_found, 502 gemini_unavailable
 * Missing lane means foryou. Already-swiped contracts and contracts that
 * expired since the feed was cached are removed; at most 20 cards.
 */
export function GET(req: NextRequest): Promise<Response> {
  return handle("feed", async () => {
    const params = req.nextUrl.searchParams;
    const laneParam = params.get("lane") ?? "foryou";
    if (!isLaneFilter(laneParam)) return errorJson("invalid_lane", 400);
    const lane: LaneFilter = laneParam;

    const playerId = params.get("playerId");
    const player = playerId ? await getPlayer(playerId) : null;
    if (!player) return errorJson("player_not_found", 404);

    const cardsStarted = Date.now();
    const [feed, swiped, status] = await Promise.all([
      fetchActiveCards().then(
        (cards: CardQuote[]) => ({ ok: true as const, cards }),
        (error: unknown) => ({ ok: false as const, error }),
      ),
      swipedSymbols(player.id),
      buildStatus(player),
    ]);
    console.log("[api/feed] cards ms=", Date.now() - cardsStarted, "ok=", feed.ok);
    if (!feed.ok) {
      console.error(`[api/feed] fetchActiveCards failed: ${describe(feed.error)}`);
      return errorJson("gemini_unavailable", 502);
    }

    const now = new Date();
    const seen = new Set<string>();
    const cards: CardPublic[] = [];
    for (const card of feed.cards) {
      if (swiped.has(card.instrumentSymbol) || seen.has(card.instrumentSymbol)) continue;
      // Drop cards that expired since the feed was cached (also unparseable dates).
      if (!(new Date(card.expiresAt).getTime() > now.getTime())) continue;
      // Lanes depend on time left, so refresh against the request clock; keep
      // the feed's lane when laneFor has no answer (for example "later").
      const currentLane = laneFor(card.expiresAt, now) ?? card.lane;
      seen.add(card.instrumentSymbol);
      cards.push(toPublic(card, currentLane));
    }

    const ordered = lane === "foryou" ? mixForYou(cards) : cards.filter((card) => card.lane === lane);
    return json({ cards: ordered.slice(0, MAX_CARDS), status });
  });
}
