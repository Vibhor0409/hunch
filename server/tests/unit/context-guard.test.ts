import { describe, expect, it } from "vitest";
import sample from "../fixtures/context-search.json";
import { EXCLUDED_DOMAINS, freshnessFor, parseSearchResponse, queryFor, searchBody } from "../../lib/context/client";
import {
  DEFAULT_DAILY_CREDIT_CAP,
  DEFAULT_TTL_MS,
  EMPTY_TTL_MS,
  LIVE_TTL_MS,
  MIN_CREDITS_REMAINING,
  dailyCreditCap,
  guardAllows,
  ttlFor,
} from "../../lib/context/guard";
import { cacheKeyFor, laDayOf } from "../../lib/context/store";

describe("guardAllows", () => {
  it("allows a call under the cap with an unknown balance", () => {
    expect(guardAllows({ creditsUsed: 0, lastCreditsRemaining: null }, 400)).toBe(true);
    expect(guardAllows({ creditsUsed: 398, lastCreditsRemaining: 900 }, 400)).toBe(true);
  });

  it("blocks at or above the cap", () => {
    expect(guardAllows({ creditsUsed: 400, lastCreditsRemaining: 900 }, 400)).toBe(false);
    expect(guardAllows({ creditsUsed: 402, lastCreditsRemaining: 900 }, 400)).toBe(false);
  });

  it("blocks when the last seen balance is below 50", () => {
    expect(MIN_CREDITS_REMAINING).toBe(50);
    expect(guardAllows({ creditsUsed: 10, lastCreditsRemaining: 49 }, 400)).toBe(false);
    expect(guardAllows({ creditsUsed: 10, lastCreditsRemaining: 50 }, 400)).toBe(true);
  });
});

describe("dailyCreditCap", () => {
  it("defaults to 400 when unset or invalid", () => {
    expect(DEFAULT_DAILY_CREDIT_CAP).toBe(400);
    expect(dailyCreditCap(undefined)).toBe(400);
    expect(dailyCreditCap("")).toBe(400);
    expect(dailyCreditCap("abc")).toBe(400);
    expect(dailyCreditCap("0")).toBe(400);
    expect(dailyCreditCap("-5")).toBe(400);
  });

  it("reads a positive integer", () => {
    expect(dailyCreditCap("250")).toBe(250);
  });
});

describe("ttlFor", () => {
  it("is 30 minutes for Live and 6 hours otherwise", () => {
    expect(LIVE_TTL_MS).toBe(30 * 60_000);
    expect(DEFAULT_TTL_MS).toBe(6 * 60 * 60_000);
    expect(ttlFor("live", true)).toBe(LIVE_TTL_MS);
    expect(ttlFor("tomorrow", true)).toBe(DEFAULT_TTL_MS);
    expect(ttlFor("week", true)).toBe(DEFAULT_TTL_MS);
  });

  it("stores an empty result for 30 minutes in every lane", () => {
    expect(EMPTY_TTL_MS).toBe(30 * 60_000);
    expect(ttlFor("live", false)).toBe(EMPTY_TTL_MS);
    expect(ttlFor("week", false)).toBe(EMPTY_TTL_MS);
  });
});

describe("cacheKeyFor", () => {
  it("uses the series when present, else the ticker", () => {
    expect(cacheKeyFor("BTC05M", "BTC05M2610112230")).toBe("BTC05M");
    expect(cacheKeyFor(null, "COPPER2610122100")).toBe("COPPER2610122100");
    expect(cacheKeyFor(undefined, "X")).toBe("X");
    expect(cacheKeyFor("  ", "X")).toBe("X");
  });
});

describe("laDayOf", () => {
  it("is the America/Los_Angeles calendar date", () => {
    // 2026-10-11 05:30 UTC is 2026-10-10 22:30 PDT.
    expect(laDayOf(new Date("2026-10-11T05:30:00.000Z"))).toBe("2026-10-10");
    // 2026-10-11 08:00 UTC is 2026-10-11 01:00 PDT.
    expect(laDayOf(new Date("2026-10-11T08:00:00.000Z"))).toBe("2026-10-11");
    // Winter: 2026-12-20 07:30 UTC is 2026-12-19 23:30 PST.
    expect(laDayOf(new Date("2026-12-20T07:30:00.000Z"))).toBe("2026-12-19");
  });
});

