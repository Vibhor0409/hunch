import { getPlayer, insertSwipe, paidCountBetween, settledSwipes, swipedSymbols, type NewSwipe } from "@/lib/db";
import { placeBuy } from "@/lib/gemini/orders";
import { getQuote } from "@/lib/gemini/quote";
import { capFor, contractsFor, laDayBounds, laneFor, levelFor, pct, stakeFor } from "@/lib/game";
import type { CardQuote, Mode, OrderReceipt, Reveal, Side } from "@/lib/types";
import { describe, errorJson, internalError, json, readJsonObject } from "../_lib/http";
import { buildStatus } from "../_lib/status";
import { isSide, requireString } from "../_lib/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const NO_FILL_MESSAGE = "No fill at this price. Scored as practice.";
const NOT_PLACED_MESSAGE = "Order not placed. Scored as practice.";

/**
 * POST /api/swipe { playerId, eventTicker, instrumentSymbol, side } -> 200 Reveal
 * 400 invalid_body, 404 player_not_found, 409 already_swiped,
 * 410 market_closed, 502 gemini_unavailable (only when the quote cannot be fetched)
 * Follows the five steps of the swipe flow in docs/ARCHITECTURE.md.
 */
export async function POST(req: Request): Promise<Response> {
  try {
    // 1. Validate the body, load the player, reject a repeat swipe.
    const body = await readJsonObject(req);
    const playerId = requireString(body?.playerId);
    const eventTicker = requireString(body?.eventTicker);
    const instrumentSymbol = requireString(body?.instrumentSymbol);
    const side = body?.side;
    if (!playerId || !eventTicker || !instrumentSymbol || !isSide(side)) return errorJson("invalid_body", 400);

    const player = await getPlayer(playerId);
    if (!player) return errorJson("player_not_found", 404);

    const swiped = await swipedSymbols(player.id);
    if (swiped.has(instrumentSymbol)) return errorJson("already_swiped", 409);

    // 2. A fresh price. 410 when closed, expired, unpriced, or outside 0 < price < 1.
    let quote: CardQuote | null;
    try {
      quote = await getQuote(eventTicker, instrumentSymbol);
    } catch (error) {
      console.error(`[api/swipe] getQuote failed: ${describe(error)}`);
      return errorJson("gemini_unavailable", 502);
    }
    const now = new Date();
    if (!quote || !(new Date(quote.expiresAt).getTime() > now.getTime())) return errorJson("market_closed", 410);
    const price = side === "yes" ? quote.yesPrice : quote.noPrice;
    if (!Number.isFinite(price) || price <= 0 || price >= 1) return errorJson("market_closed", 410);

    // 3. Today's paid swipes (LA day) against the level's cap.
    const { startIso, endIso } = laDayBounds(now);
    const [settled, paidUsedToday] = await Promise.all([
      settledSwipes(player.id),
      paidCountBetween(player.id, startIso, endIso),
    ]);
    const level = levelFor(settled);
    const cap = capFor(level);
    const levelStake = stakeFor(level);

    // 4. Under the cap: place the order. Only a fill stays paid; anything else is practice with the receipt kept.
    let mode: Mode = "practice";
    let stake = 0;
    let contracts = 0;
    let receipt: OrderReceipt | null = null;
    if (paidUsedToday < cap) {
      const quantity = contractsFor(levelStake, price);
      receipt = await placeOrder({ symbol: instrumentSymbol, side, price, quantity });
      if (receipt.status === "filled") {
        mode = "paid";
        stake = levelStake;
        contracts = receipt.contracts > 0 ? receipt.contracts : quantity;
      } else if (receipt.status === "open" || receipt.status === "cancelled") {
        receipt = { ...receipt, message: NO_FILL_MESSAGE };
      } else if (!receipt.message) {
        receipt = { ...receipt, message: NOT_PLACED_MESSAGE };
      }
    }

    // 5. Always store the swipe, then return the reveal.
    const row: NewSwipe = {
      playerId: player.id,
      eventTicker,
      instrumentSymbol,
      question: quote.question,
      category: quote.category,
      lane: laneFor(quote.expiresAt, now) ?? quote.lane,
      side,
      price,
      mode,
      stake,
      contracts,
      orderId: receipt?.orderId ?? null,
      orderStatus: receipt?.status ?? null,
      expiresAt: quote.expiresAt,
    };
    const inserted = await insertSwipe(row);
    if (!inserted.ok) return errorJson("already_swiped", 409);

    const status = await buildStatus(player);
    const reveal: Reveal = {
      side,
      yesPct: pct(quote.yesPrice),
      noPct: pct(quote.noPrice),
      sidedWithPct: pct(price),
      mode,
      stake,
      contracts,
      payoutIfRight: mode === "paid" ? contracts : 0,
      receipt,
      status,
    };
    return json(reveal);
  } catch (error) {
    return internalError("swipe", error);
  }
}

/**
 * placeBuy reports API failures as a receipt with status "error" and never
 * throws for them. This guards against anything else so the swipe is still
 * stored as practice with a receipt.
 */
async function placeOrder(args: { symbol: string; side: Side; price: number; quantity: number }): Promise<OrderReceipt> {
  try {
    return await placeBuy(args);
  } catch (error) {
    console.error(`[api/swipe] placeBuy threw: ${describe(error)}`);
    return {
      orderId: null,
      status: "error",
      symbol: args.symbol,
      price: args.price,
      contracts: args.quantity,
      message: NOT_PLACED_MESSAGE,
    };
  }
}
