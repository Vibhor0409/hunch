import { getPlayer, insertSwipe, paidCountBetween, settledSwipes, swipedSymbols, type NewSwipe } from "@/lib/db";
import { placeBuy } from "@/lib/gemini/orders";
import { getQuote } from "@/lib/gemini/quote";
import { capFor, contractsFor, laDayBounds, laneFor, levelFor, pct, stakeFor } from "@/lib/game";
import type { CardQuote, Mode, OrderReceipt, Reveal, Side } from "@/lib/types";
import { TimeoutError, withTimeout } from "../_lib/async";
import { describe, errorJson, handle, json, readJsonObject } from "../_lib/http";
import { statusFrom } from "../_lib/status";
import { isSide, requireString } from "../_lib/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Longest wait for the fresh quote. The app gives up at 10 s, so a slower
 * quote answers 502 before anything is written and the swipe can be retried.
 * (lib/gemini/quote.ts bounds its own calls; this is the route's safety net.)
 */
const QUOTE_GUARD_MS = 8_000;
/** Longest wait for the sandbox order before the swipe is scored as practice. */
const ORDER_GUARD_MS = 10_000;

const NO_FILL_MESSAGE = "No fill at this price. Scored as practice.";
const NOT_PLACED_MESSAGE = "Order not placed. Scored as practice.";
const ORDER_TIMEOUT_MESSAGE = "Gemini timed out. Scored as practice.";

/**
 * POST /api/swipe { playerId, eventTicker, instrumentSymbol, side } -> 200 Reveal
 * 400 invalid_body, 404 player_not_found, 409 already_swiped,
 * 410 market_closed, 502 gemini_unavailable (only when the quote cannot be fetched)
 *
 * The swipe flow of docs/ARCHITECTURE.md, with the database reads for steps 1
 * and 3 running alongside the quote so the handler waits for the slower of
 * the two instead of their sum. Responses keep the documented precedence
 * (404, 409, 502, 410); 409 never waits for Gemini, and nothing is written
 * until every check has passed.
 */
export function POST(req: Request): Promise<Response> {
  return handle("swipe", async () => {
    // 1. Validate the body and load the player.
    const body = await readJsonObject(req);
    const playerId = requireString(body?.playerId);
    const eventTicker = requireString(body?.eventTicker);
    const instrumentSymbol = requireString(body?.instrumentSymbol);
    const side = body?.side;
    if (!playerId || !eventTicker || !instrumentSymbol || !isSide(side)) return errorJson("invalid_body", 400);

    const player = await getPlayer(playerId);
    if (!player) return errorJson("player_not_found", 404);

    // 2 and 3 together: the fresh quote, the repeat check, settled calls and
    // today's paid count (LA day) all start now. The repeat check is awaited
    // first so a 409 answers in one database round trip and never waits for
    // Gemini; the other reads keep running and are joined afterwards.
    const now = new Date();
    const { startIso, endIso } = laDayBounds(now);
    const quoteStarted = Date.now();
    const quoted$ = withTimeout(getQuote(eventTicker, instrumentSymbol), QUOTE_GUARD_MS, "getQuote").then(
      (quote: CardQuote | null) => ({ ok: true as const, quote }),
      (error: unknown) => ({ ok: false as const, error }),
    );
    const settled$ = settledSwipes(player.id);
    const paidUsedToday$ = paidCountBetween(player.id, startIso, endIso);
    // An early return below abandons these; mark them handled so a late
    // rejection is logged, never left unhandled.
    for (const pending of [settled$, paidUsedToday$]) {
      void pending.catch((error: unknown) => console.error(`[api/swipe] abandoned read failed: ${describe(error)}`));
    }

    const swiped = await swipedSymbols(player.id);
    if (swiped.has(instrumentSymbol)) return errorJson("already_swiped", 409);

    const [quoted, settled, paidUsedToday] = await Promise.all([quoted$, settled$, paidUsedToday$]);
    const quoteMs = Date.now() - quoteStarted;
    if (!quoted.ok) {
      console.error(`[api/swipe] getQuote failed after ${quoteMs} ms: ${describe(quoted.error)}`);
      return errorJson("gemini_unavailable", 502);
    }
    // 410 when closed, expired, unpriced, or outside 0 < price < 1 (the swipes table requires it).
    const quote = quoted.quote;
    if (!quote || !(new Date(quote.expiresAt).getTime() > now.getTime())) return errorJson("market_closed", 410);
    const price = side === "yes" ? quote.yesPrice : quote.noPrice;
    if (!Number.isFinite(price) || price <= 0 || price >= 1) return errorJson("market_closed", 410);

    const level = levelFor(settled);
    const cap = capFor(level);
    const levelStake = stakeFor(level);

    // 4. Tradable and under the cap: place the order. Only a fill stays paid;
    // anything else is practice with the receipt kept. A card whose
    // instrument is not on the sandbox places no order and has no receipt.
    let mode: Mode = "practice";
    let stake = 0;
    let contracts = 0;
    let receipt: OrderReceipt | null = null;
    let orderMs = 0;
    if (quote.tradable !== false && paidUsedToday < cap) {
      const quantity = contractsFor(levelStake, price);
      const orderStarted = Date.now();
      receipt = await placeOrder({ symbol: instrumentSymbol, side, price, quantity });
      orderMs = Date.now() - orderStarted;
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

    console.log("[api/swipe] quote ms=", quoteMs, "order ms=", orderMs, "mode=", mode);

    // The new swipe is unsettled, so the level is unchanged; only today's paid count moves.
    const status = statusFrom(player, settled, paidUsedToday + (mode === "paid" ? 1 : 0));
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
  });
}

/**
 * placeBuy reports API failures as a receipt and never throws for them. This
 * bounds the wait and guards against anything else, so a Gemini problem
 * always ends as a stored practice swipe with an "error" receipt, never a 5xx.
 */
async function placeOrder(args: { symbol: string; side: Side; price: number; quantity: number }): Promise<OrderReceipt> {
  try {
    return await withTimeout(placeBuy(args), ORDER_GUARD_MS, "placeBuy");
  } catch (error) {
    const timedOut = error instanceof TimeoutError;
    console.error(`[api/swipe] placeBuy ${timedOut ? "timed out" : "threw"}: ${describe(error)}`);
    return {
      orderId: null,
      status: "error",
      symbol: args.symbol,
      price: args.price,
      contracts: 0,
      message: timedOut ? ORDER_TIMEOUT_MESSAGE : NOT_PLACED_MESSAGE,
    };
  }
}