describe("queryFor and freshnessFor", () => {
  it("appends latest news and collapses whitespace", () => {
    expect(queryFor("  Copper price on October 12:  $6.7 or above? ")).toBe("Copper price on October 12: $6.7 or above? latest news");
  });

  it("stays within the 500 character limit", () => {
    const query = queryFor("x".repeat(600));
    expect(query.length).toBeLessThanOrEqual(500);
    expect(query.endsWith(" latest news")).toBe(true);
  });

  it("maps lanes to freshness windows", () => {
    expect(freshnessFor("live")).toBe("last_24_hours");
    expect(freshnessFor("tomorrow")).toBe("last_week");
    expect(freshnessFor("week")).toBe("last_week");
  });
});

describe("searchBody", () => {
  it("has exactly the documented fields", () => {
    const body = searchBody("q latest news", "last_week");
    expect(body).toEqual({
      query: "q latest news",
      numResults: 10,
      freshness: "last_week",
      excludeDomains: [...EXCLUDED_DOMAINS],
      highlightsOptions: { enabled: true, maxCharacters: 800 },
      descriptionMaxCharacters: 300,
      timeoutOpts: { milliseconds: 8000, behavior: "return-partial" },
      tags: ["hunch", "card-context"],
    });
    expect(EXCLUDED_DOMAINS).toContain("kalshi.com");
    expect(EXCLUDED_DOMAINS).toContain("oddsshark.com");
    expect(EXCLUDED_DOMAINS).toHaveLength(13);
  });
});

describe("parseSearchResponse", () => {
  it("reads the saved sample (rewritten by every full smoke run, so only its shape is checked)", () => {
    const parsed = parseSearchResponse(sample);
    expect(parsed.results).toHaveLength(sample.results.length);
    expect(parsed.results.length).toBeGreaterThan(0);
    // `partial` was present (true) in the first saved response and absent in the second, so it is optional.
    expect(typeof parsed.partial).toBe("boolean");
    expect(parsed.requestId).toBe(sample.request_id);
    expect(parsed.creditsConsumed).toBe(sample.key_metadata.credits_consumed);
    expect(parsed.creditsRemaining).toBe(sample.key_metadata.credits_remaining);
    for (const [i, r] of parsed.results.entries()) {
      expect(r.url).toBe(sample.results[i]!.url);
      expect(["high", "medium", "low", null]).toContain(r.relevance);
      expect(r.highlights === null || r.highlights.highlights === null || Array.isArray(r.highlights.highlights)).toBe(true);
    }
  });

  it("reads the documented highlight shapes", () => {
    const parsed = parseSearchResponse({
      results: [
        { url: "https://a.example/", title: "A", description: "d", relevance: "medium", highlights: { highlights: null, code: "TIMEOUT" } },
        { url: "https://b.example/", title: "B", relevance: "high", highlights: { highlights: ["one", 2, "two"], code: "SUCCESS" } },
      ],
      partial: true,
      key_metadata: { credits_consumed: 2, credits_remaining: 974 },
      request_id: "req-1",
    });
    expect(parsed.results[0]!.highlights).toEqual({ highlights: null, code: "TIMEOUT" });
    expect(parsed.results[1]!.highlights).toEqual({ highlights: ["one", "two"], code: "SUCCESS" });
    expect(parsed).toMatchObject({ partial: true, requestId: "req-1", creditsConsumed: 2, creditsRemaining: 974 });
  });

  it("tolerates garbage", () => {
    expect(parseSearchResponse(null)).toEqual({ results: [], partial: false, requestId: null, creditsConsumed: 0, creditsRemaining: null });
    expect(parseSearchResponse({ results: [{ title: "no url" }, 5, { url: "https://a.b/" }] }).results).toEqual([
      { url: "https://a.b/", title: null, description: null, relevance: null, highlights: null },
    ]);
  });
});
