// Context.dev web search for Hunch card context (docs/CONTEXT_DEV.md).
// Plain fetch against POST /v1/web/search; the official SDK documents only
// web.scrape, so no SDK method names are guessed. Server only: the key comes
// from process.env.CONTEXT_DEV_API_KEY and is never logged or returned.
import type { Lane } from "../types";

export const CONTEXT_DEV_BASE_URL = "https://api.context.dev/v1";
/**
 * Time budget per search (docs/CONTEXT_DEV.md, "Always-on context"). The API is
 * asked to answer within `apiTimeoutMs` with whatever it has ("return-partial"),
 * and the request is aborted at `abortMs` when it still has not answered.
 */
export interface SearchBudget {
  apiTimeoutMs: number;
  abortMs: number;
}
/** Tier 1 (exact question): at most 4.5 s. */
export const TIER1_BUDGET: SearchBudget = { apiTimeoutMs: 4_000, abortMs: 4_500 };
/** Tier 2 (broad subject): at most 3.5 s. */
export const TIER2_BUDGET: SearchBudget = { apiTimeoutMs: 3_000, abortMs: 3_500 };
/** The gap kept between the API's own timeout and the abort. */
const ABORT_MARGIN_MS = 500;
/** Freshness window of the broad tier. */
export const BROAD_FRESHNESS = "last_month" as const;
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

function withSuffix(text: string, suffix: string): string {
  const room = MAX_QUERY_LENGTH - suffix.length;
  const base = text.replace(/\s+/g, " ").trim();
  const clipped = base.length > room ? base.slice(0, room).trimEnd() : base;
  return `${clipped}${suffix}`;
}

/** Tier 1 query: the card's question plus "latest news", within the API limit. */
export function queryFor(question: string): string {
  return withSuffix(question, " latest news");
}

/** Tier 2 query: the market's subject (see subject.ts) plus "news", within the API limit. */
export function broadQueryFor(subject: string): string {
  return withSuffix(subject, " news");
}

/**
 * The search budget that fits in `remainingMs`: the tier's own budget, shortened
 * when less time is left. Null when too little is left for a useful answer.
 */
export function budgetWithin(budget: SearchBudget, remainingMs: number, minAbortMs = 1_500): SearchBudget | null {
  const abortMs = Math.min(budget.abortMs, Math.floor(remainingMs));
  if (abortMs < minAbortMs) return null;
  return { abortMs, apiTimeoutMs: Math.min(budget.apiTimeoutMs, abortMs - ABORT_MARGIN_MS) };
}

/**
 * The request body from docs/CONTEXT_DEV.md. Shared by both web tiers; only
 * the query, the freshness and the API timeout differ between them.
 */
export function searchBody(query: string, freshness: Freshness, apiTimeoutMs: number = TIER1_BUDGET.apiTimeoutMs): Record<string, unknown> {
  return {
    query,
    numResults: NUM_RESULTS,
    freshness,
    excludeDomains: [...EXCLUDED_DOMAINS],
    highlightsOptions: { enabled: true, maxCharacters: 800 },
    descriptionMaxCharacters: 300,
    timeoutOpts: { milliseconds: apiTimeoutMs, behavior: "return-partial" },
    tags: ["hunch", "card-context"],
  };
}

/** Whether the Context.dev key is configured. Without it the web tiers are skipped. */
export function hasContextKey(): boolean {
  return (process.env.CONTEXT_DEV_API_KEY ?? "").trim() !== "";
}

function requireKey(): string {
  const key = process.env.CONTEXT_DEV_API_KEY;
  if (!key || key.trim() === "") {
    throw new Error("Missing environment variable CONTEXT_DEV_API_KEY. Set it in server/.env.local (or Vercel env vars).");
  }
  return key.trim();
}

/**
 * One raw POST /web/search. Returns the parsed JSON body as unknown. Throws
 * ContextDevError on a non-2xx status (none of those are charged) and a plain
 * Error on a network failure or when the budget's abort fires.
 */
export async function searchRaw(query: string, freshness: Freshness, budget: SearchBudget = TIER1_BUDGET): Promise<unknown> {
  const key = requireKey();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), budget.abortMs);
  try {
    const res = await fetch(`${CONTEXT_DEV_BASE_URL}/web/search`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(searchBody(query, freshness, budget.apiTimeoutMs)),
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
 * One search with the documented body, parsed, within `budget`. Updates the
 * in-process tally. Logs nothing: getCardContext writes the one log line per
 * lookup (tier, time, credits), and the key and the query are never logged.
 */
export async function searchContext(query: string, freshness: Freshness, budget: SearchBudget = TIER1_BUDGET): Promise<SearchResponse> {
  const parsed = parseSearchResponse(await searchRaw(query, freshness, budget));
  recordRunUsage(parsed);
  return parsed;
}
