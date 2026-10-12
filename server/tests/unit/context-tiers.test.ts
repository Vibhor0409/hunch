// The tier flow of resolveCardContext (docs/CONTEXT_DEV.md, "Always-on context"),
// with Gemini, the database and the network replaced by stand-ins. The real
// client, picker, guard, subject and market modules run.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/gemini/quote", () => ({ getQuote: vi.fn() }));
vi.mock("../../lib/gemini/client", () => ({
  getPublicGemini: vi.fn(async (env: string) => ({ env })),
  getEventOrNull: vi.fn(),
}));
vi.mock("../../lib/context/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/context/store")>()),
  readCachedContext: vi.fn(),
  writeCachedContext: vi.fn(),
  readUsage: vi.fn(),
  recordUsage: vi.fn(),
}));

import { getCardContext, resolveCardContext } from "../../lib/context";
import { DEFAULT_TTL_MS, EMPTY_TTL_MS, LIVE_TTL_MS } from "../../lib/context/guard";
import { readCachedContext, readUsage, recordUsage, writeCachedContext } from "../../lib/context/store";
import { getEventOrNull } from "../../lib/gemini/client";
import { getQuote } from "../../lib/gemini/quote";
import type { CardQuote, Lane } from "../../lib/types";

const FAKE_KEY = "unit-test-key-not-real";
const SEARCH_URL = "https://api.context.dev/v1/web/search";
const HOUR_MS = 60 * 60 * 1000;

let seq = 0;
/** A fresh market per test: the module keeps a per-instance memo and an in-flight map. */
function market(options: { lane?: Lane; series?: string | null; title?: string; label?: string } = {}) {
  const id = ++seq;
  const title = options.title ?? `Harbor bridge vote ${id}`;
  const label = options.label ?? "Passes";
  const eventTicker = options.series ? `${options.series}26101221${String(id).padStart(2, "0")}` : `BRIDGE${id}`;
  const instrumentSymbol = `GEMI-${eventTicker}-YES`;
  const expiresAt = new Date(Date.now() + 30 * HOUR_MS).toISOString();
  const contract = {
    instrumentSymbol,
    label,
    marketState: "open",
    expiryDate: expiresAt,
    prices: { buy: { yes: "0.3712", no: "0.6288" }, sell: { yes: "0.3688", no: "0.6312" } },
    termsAndConditionsUrl: "",
    description: {
      nodeType: "document",
      content: [{ nodeType: "text", value: `If the council passes the bridge plan ${id}, this market resolves to Yes. Otherwise, it resolves to No. Outcome verified from the city clerk.` }],
    },
  };
  const event = { ticker: eventTicker, title, category: "Politics", series: options.series ?? null, expiryDate: expiresAt, contracts: [contract] };
  const card: CardQuote = {
    eventTicker,
    instrumentSymbol,
    question: `${title}: ${label}?`,
    category: "Politics",
    lane: options.lane ?? "tomorrow",
    expiresAt,
    tradable: false,
    yesPrice: 0.3712,
    noPrice: 0.6288,
  };
  return { eventTicker, instrumentSymbol, event, card, title };
}

const NEWS = "The council moved the bridge vote to Thursday after a long debate on costs.";
const BROAD_NEWS = "Engineers told the council that the old bridge needs repairs within two years.";

function hit(text: string, extra: Record<string, unknown> = {}) {
  return { url: "https://www.example.com/story", title: "Bridge vote", description: "", relevance: "medium", highlights: { highlights: [text], code: "SUCCESS" }, ...extra };
}

function timedOut(description: string, extra: Record<string, unknown> = {}) {
  return { url: "https://news.example.org/a", title: "Bridge news", description, relevance: "medium", highlights: { highlights: null, code: "TIMEOUT" }, ...extra };
}

function body(results: unknown[], credits = 2, remaining = 900) {
  return { results, key_metadata: { credits_consumed: credits, credits_remaining: remaining }, request_id: "req-test" };
}

