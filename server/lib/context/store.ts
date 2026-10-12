// Queries for the Context.dev add-on tables card_context and context_usage
// (supabase/context.sql). These tables are not part of the Database type in
// lib/db/client.ts (owned by the data-architect), so they are reached through
// an untyped view of the same client and narrowed here.
import type { SupabaseClient } from "@supabase/supabase-js";
import { getDb } from "../db/client";
import { laDayBounds } from "../game/time";
import type { PickedContext } from "./pick";

type CardContextRow = {
  cache_key: string;
  text: string | null;
  source_title: string | null;
  source_url: string | null;
  source_domain: string | null;
  fetched_at: string;
  expires_at: string;
};

type ContextUsageRow = {
  day: string;
  calls: number;
  credits_used: number;
  last_credits_remaining: number | null;
  updated_at: string;
};

function untyped(): SupabaseClient {
  return getDb() as unknown as SupabaseClient;
}

function fail(context: string, error: { message: string; code?: string }): never {
  throw new Error(`${context}: ${error.message} (code ${error.code || "none"})`);
}

function toNumber(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  return toNumber(value);
}

// ---------- card_context ----------

/**
 * Cache key: the event's series when its events differ only by their date
 * stamp (all BTC 5-minute events share "BTC05M", and "XRP2610122100" shares
 * "XRP1H"), else the event ticker. A series whose tickers carry something more
 * is not one subject: "WXHIGH" covers every city ("WXHIGH-AUS-2610120359"), and
 * Austin's weather must not answer for Washington, so those keep their ticker.
 */
export function cacheKeyFor(series: string | null | undefined, eventTicker: string): string {
  const trimmed = series?.trim() ?? "";
  if (trimmed.length === 0) return eventTicker;
  const stem = eventTicker.replace(/\d{6,}$/, "");
  return stem.length > 0 && stem !== eventTicker && trimmed.startsWith(stem) ? trimmed : eventTicker;
}

export interface CachedContext {
  /** Null means the last search found nothing usable (negative cache). */
  text: string | null;
  sourceTitle: string | null;
  sourceUrl: string | null;
  sourceDomain: string | null;
  fetchedAt: string;
  expiresAt: string;
}

/** The unexpired cache row for a key, or null when missing or expired. */
export async function readCachedContext(key: string, now: Date = new Date()): Promise<CachedContext | null> {
  const { data, error } = await untyped()
    .from("card_context")
    .select()
    .eq("cache_key", key)
    .gt("expires_at", now.toISOString())
    .maybeSingle();
  if (error) fail("readCachedContext", error);
  if (!data) return null;
  const row = data as CardContextRow;
  return {
    text: row.text,
    sourceTitle: row.source_title,
    sourceUrl: row.source_url,
    sourceDomain: row.source_domain,
    fetchedAt: row.fetched_at,
    expiresAt: row.expires_at,
  };
}

/** Stores a result (or null for "nothing usable") under a key for ttlMs, replacing any older row. */
export async function writeCachedContext(key: string, picked: PickedContext | null, ttlMs: number, now: Date = new Date()): Promise<void> {
  const row: CardContextRow = {
    cache_key: key,
    text: picked?.text ?? null,
    source_title: picked?.sourceTitle ?? null,
    source_url: picked?.sourceUrl ?? null,
    source_domain: picked?.sourceDomain ?? null,
    fetched_at: now.toISOString(),
    expires_at: new Date(now.getTime() + ttlMs).toISOString(),
  };
  const { error } = await untyped().from("card_context").upsert(row, { onConflict: "cache_key" });
  if (error) fail("writeCachedContext", error);
}

/**
 * Deletes every "nothing found" row (text null) so those markets are searched
 * again, and returns how many rows went. For the smoke script (--clear-misses).
 */
export async function clearCachedMisses(): Promise<number> {
  const { data, error } = await untyped().from("card_context").delete().is("text", null).select("cache_key");
  if (error) fail("clearCachedMisses", error);
  return Array.isArray(data) ? data.length : 0;
}

// ---------- context_usage ----------

/**
 * The America/Los_Angeles calendar date (YYYY-MM-DD) containing `now`, as the
 * context_usage.day key. laDayBounds gives LA midnight as a UTC instant, and
 * LA is behind UTC, so that instant's UTC date is the LA date.
 */
export function laDayOf(now: Date): string {
  return laDayBounds(now).startIso.slice(0, 10);
}

export interface Usage {
  day: string;
  calls: number;
  creditsUsed: number;
  lastCreditsRemaining: number | null;
}

/** Today's usage row, or zeros when no call has been made that day. */
export async function readUsage(day: string): Promise<Usage> {
  const { data, error } = await untyped().from("context_usage").select().eq("day", day).maybeSingle();
  if (error) fail("readUsage", error);
  if (!data) return { day, calls: 0, creditsUsed: 0, lastCreditsRemaining: null };
  const row = data as ContextUsageRow;
  return {
    day,
    calls: toNumber(row.calls),
    creditsUsed: toNumber(row.credits_used),
    lastCreditsRemaining: toNumberOrNull(row.last_credits_remaining),
  };
}

/**
 * Adds one call and its credits to the day's row (read then upsert; two
 * instances recording at the same instant may lose one increment, which the
 * cap tolerates). A null creditsRemaining keeps the last seen value.
 */
export async function recordUsage(day: string, creditsConsumed: number, creditsRemaining: number | null, now: Date = new Date()): Promise<Usage> {
  const current = await readUsage(day);
  const next: Usage = {
    day,
    calls: current.calls + 1,
    creditsUsed: current.creditsUsed + Math.max(0, creditsConsumed),
    lastCreditsRemaining: creditsRemaining ?? current.lastCreditsRemaining,
  };
  const row: ContextUsageRow = {
    day,
    calls: next.calls,
    credits_used: next.creditsUsed,
    last_credits_remaining: next.lastCreditsRemaining,
    updated_at: now.toISOString(),
  };
  const { error } = await untyped().from("context_usage").upsert(row, { onConflict: "day" });
  if (error) fail("recordUsage", error);
  return next;
}
