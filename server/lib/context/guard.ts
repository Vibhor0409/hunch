// Credit guard and cache lifetimes for the Context.dev add-on. Pure: no I/O.
// Spec: docs/CONTEXT_DEV.md, "Cache" and "Credit guard".
import type { Lane } from "../types";

/** Daily credit cap when CONTEXT_DEV_DAILY_CREDIT_CAP is unset or invalid. */
export const DEFAULT_DAILY_CREDIT_CAP = 400;
/** No more calls once the key reports fewer credits than this; the human must add credits. */
export const MIN_CREDITS_REMAINING = 50;

const MINUTE_MS = 60_000;
/** Live cards change fast and expire within the hour. */
export const LIVE_TTL_MS = 30 * MINUTE_MS;
/** Tomorrow and This week cards. */
export const DEFAULT_TTL_MS = 6 * 60 * MINUTE_MS;
/** A market with no usable context is not searched again for this long (negative cache). */
export const EMPTY_TTL_MS = 30 * MINUTE_MS;

/** Today's usage as the guard sees it (see store.ts readUsage). */
export interface UsageSnapshot {
  creditsUsed: number;
  lastCreditsRemaining: number | null;
}

/** The daily cap from the environment: a positive integer, else the default. */
export function dailyCreditCap(raw: string | undefined = process.env.CONTEXT_DEV_DAILY_CREDIT_CAP): number {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : DEFAULT_DAILY_CREDIT_CAP;
}

/**
 * Whether one more search may run. False once today's credits used reach the
 * cap (a call at the cap would exceed it) or the last seen credits_remaining
 * is below the minimum. An unknown remaining balance does not block.
 */
export function guardAllows(usage: UsageSnapshot, cap: number = dailyCreditCap(), minRemaining: number = MIN_CREDITS_REMAINING): boolean {
  if (usage.creditsUsed >= cap) return false;
  if (usage.lastCreditsRemaining !== null && usage.lastCreditsRemaining < minRemaining) return false;
  return true;
}

/** Cache lifetime: 30 minutes for Live, 6 hours otherwise; 30 minutes when nothing was found. */
export function ttlFor(lane: Lane, found: boolean): number {
  if (!found) return EMPTY_TTL_MS;
  return lane === "live" ? LIVE_TTL_MS : DEFAULT_TTL_MS;
}
