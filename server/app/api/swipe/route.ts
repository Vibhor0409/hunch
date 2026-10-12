import { getPlayer, insertSwipe, paidCountBetween, settledSwipes, swipedSymbols, type NewSwipe } from "@/lib/db";
import { adjustBalance } from "@/lib/db/wallet";
import { placeBuy } from "@/lib/gemini/orders";
import { getQuote } from "@/lib/gemini/quote";
import { capFor, contractsFor, laDayBounds, laneFor, levelFor } from "@/lib/game";
import type { CardQuote, Mode, OrderReceipt, Reveal, Side } from "@/lib/types";
import { TimeoutError, withTimeout } from "../_lib/async";
import { describe, errorJson, handle, json, readJsonObject } from "../_lib/http";
import { revealPcts } from "../_lib/odds";
import { statusFrom } from "../_lib/status";
import { isSide, requireString, sessionModeOf } from "../_lib/validate";
import { round2 } from "../_lib/wallet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Longest wait for the fresh quote. The app gives up at 10 s, so a slower
 * quote answers 502 before anything is written and the swipe can be retried.
 * (lib/gemini/quote.ts bounds its own calls; this is the route's safety net.)
 */
const QUOTE_GUARD_MS = 8_000;
/** Longest wait for the sandbox order; past it the receipt reports an error and the swipe stays wallet-funded. */
const ORDER_GUARD_MS = 10_000;

const CAP_REACHED_MESSAGE = "Daily cap reached. Scored as practice.";
const NO_BALANCE_MESSAGE = "Not enough balance. Scored as practice.";
const PRACTICE_SESSION_MESSAGE = "Practice session. Scores Edge only.";
const ORDER_FAILED_MESSAGE = "Order failed on the sandbox.";
const ORDER_TIMEOUT_MESSAGE = "Gemini timed out.";

/**
 * POST /api/swipe { playerId, eventTicker, instrumentSymbol, side, mode? } -> 200 Reveal
 * 400 invalid_body, 404 player_not_found, 409 already_swiped,
 * 410 market_closed, 502 gemini_unavailable (only when the quote cannot be fetched)
 *
 * The swipe flow of docs/ARCHITECTURE.md with the F8 wallet: a swipe is paid
 * (wallet-funded) when the player is under the daily cap and the balance
 * covers the amount per trade; the cost (contracts x price) is debited after
 * the row is stored, and a tradable card also places the sandbox order. The
 * database reads for steps 1 and 3 run alongside the quote so the handler
 * waits for the slower of the two instead of their sum. Responses keep the
 * documented precedence (404, 409, 502, 410); 409 never waits for Gemini, and
 * nothing is written until every check has passed.
 *
 * Optional `mode` ("practice" | "live", the app's session toggle): "practice"
 * forces a practice swipe (no order, no wallet debit, not counted against the
 * daily cap). Missing or anything else means "live", the flow described above.
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
    const session = sessionModeOf(body?.mode);

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

    // 4. Paid when under the cap and the wallet covers the amount per trade
    // (live session only; a practice session is never paid).
    const cap = capFor(levelFor(settled));
    const amount = player.stakePerTrade;
    const underCap = paidUsedToday < cap;
    const funded = player.balance >= amount;
    const paid = session === "live" && underCap && funded;

    let mode: Mode = "practice";
    let contracts = 0;
    let cost = 0;
    let receipt: OrderReceipt | null = null;
    let orderMs = 0;
    if (paid) {
      mode = "paid";
      contracts = contractsFor(amount, price);
      cost = round2(contracts * price);
      // A tradable card also places the real sandbox order. Whatever comes
      // back (filled, cancelled, error) is kept on the receipt; the wallet
      // funds the swipe either way. A card not on the sandbox has no receipt.
      if (quote.tradable !== false) {
        const orderStarted = Date.now();
        receipt = await placeOrder({ symbol: instrumentSymbol, side, price, quantity: contracts });
        orderMs = Date.now() - orderStarted;
      }
    } else {
      receipt = {
        orderId: null,
        status: "not_placed",
        symbol: instrumentSymbol,
        price,
        contracts: 0,
        message: session === "practice" ? PRACTICE_SESSION_MESSAGE : underCap ? NO_BALANCE_MESSAGE : CAP_REACHED_MESSAGE,
      };
    }

    // 5. Always store the swipe, debit the wallet for a paid one, then reveal.
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
      stake: cost,
      contracts,
      orderId: receipt?.orderId ?? null,
      orderStatus: receipt?.status ?? null,
      expiresAt: quote.expiresAt,
    };
    const inserted = await insertSwipe(row);
    if (!inserted.ok) return errorJson("already_swiped", 409);

    let balanceAfter = player.balance;
    if (paid && cost > 0) {
      balanceAfter = await adjustBalance(player.id, -cost, { kind: "stake", swipeId: inserted.swipe.id, note: quote.question });
    }

    console.log("[api/swipe] quote ms=", quoteMs, "order ms=", orderMs, "mode=", mode, "cost=", cost, "session=", session);

    // The new swipe is unsettled, so the level is unchanged; today's paid count and the balance move.
    const status = statusFrom({ ...player, balance: balanceAfter }, settled, paidUsedToday + (paid ? 1 : 0));
    // Displayed odds are normalized to sum to 100; price (stored, Edge, receipt) stays the raw buy price.
    const { yesPct, noPct, sidedWithPct } = revealPcts(quote.yesPrice, quote.noPrice, side);
    const reveal: Reveal = {
      side,
      yesPct,
      noPct,
      sidedWithPct,
      mode,
      stake: cost,
      contracts,
      payoutIfRight: paid ? contracts : 0,
      receipt,
      cost,
      balanceAfter,
      status,
    };
    return json(reveal);
  });
}

/**
 * placeBuy reports API failures as a receipt and never throws for them. This
 * bounds the wait and guards against anything else, so a Gemini problem
 * always ends as a stored, wallet-funded swipe with an "error" receipt, never a 5xx.
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
      message: timedOut ? ORDER_TIMEOUT_MESSAGE : ORDER_FAILED_MESSAGE,
    };
  }
}
