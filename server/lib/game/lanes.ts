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
/** Later: expires beyond 7 days and within this window (elections, seasons). */
export const LATER_WINDOW_MS = 365 * DAY_MS;

/**
 * Assigns a lane from the time left until expiry. Boundaries are inclusive:
 * exactly 60 minutes is live, exactly 48 hours is tomorrow, exactly 7 days is
 * week, exactly 365 days is later.
 * Returns null when the contract has already expired (or expires right now),
 * when it is more than 365 days out, or when the timestamp cannot be parsed.
 */
export function laneFor(expiresAt: string, now: Date): Lane | null {
  const expires = new Date(expiresAt).getTime();
  if (Number.isNaN(expires)) return null;
  const remaining = expires - now.getTime();
  if (remaining <= 0) return null;
  if (remaining > LATER_WINDOW_MS) return null;
  if (remaining <= LIVE_WINDOW_MS) return "live";
  if (remaining <= TOMORROW_WINDOW_MS) return "tomorrow";
  if (remaining <= WEEK_WINDOW_MS) return "week";
  return "later";
}

/**
 * Index of the earliest card in the pool whose category differs from the
 * previous card's, or 0 when every remaining card shares that category.
 */
function pickIndex(pool: readonly CardPublic[], previousCategory: string | null): number {
  if (previousCategory === null) return 0;
  const index = pool.findIndex((card) => card.category !== previousCategory);
  return index === -1 ? 0 : index;
}

/**
 * Builds the For You order.
 *
 * Lane rule: a Live card in every third slot (zero-based positions 2, 5, 8,
 * ...) while Live cards remain, other cards everywhere else. When either
 * group runs out the rest of the other group fills the remaining slots.
 *
 * Category rule: inside the pool chosen for a slot, take the earliest card
 * (input order) whose category differs from the previous card's; when every
 * remaining card in that pool shares it, take the earliest card. The lane
 * rule decides the pool first, so it wins when the two rules conflict.
 *
 * Pure and stable: no card is dropped or duplicated, and the input is never
 * mutated. Cards with equal categories keep their relative order.
 */
export function mixForYou(cards: CardPublic[]): CardPublic[] {
  const live = cards.filter((card) => card.lane === "live");
  const others = cards.filter((card) => card.lane !== "live");

  const mixed: CardPublic[] = [];
  let previousCategory: string | null = null;
  for (let slot = 0; slot < cards.length; slot++) {
    const liveSlot = slot % 3 === 2;
    const takeLive = liveSlot ? live.length > 0 : others.length === 0;
    const pool = takeLive ? live : others;
    const card: CardPublic = pool.splice(pickIndex(pool, previousCategory), 1)[0];
    mixed.push(card);
    previousCategory = card.category;
  }
  return mixed;
}
