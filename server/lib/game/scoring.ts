/**
 * Whether paid orders use fractional contract quantities (SPEC F3).
 * The orchestrator flips this to false only if the Gemini sandbox smoke test
 * shows that fractional quantities are rejected.
 */
export const FRACTIONAL_CONTRACTS = true;

/** Rounds to one decimal and normalizes negative zero to zero. */
function round1(value: number): number {
  const rounded = Math.round(value * 10) / 10;
  return rounded === 0 ? 0 : rounded;
}

/**
 * Edge for a settled call (SPEC F4), where p is the price of the chosen side
 * at swipe time. Right: +10 x (1 - p). Wrong: -10 x p. One decimal.
 */
export function edgeFor(price: number, won: boolean): number {
  return won ? round1(10 * (1 - price)) : round1(-10 * price);
}

/**
 * Nudge that absorbs double rounding noise before flooring. Prices have two
 * decimals and stakes are whole dollars, so stake / price is either an exact
 * integer or at least 1/99 away from one; a 1e-9 nudge cannot cross a boundary
 * but does rescue cases like 3 / 0.06, which doubles may hold as 49.99999.
 */
const FLOOR_EPSILON = 1e-9;

/**
 * Contracts to buy for a stake at a price (SPEC F3 order rules).
 * Fractional: floor(stake / price x 100) / 100, so cost never exceeds the stake.
 * Whole: max(1, floor(stake / price)).
 * Returns 0 for a zero, negative or non-finite price, or a non-finite stake.
 */
export function contractsFor(stake: number, price: number, fractional: boolean = FRACTIONAL_CONTRACTS): number {
  if (!Number.isFinite(stake) || !Number.isFinite(price) || price <= 0) return 0;
  const ratio = stake / price + FLOOR_EPSILON;
  if (fractional) return Math.floor(ratio * 100) / 100;
  return Math.max(1, Math.floor(ratio));
}

/** A 0 to 1 price as a whole percentage, clamped to 0 to 100. */
export function pct(price: number): number {
  if (!Number.isFinite(price)) return 0;
  const rounded = Math.round(price * 100);
  return Math.min(100, Math.max(0, rounded));
}
