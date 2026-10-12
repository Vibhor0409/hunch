// Hand-written input validation for the route handlers (no schema library).
import type { LaneFilter, Side } from "@/lib/types";

/** Names: 2 to 20 characters of letters, digits and spaces, after trimming (SPEC F1). */
const NAME_PATTERN = /^[\p{L}\p{Nd} ]{2,20}$/u;

/** Amount per trade, in dollars (SPEC F8). */
export const MIN_STAKE = 1;
export const MAX_STAKE = 100;

/**
 * Every accepted lane value, keyed by the LaneFilter type itself: when a lane
 * is added to or removed from lib/types.ts this object stops compiling until
 * it matches, so the runtime check cannot drift from the type.
 */
const LANE_FILTERS: Record<LaneFilter, true> = {
  foryou: true,
  live: true,
  tomorrow: true,
  week: true,
  later: true,
};

/** The trimmed name when it is valid, otherwise null. */
export function cleanName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim();
  return NAME_PATTERN.test(name) ? name : null;
}

/** The value when it is a non-empty string (ids, tickers, symbols), otherwise null. */
export function requireString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function isSide(value: unknown): value is Side {
  return value === "yes" || value === "no";
}

export function isLaneFilter(value: unknown): value is LaneFilter {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(LANE_FILTERS, value);
}

/**
 * The amount per trade rounded to 2 decimals when it is a finite number from
 * 1 to 100 after rounding, otherwise null.
 */
export function parseStake(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const rounded = Math.round(value * 100) / 100;
  return rounded >= MIN_STAKE && rounded <= MAX_STAKE ? rounded : null;
}

/** The app's Practice / Live toggle, sent as the optional `mode` field of a swipe. */
export type SessionMode = "practice" | "live";

/**
 * The session mode of a swipe. Only the exact string "practice" selects a
 * practice session. A missing field, null or any other value means "live",
 * which is the behavior from before the toggle existed.
 */
export function sessionModeOf(value: unknown): SessionMode {
  return value === "practice" ? "practice" : "live";
}