type Reply = { status?: number; body?: unknown } | Error;

/** Queues the replies of POST /web/search, in order, and records every request. */
function stubSearch(...replies: Reply[]) {
  const requests: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = [];
  const fetchMock = vi.fn(async (url: unknown, init?: RequestInit) => {
    requests.push({ url: String(url), headers: (init?.headers ?? {}) as Record<string, string>, body: JSON.parse(String(init?.body)) as Record<string, unknown> });
    const reply = replies.shift();
    if (!reply) throw new Error("unexpected search");
    if (reply instanceof Error) throw reply;
    return new Response(JSON.stringify(reply.body ?? {}), { status: reply.status ?? 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return requests;
}

let logs: string[];

beforeEach(() => {
  process.env.CONTEXT_DEV_API_KEY = FAKE_KEY;
  delete process.env.CONTEXT_DEV_DAILY_CREDIT_CAP;
  logs = [];
  for (const method of ["log", "warn", "error", "info"] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    });
  }
  vi.mocked(readCachedContext).mockResolvedValue(null);
  vi.mocked(writeCachedContext).mockResolvedValue(undefined);
  vi.mocked(readUsage).mockResolvedValue({ day: "2026-10-11", calls: 0, creditsUsed: 0, lastCreditsRemaining: null });
  vi.mocked(recordUsage).mockImplementation(async (day, consumed, remaining) => ({ day, calls: 1, creditsUsed: consumed, lastCreditsRemaining: remaining }));
  vi.mocked(getQuote).mockResolvedValue(null);
  vi.mocked(getEventOrNull).mockResolvedValue(null);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  delete process.env.CONTEXT_DEV_API_KEY;
  delete process.env.CONTEXT_DEV_DAILY_CREDIT_CAP;
});

function deal(m: ReturnType<typeof market>, options: { quote?: boolean; event?: boolean } = {}) {
  vi.mocked(getQuote).mockResolvedValue(options.quote === false ? null : m.card);
  vi.mocked(getEventOrNull).mockImplementation(async (client) => ((client as unknown as { env: string }).env === "production" && options.event !== false ? (m.event as never) : null));
}

describe("tier 1: web, exact", () => {
  it("answers with the question's own news and stores it", async () => {
    const m = market();
    deal(m);
    const requests = stubSearch({ body: body([hit(NEWS)]) });

    const lookup = await resolveCardContext(m.eventTicker, m.instrumentSymbol);

    expect(lookup.context).toEqual({
      available: true,
      kind: "web",
      text: NEWS,
      sourceTitle: "Bridge vote",
      sourceUrl: "https://www.example.com/story",
      sourceDomain: "example.com",
      cached: false,
    });
    expect(lookup).toMatchObject({ tier: 1, credits: 2, searches: 1 });
    expect(requests).toHaveLength(1);
    expect(requests[0]!.url).toBe(SEARCH_URL);
    expect(requests[0]!.body).toMatchObject({
      query: `${m.title}: Passes? latest news`,
      freshness: "last_week",
      numResults: 10,
      timeoutOpts: { milliseconds: 4000, behavior: "return-partial" },
    });
    expect(writeCachedContext).toHaveBeenCalledTimes(1);
    expect(vi.mocked(writeCachedContext).mock.calls[0]!.slice(0, 3)).toEqual([m.eventTicker, expect.objectContaining({ text: NEWS }), DEFAULT_TTL_MS]);
    expect(recordUsage).toHaveBeenCalledWith("2026-10-11", 2, 900);
  });

  it("uses the last 24 hours and the 30 minute lifetime for a live card, and the series as the key", async () => {
    const m = market({ lane: "live", series: "SOL05M", title: "SOL price today at 7:50pm EDT", label: "Up" });
    deal(m);
    const requests = stubSearch({ body: body([hit(NEWS)]) });

    await resolveCardContext(m.eventTicker, m.instrumentSymbol);

    expect(requests[0]!.body.freshness).toBe("last_24_hours");
    expect(vi.mocked(readCachedContext).mock.calls[0]![0]).toBe("SOL05M");
    expect(vi.mocked(writeCachedContext).mock.calls[0]!.slice(0, 3)).toEqual(["SOL05M", expect.anything(), LIVE_TTL_MS]);
  });

  it("logs one line with the tier, the time and the credits, and nothing else", async () => {
    const m = market();
    deal(m);
    stubSearch({ body: body([hit(NEWS)], 2) });

    await getCardContext(m.eventTicker, m.instrumentSymbol);

    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatch(/^\[context\] tier=1 ms=\d+ credits=2$/);
    expect(logs.join("\n")).not.toContain(FAKE_KEY);
  });
});

describe("tier 2: web, broad", () => {
  it("runs only when tier 1 picks nothing, on the subject, over the last month", async () => {
    const m = market({ title: "SOL price today at 7:50pm EDT", label: "Up" });
    deal(m);
    const requests = stubSearch({ body: body([timedOut("")], 1) }, { body: body([hit(BROAD_NEWS)], 2) });

    const lookup = await resolveCardContext(m.eventTicker, m.instrumentSymbol);

    expect(lookup.context).toMatchObject({ available: true, kind: "web", text: BROAD_NEWS, cached: false });
    expect(lookup).toMatchObject({ tier: 2, credits: 3, searches: 2 });
    expect(requests).toHaveLength(2);
    expect(requests[1]!.url).toBe(SEARCH_URL);
    expect(requests[1]!.body).toMatchObject({ query: "Solana price today news", freshness: "last_month", numResults: 10 });
    expect((requests[1]!.body.timeoutOpts as { milliseconds: number }).milliseconds).toBeLessThanOrEqual(3000);
    expect(requests[1]!.body.excludeDomains).toEqual(requests[0]!.body.excludeDomains);
    expect(recordUsage).toHaveBeenCalledTimes(2);
    expect(logs).toEqual([expect.stringMatching(/^\[context\] tier=2 ms=\d+ credits=3$/)]);
  });

  it("accepts a description and a low relevance result, which tier 1 does not", async () => {
    const m = market();
    deal(m);
    const loose = [timedOut(BROAD_NEWS, { relevance: "low" })];
    stubSearch({ body: body(loose, 1) }, { body: body(loose, 1) });

    const lookup = await resolveCardContext(m.eventTicker, m.instrumentSymbol);

    expect(lookup.tier).toBe(2);
    expect(lookup.context).toMatchObject({ kind: "web", text: BROAD_NEWS, sourceDomain: "news.example.org" });
  });

  it("still runs after tier 1 times out", async () => {
    const m = market();
    deal(m);
    const requests = stubSearch(new Error("The operation was aborted"), { body: body([hit(BROAD_NEWS)]) });

    const lookup = await resolveCardContext(m.eventTicker, m.instrumentSymbol);

    expect(requests).toHaveLength(2);
    expect(lookup).toMatchObject({ tier: 2, searches: 2, credits: 2 });
    expect(lookup.context.kind).toBe("web");
  });

  it("is skipped after an answer that would only repeat (bad key, rate limit)", async () => {
    for (const status of [401, 429]) {
      const m = market();
      deal(m);
      const requests = stubSearch({ status, body: { message: "no" } });
      const lookup = await resolveCardContext(m.eventTicker, m.instrumentSymbol);
      expect(requests).toHaveLength(1);
      expect(lookup.context.kind).toBe("market");
    }
  });
});

describe("tier 3: market rules", () => {
  it("answers when both web tiers pick nothing, and stores the miss for 30 minutes", async () => {
    const m = market();
    deal(m);
    const requests = stubSearch({ body: body([], 0) }, { status: 408, body: { message: "timeout" } });

    const lookup = await resolveCardContext(m.eventTicker, m.instrumentSymbol);

    expect(requests).toHaveLength(2);
    expect(lookup.context).toMatchObject({ available: true, kind: "market", sourceTitle: "Market rules on Gemini", sourceUrl: null, sourceDomain: null, cached: false });
    expect(lookup.context.text).toMatch(/^If the council passes the bridge plan \d+, this market resolves to Yes\. Outcome verified from the city clerk\. It closes on .+ ET\.$/);
    expect(lookup.context.text).not.toMatch(/0\.37|0\.62|37%|63%/);
    expect(lookup).toMatchObject({ tier: 3, searches: 2, credits: 0 });
    expect(vi.mocked(writeCachedContext).mock.calls[0]!.slice(0, 3)).toEqual([m.eventTicker, null, EMPTY_TTL_MS]);
    expect(EMPTY_TTL_MS).toBe(30 * 60_000);
    expect(logs).toEqual([expect.stringMatching(/^\[context\] tier=3 ms=\d+ credits=0$/)]);
  });

  it("returns at once on a stored miss, with cached: true and no search", async () => {
    const m = market();
    deal(m);
    vi.mocked(readCachedContext).mockResolvedValue({ text: null, sourceTitle: null, sourceUrl: null, sourceDomain: null, fetchedAt: "", expiresAt: "" });
    const requests = stubSearch();

    const lookup = await resolveCardContext(m.eventTicker, m.instrumentSymbol);

    expect(requests).toHaveLength(0);
    expect(lookup.context).toMatchObject({ available: true, kind: "market", cached: true });
    expect(lookup.context.text).toContain("this market resolves to Yes");
    expect(writeCachedContext).not.toHaveBeenCalled();
    expect(readUsage).not.toHaveBeenCalled();
  });

  it("answers without a search when the credit guard trips, and stores nothing", async () => {
    for (const usage of [
      { creditsUsed: 400, lastCreditsRemaining: 900 },
      { creditsUsed: 10, lastCreditsRemaining: 49 },
    ]) {
      const m = market();
      deal(m);
      vi.mocked(readUsage).mockResolvedValue({ day: "2026-10-11", calls: 5, ...usage });
      const requests = stubSearch();

      const lookup = await resolveCardContext(m.eventTicker, m.instrumentSymbol);

      expect(requests).toHaveLength(0);
      expect(lookup.context).toMatchObject({ available: true, kind: "market", cached: false });
      expect(lookup).toMatchObject({ tier: 3, searches: 0, credits: 0 });
    }
    expect(writeCachedContext).not.toHaveBeenCalled();
  });

  it("stops before tier 2 when tier 1 spends the last credits under the cap", async () => {
    const m = market();
    deal(m);
    process.env.CONTEXT_DEV_DAILY_CREDIT_CAP = "10";
    vi.mocked(readUsage).mockResolvedValue({ day: "2026-10-11", calls: 4, creditsUsed: 8, lastCreditsRemaining: 900 });
    const requests = stubSearch({ body: body([], 2) });

    const lookup = await resolveCardContext(m.eventTicker, m.instrumentSymbol);

    expect(requests).toHaveLength(1);
    expect(lookup).toMatchObject({ tier: 3, searches: 1, credits: 2 });
    expect(vi.mocked(writeCachedContext).mock.calls[0]!.slice(0, 3)).toEqual([m.eventTicker, null, EMPTY_TTL_MS]);
  });

  it("answers without a search when the key is missing", async () => {
    const m = market();
    deal(m);
    delete process.env.CONTEXT_DEV_API_KEY;
    const requests = stubSearch();

    const lookup = await resolveCardContext(m.eventTicker, m.instrumentSymbol);

    expect(requests).toHaveLength(0);
    expect(lookup.context).toMatchObject({ available: true, kind: "market", cached: false });
    expect(writeCachedContext).not.toHaveBeenCalled();
  });

  it("is built from the card alone when the event lookup fails", async () => {
    const m = market();
    deal(m, { event: false });
    stubSearch({ body: body([]) }, { body: body([]) });

    const lookup = await resolveCardContext(m.eventTicker, m.instrumentSymbol);

    expect(lookup.context).toMatchObject({ available: true, kind: "market", sourceTitle: "Market rules on Gemini", sourceUrl: null, sourceDomain: null });
    expect(lookup.context.text).toMatch(new RegExp(`^This market resolves YES if the answer to "${m.title}: Passes\\?" is yes, and NO otherwise\\. It closes on .+ ET\\.$`));
  });

  it("still answers when the database fails", async () => {
    const m = market();
    deal(m);
    vi.mocked(readCachedContext).mockRejectedValue(new Error("db down"));
    const requests = stubSearch();

    const lookup = await resolveCardContext(m.eventTicker, m.instrumentSymbol);

    expect(requests).toHaveLength(0);
    expect(lookup.context).toMatchObject({ available: true, kind: "market", cached: false });
    expect(logs).toEqual([expect.stringMatching(/^\[context\] tier=3 ms=\d+ credits=0$/)]);
  });
});

describe("cache and availability", () => {
  it("returns a stored web line with cached: true and no search", async () => {
    const m = market();
    deal(m);
    vi.mocked(readCachedContext).mockResolvedValue({ text: NEWS, sourceTitle: "Bridge vote", sourceUrl: "https://www.example.com/story", sourceDomain: "example.com", fetchedAt: "", expiresAt: "" });
    const requests = stubSearch();

    const lookup = await resolveCardContext(m.eventTicker, m.instrumentSymbol);

    expect(requests).toHaveLength(0);
    expect(lookup.context).toEqual({ available: true, kind: "web", text: NEWS, sourceTitle: "Bridge vote", sourceUrl: "https://www.example.com/story", sourceDomain: "example.com", cached: true });
    expect(lookup).toMatchObject({ credits: 0, searches: 0 });
  });

  it("is unavailable only when neither the feed nor Gemini knows the market", async () => {
    const m = market();
    deal(m, { quote: false, event: false });
    const requests = stubSearch();

    const context = await getCardContext(m.eventTicker, m.instrumentSymbol);

    expect(context).toEqual({ available: false, kind: "market", text: null, sourceTitle: null, sourceUrl: null, sourceDomain: null, cached: false });
    expect(requests).toHaveLength(0);
    expect(readCachedContext).not.toHaveBeenCalled();
  });

  it("rebuilds the card from the event when the feed no longer deals it", async () => {
    const m = market();
    deal(m, { quote: false });
    const requests = stubSearch({ body: body([hit(NEWS)]) });

    const lookup = await resolveCardContext(m.eventTicker, m.instrumentSymbol);

    expect(requests[0]!.body.query).toBe(`${m.title}: Passes? latest news`);
    expect(lookup.context).toMatchObject({ available: true, kind: "web", text: NEWS });
  });

  it("shares one search between two requests for the same market at the same time", async () => {
    const m = market();
    deal(m);
    const requests = stubSearch({ body: body([hit(NEWS)]) });

    const [a, b] = await Promise.all([resolveCardContext(m.eventTicker, m.instrumentSymbol), resolveCardContext(m.eventTicker, m.instrumentSymbol)]);

    expect(requests).toHaveLength(1);
    expect(a.context.text).toBe(NEWS);
    expect(b.context.text).toBe(NEWS);
    expect(a.credits + b.credits).toBe(2);
  });

  it("never sends the key anywhere but the search endpoint's header, and never calls another endpoint", async () => {
    const m = market();
    deal(m);
    const requests = stubSearch({ body: body([]) }, { body: body([]) });

    await resolveCardContext(m.eventTicker, m.instrumentSymbol);

    for (const request of requests) {
      expect(request.url).toBe(SEARCH_URL);
      expect(request.headers.Authorization).toBe(`Bearer ${FAKE_KEY}`);
      expect(JSON.stringify(request.body)).not.toContain(FAKE_KEY);
    }
  });
});
