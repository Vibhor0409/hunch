// Context.dev web search for Hunch card context (docs/CONTEXT_DEV.md).
// Plain fetch against POST /v1/web/search; the official SDK documents only
// web.scrape, so no SDK method names are guessed. Server only: the key comes
// from process.env.CONTEXT_DEV_API_KEY and is never logged or returned.
import type { Lane } from "../types";

export const CONTEXT_DEV_BASE_URL = "https://api.context.dev/v1";
/** Abort the search after this long. The route budget is 30 s and Gemini lookups use part of it. */
export const SEARCH_TIMEOUT_MS = 10_000;
/** The API minimum; 1 credit per 10 results plus 1 for highlights, about 2 credits per lookup. */
export const NUM_RESULTS = 10;
/** Query length limit of the API. */
const MAX_QUERY_LENGTH = 500;

/** Odds and sportsbook sites never appear in context (CLAUDE.md rule 5: blind means blind). */
export const EXCLUDED_DOMAINS: readonly string[] = [
  "kalshi.com",
  "polymarket.com",
  "gemini.com",
  "predictit.org",
  "draftkings.com",
  "fanduel.com",
  "betmgm.com",
  "caesars.com",
  "oddschecker.com",
  "covers.com",
  "actionnetwork.com",
  "sportsbookreview.com",
  "oddsshark.com",
];

export type Freshness = "last_24_hours" | "last_week" | "last_month" | "last_year";
export type Relevance = "high" | "medium" | "low";

/** One search result, in the fields docs/samples/context-search.json shows. */
export interface SearchResult {
  url: string;
  title: string | null;
  description: string | null;
  relevance: Relevance | null;
  highlights: { highlights: string[] | null; code: string | null } | null;
}

export interface SearchResponse {
  results: SearchResult[];
  /** True when the API returned partial results. The field is absent from full responses. */
  partial: boolean;
  requestId: string | null;
  creditsConsumed: number;
  /** Null when the API did not report it, so the credit guard does not trip on a missing field. */
  creditsRemaining: number | null;
}

/** A non-2xx answer from Context.dev. Carries the status only, never the body. */
export class ContextDevError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`Context.dev search failed with HTTP ${status}`);
    this.name = "ContextDevError";
    this.status = status;
  }
}

/** Freshness window by lane (docs/CONTEXT_DEV.md): Live last 24 hours, otherwise last week. */
export function freshnessFor(lane: Lane): Freshness {
  return lane === "live" ? "last_24_hours" : "last_week";
}

/** The search query for a card: its question plus "latest news", within the API limit. */
export function queryFor(question: string): string {
  const suffix = " latest news";
  const room = MAX_QUERY_LENGTH - suffix.length;
  const base = question.replace(/\s+/g, " ").trim();
  const clipped = base.length > room ? base.slice(0, room).trimEnd() : base;
  return `${clipped}${suffix}`;
}

/** The exact request body from docs/CONTEXT_DEV.md. Shared by the route and the smoke script. */
export function searchBody(query: string, freshness: Freshness): Record<string, unknown> {
  return {
    query,
    numResults: NUM_RESULTS,
    freshness,
    excludeDomains: [...EXCLUDED_DOMAINS],
    highlightsOptions: { enabled: true, maxCharacters: 800 },
    descriptionMaxCharacters: 300,
    timeoutOpts: { milliseconds: 8000, behavior: "return-partial" },
    tags: ["hunch", "card-context"],
  };
}

function requireKey(): string {
  const key = process.env.CONTEXT_DEV_API_KEY;
  if (!key || key.trim() === "") {
    throw new Error("Missing environment variable CONTEXT_DEV_API_KEY. Set it in server/.env.local (or Vercel env vars).");
  }
  return key.trim();
}

/**
 * One raw POST /web/search. Returns the parsed JSON body as unknown; the smoke
 * script saves it to docs/samples/context-search.json. Throws ContextDevError
 * on a non-2xx status (none of those are charged) and a plain Error on a
 * network failure or the 10 second abort.
 */
export async function searchRaw(query: string, freshness: Freshness): Promise<unknown> {
  const key = requireKey();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${CONTEXT_DEV_BASE_URL}/web/search`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(searchBody(query, freshness)),
      signal: controller.signal,
    });
    if (!res.ok) throw new ContextDevError(res.status);
    return (await res.json()) as unknown;
  } finally {
    clearTimeout(timer);
  }
}

// ---------- Response parsing (fields seen in docs/samples/context-search.json) ----------

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function relevanceOf(value: unknown): Relevance | null {
  return value === "high" || value === "medium" || value === "low" ? value : null;
}

function toResult(value: unknown): SearchResult | null {
  if (!isRecord(value)) return null;
  const url = stringOrNull(value.url);
  if (!url) return null;
  let highlights: SearchResult["highlights"] = null;
  if (isRecord(value.highlights)) {
    const list = Array.isArray(value.highlights.highlights)
      ? value.highlights.highlights.filter((h): h is string => typeof h === "string")
      : null;
    highlights = { highlights: list, code: stringOrNull(value.highlights.code) };
  }
  return {
    url,
    title: stringOrNull(value.title),
    description: stringOrNull(value.description),
    relevance: relevanceOf(value.relevance),
    highlights,
  };
}

/** Narrows a raw response body to SearchResponse. Unknown or missing fields become empty or null. */
export function parseSearchResponse(body: unknown): SearchResponse {
  const record = isRecord(body) ? body : {};
  const results = Array.isArray(record.results)
    ? record.results.map(toResult).filter((r): r is SearchResult => r !== null)
    : [];
  const meta = isRecord(record.key_metadata) ? record.key_metadata : {};
  return {
    results,
    partial: record.partial === true,
    requestId: stringOrNull(record.request_id),
    creditsConsumed: numberOrNull(meta.credits_consumed) ?? 0,
    creditsRemaining: numberOrNull(meta.credits_remaining),
  };
}

// ---------- In-process tally (for the smoke script's summary) ----------

export interface RunUsage {
  calls: number;
  creditsConsumed: number;
  lastCreditsRemaining: number | null;
}

const tally: RunUsage = { calls: 0, creditsConsumed: 0, lastCreditsRemaining: null };

/** Adds one response to the in-process tally. The durable record is context_usage (store.ts). */
export function recordRunUsage(response: SearchResponse): void {
  tally.calls += 1;
  tally.creditsConsumed += response.creditsConsumed;
  if (response.creditsRemaining !== null) tally.lastCreditsRemaining = response.creditsRemaining;
}

/** Credits spent by this process since start. */
export function runUsage(): RunUsage {
  return { ...tally };
}

/**
 * One search with the documented body, parsed. Logs request id and credits
 * (never the key or the query) and updates the in-process tally.
 */
export async function searchContext(query: string, freshness: Freshness): Promise<SearchResponse> {
  const parsed = parseSearchResponse(await searchRaw(query, freshness));
  recordRunUsage(parsed);
  console.log(
    `[context] request_id=${parsed.requestId ?? "none"} credits_consumed=${parsed.creditsConsumed} credits_remaining=${parsed.creditsRemaining ?? "unknown"} results=${parsed.results.length}${parsed.partial ? " partial" : ""}`,
  );
  return parsed;
}
