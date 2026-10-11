// Hand-written input validation for the route handlers (no schema library).
import type { LaneFilter, Side } from "@/lib/types";

/** Names: 2 to 20 characters of letters, digits and spaces, after trimming (SPEC F1). */
const NAME_PATTERN = /^[\p{L}\p{Nd} ]{2,20}$/u;

const LANE_FILTERS: readonly string[] = ["foryou", "live", "tomorrow", "week"];

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
  return typeof value === "string" && LANE_FILTERS.includes(value);
}
