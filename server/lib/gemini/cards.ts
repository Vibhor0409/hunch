// Turns a Gemini event and contract into a CardQuote. Shared by feed and quote.
// Uses only fields confirmed in docs/samples/events.json and btc05m-event.json.
import { laneFor } from "../game/lanes";
import type { CardQuote } from "../types";
import type { GeminiContract, GeminiEvent } from "./client";

export interface BuyPrices {
  yes: number;
  no: number;
}

/** A decimal price string as a number strictly between 0 and 1, else null. */
function parsePrice(value: string | null | undefined): number | null {
  if (typeof value !== "string" || value === "") return null;
  const price = Number(value);
  return Number.isFinite(price) && price > 0 && price < 1 ? price : null;
}

/**
 * Buy prices of both sides, or null when either is missing. Unquoted contracts
 * carry `prices: { buy: {}, sell: {} }` (empty objects, not null), and prices at
 * exactly 0 or 1 cannot be swiped (the swipe route answers 410), so they count
 * as missing here.
 */
export function buyPricesOf(contract: GeminiContract): BuyPrices | null {
  const buy = contract.prices?.buy;
  const yes = parsePrice(buy?.yes);
  const no = parsePrice(buy?.no);
  if (yes === null || no === null) return null;
  return { yes, no };
}

/** The contract's expiry, falling back to the event's. Every sampled contract had its own. */
export function expiresAtOf(event: GeminiEvent, contract: GeminiContract): string | null {
  return contract.expiryDate ?? event.expiryDate ?? null;
}

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

/**
 * Card text rule (docs/GEMINI_API.md, "Card text"). Every card reads as a
 * yes/no question built only from event.title, contract.label and the
 * reference strike:
 * - single-contract Up/Down event with a reference strike:
 *   "BTC price today at 6:15pm EDT: Up from $83,515.78?"
 * - single contract labelled Yes, or no label: "<title>?"
 * - everything else: "<title>: <label>?" such as
 *   "BTC price today at 7pm EDT: $83,100 or above?"
 * A trailing question mark on the title is removed first so it is never doubled.
 */
export function questionFor(event: GeminiEvent, contract: GeminiContract): string {
  const title = (event.title ?? event.ticker ?? "").trim().replace(/\?+$/, "").trim();
  const label = (contract.label ?? "").trim();
  const single = (event.contracts?.length ?? 1) === 1;
  if (!label || (single && label.toLowerCase() === "yes")) return `${title}?`;
  if (single && /^(up|down)$/i.test(label) && contract.strike?.type === "reference") {
    const strike = Number(contract.strike.value);
    if (Number.isFinite(strike) && strike > 0) return `${title}: ${label} from ${usd.format(strike)}?`;
  }
  return `${title}: ${label}?`;
}

/**
 * The card for an open contract quoted on both sides and expiring inside a
 * lane, or null. Lanes come from lib/game/lanes.ts and depend on `now`.
 */
export function toCardQuote(event: GeminiEvent, contract: GeminiContract, now: Date): CardQuote | null {
  if (!event.ticker || !contract.instrumentSymbol) return null;
  if (contract.marketState !== "open") return null;
  const prices = buyPricesOf(contract);
  if (!prices) return null;
  const expiresAt = expiresAtOf(event, contract);
  if (!expiresAt) return null;
  const lane = laneFor(expiresAt, now);
  if (!lane) return null;
  return {
    eventTicker: event.ticker,
    instrumentSymbol: contract.instrumentSymbol,
    question: questionFor(event, contract),
    category: event.category ?? "Other",
    lane,
    expiresAt,
    yesPrice: prices.yes,
    noPrice: prices.no,
  };
}
