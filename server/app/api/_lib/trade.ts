// Hunch's own id for a stored call, shown on the receipt of every swipe so a
// wallet-funded call on a market that is not on the sandbox still has an id.
// Display only: it is derived from the swipe's uuid on the way out, never
// stored, and never written to order_id (the Gemini orders counter reads that
// column).

/** Prefix of every Hunch trade id. */
export const TRADE_ID_PREFIX = "HN-";

/**
 * "HN-" followed by the first 8 hex characters of the swipe's uuid, with
 * hyphens removed and letters uppercased, for example "HN-3F9A21C7".
 * Pure: the same swipe id always gives the same trade id.
 */
export function tradeIdOf(swipeId: string): string {
  return `${TRADE_ID_PREFIX}${swipeId.replace(/-/g, "").slice(0, 8).toUpperCase()}`;
}
