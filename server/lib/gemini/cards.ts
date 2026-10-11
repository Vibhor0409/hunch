// Turns a Gemini event and contract into a CardQuote. Shared by feed and quote.
// Uses only fields confirmed in docs/samples (events.json, btc05m-event.json,
// events-production.json).
import { laneFor, WEEK_WINDOW_MS } from "../game/lanes";
import type { CardQuote, Lane } from "../types";
import type { GeminiContract, GeminiEvent } from "./client";

export interface BuyPrices {
  yes: number;
  no: number;
}

/** The "later" lane: more than 7 days out, up to a year. */
const LATER_WINDOW_MS = 365 * 24 * 60 * 60 * 1000;
/** A side priced at or below this, or at or above 1 minus this, carries no information and is not dealt. */
export const MIN_INFORMATIVE_PRICE = 0.02;

/** A decimal price string as a number strictly between 0 and 1, else null. */
function parsePrice(value: string | null | undefined): number | null {
  if (typeof value !== "string" || value === "") return null;
  const price = Number(value);
  return Number.isFinite(price) && price > 0 && price < 1 ? price : null;
}

/**
 * Buy prices of both sides, or null when either is missing. Unquoted contracts
 * carry `prices: { buy: {}, sell: {} }` (empty objects, not null).
 */
export function buyPricesOf(contract: GeminiContract): BuyPrices | null {
  const buy = contract.prices?.buy;
  const yes = parsePrice(buy?.yes);
  const no = parsePrice(buy?.no);
  if (yes === null || no === null) return null;
  return { yes, no };
}

/** Both sides strictly inside (0.02, 0.98): a call on the card can be right or wrong. */
export function isInformative(prices: BuyPrices): boolean {
  const open = (price: number) => price > MIN_INFORMATIVE_PRICE && price < 1 - MIN_INFORMATIVE_PRICE;
  return open(prices.yes) && open(prices.no);
}

/** The contract's expiry, falling back to the event's. Every sampled contract had its own. */
export function expiresAtOf(event: GeminiEvent, contract: GeminiContract): string | null {
  return contract.expiryDate ?? event.expiryDate ?? null;
}

/**
 * The lane for an expiry: lib/game/lanes.ts, plus "later" for 7 to 365 days
 * while that module still returns null there. Null when expired, unparsable
 * or more than a year out.
 */
export function laneOf(expiresAt: string, now: Date): Lane | null {
  const lane = laneFor(expiresAt, now);
  if (lane) return lane;
  const remaining = new Date(expiresAt).getTime() - now.getTime();
  return Number.isFinite(remaining) && remaining > WEEK_WINDOW_MS && remaining <= LATER_WINDOW_MS ? "later" : null;
}

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

/**
 * Card text rule (docs/GEMINI_API.md, "Card text"). Every card reads as a
 * yes/no question built only from event.title, contract.label and the
 * reference strike. Trailing question marks on title and label are removed
 * first so they are never doubled.
 * - no label: "<title>?"
 * - single contract labelled Yes, or whose title is already a question
 *   ("Will GameStop acquire eBay?"): "<title>?"
 * - single Up/Down contract with a reference strike:
 *   "BTC price today at 6:15pm EDT: Up from $83,515.78?"
 * - everything else: "<title>: <label>?", such as
 *   "Texas US Senate Winner: James Talarico?" or
 *   "BTC price today at 7pm EDT: $83,100 or above?"
 */
export function questionFor(event: GeminiEvent, contract: GeminiContract, priced: GeminiContract = contract): string {
  const rawTitle = (event.title ?? event.ticker ?? "").trim();
  const title = rawTitle.replace(/\?+$/, "").trim();
  const label = (contract.label ?? "").trim().replace(/\?+$/, "").trim();
  const single = (event.contracts?.length ?? 1) === 1;
  if (!label) return `${title}?`;
  if (single) {
    if (label.toLowerCase() === "yes" || rawTitle.endsWith("?")) return `${title}?`;
    if (/^(up|down)$/i.test(label)) {
      // The reference strike is the index price at the window start. The sandbox
      // copy can still show it as null when the production copy already has it.
      const strike = referenceStrike(contract) ?? referenceStrike(priced);
      if (strike !== null) return `${title}: ${label} from ${usd.format(strike)}?`;
    }
  }
  return `${title}: ${label}?`;
}

/** strike.value of a "reference" strike as a positive number, else null. */
function referenceStrike(contract: GeminiContract): number | null {
  if (contract.strike?.type !== "reference") return null;
  const value = Number(contract.strike.value);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export interface CardOptions {
  /** True when the instrument is an open contract on the sandbox, so an order can be placed. */
  tradable: boolean;
  /** The copy of the contract whose prices the card carries; defaults to `contract`. */
  priced?: GeminiContract;
}

/**
 * The card for an open contract quoted on both sides and expiring inside a
 * lane, or null. Identity, text, expiry and open state come from `contract`;
 * prices from `options.priced` (the sandbox copy for tradable cards when the
 * sandbox quotes it, otherwise the production copy). No price-band filter
 * here: the feed applies isInformative when dealing, the quote path accepts
 * any price strictly between 0 and 1 so a dealt card can still be swiped.
 */
export function toCardQuote(event: GeminiEvent, contract: GeminiContract, now: Date, options: CardOptions): CardQuote | null {
  if (!event.ticker || !contract.instrumentSymbol) return null;
  if (contract.marketState !== "open") return null;
  const priced = options.priced ?? contract;
  const prices = buyPricesOf(priced);
  if (!prices) return null;
  const expiresAt = expiresAtOf(event, contract);
  if (!expiresAt) return null;
  const lane = laneOf(expiresAt, now);
  if (!lane) return null;
  return {
    eventTicker: event.ticker,
    instrumentSymbol: contract.instrumentSymbol,
    question: questionFor(event, contract, priced),
    category: event.category ?? "Other",
    lane,
    expiresAt,
    tradable: options.tradable,
    yesPrice: prices.yes,
    noPrice: prices.no,
  };
}
