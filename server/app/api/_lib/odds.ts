// Odds shown on the reveal (SPEC F3). Gemini buy prices include the spread,
// so the YES and NO buy prices of one contract add up to more than 1 (77 + 54
// observed). The reveal shows the two sides normalized to add up to exactly
// 100. Edge, the stored swipe price and the receipt keep the raw buy price of
// the chosen side; only the displayed percentages are normalized.
import type { Side } from "@/lib/types";

export interface RevealPcts {
  /** 0 to 100, yesPct + noPct === 100. */
  yesPct: number;
  noPct: number;
  /** The chosen side's normalized value: yesPct for a YES call, noPct for a NO call. */
  sidedWithPct: number;
}

/**
 * Normalizes the two buy prices to percentages that sum to 100.
 * yesPct = round(yesPrice / (yesPrice + noPrice) x 100), noPct = 100 - yesPct.
 * Falls back to 50 / 50 when the total is zero, negative or not a number.
 */
export function revealPcts(yesPrice: number, noPrice: number, side: Side): RevealPcts {
  const total = yesPrice + noPrice;
  let yesPct = 50;
  if (Number.isFinite(total) && total > 0) {
    yesPct = Math.min(100, Math.max(0, Math.round((yesPrice / total) * 100)));
  }
  const noPct = 100 - yesPct;
  return { yesPct, noPct, sidedWithPct: side === "yes" ? yesPct : noPct };
}
