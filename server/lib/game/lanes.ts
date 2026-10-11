import type { CardPublic, Lane } from "../types";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** A contract is Live when it expires within this window (SPEC F2). */
export const LIVE_WINDOW_MS = 60 * MINUTE_MS;
/** Tomorrow: expires within this window and is not Live. */
export const TOMORROW_WINDOW_MS = 48 * HOUR_MS;
/** This week: expires within this window and is neither Live nor Tomorrow. */
export const WEEK_WINDOW_MS = 7 * DAY_MS;

/**
 * Assigns a lane from the time left until expiry.
 * Returns null when the contract has already expired (or expires right now),
 * when it is more than 7 days out, or when the timestamp cannot be parsed.
 */
export function laneFor(expiresAt: string, now: Date): Lane | null {
  const expires = new Date(expiresAt).getTime();
  if (Number.isNaN(expires)) return null;
  const remaining = expires - now.getTime();
  if (remaining <= 0) return null;
  if (remaining > WEEK_WINDOW_MS) return null;
  if (remaining <= LIVE_WINDOW_MS) return "live";
  if (remaining <= TOMORROW_WINDOW_MS) return "tomorrow";
  return "week";
}

/**
 * Builds the For You order: a Live card in every third slot (zero-based
 * positions 2, 5, 8, ...) while Live cards remain, other cards everywhere else.
 * When either group runs out the rest of the other group follows in order.
 * Relative order inside each group is preserved and no card is dropped.
 * With no Live cards the original order comes back unchanged (as a copy).
 */
export function mixForYou(cards: CardPublic[]): CardPublic[] {
  const live = cards.filter((card) => card.lane === "live");
  if (live.length === 0) return [...cards];
  const others = cards.filter((card) => card.lane !== "live");

  const mixed: CardPublic[] = [];
  let liveIndex = 0;
  let otherIndex = 0;
  for (let slot = 0; slot < cards.length; slot++) {
    const liveSlot = slot % 3 === 2;
    const takeLive = liveSlot ? liveIndex < live.length : otherIndex >= others.length;
    mixed.push(takeLive ? live[liveIndex++] : others[otherIndex++]);
  }
  return mixed;
}
