/**
 * Hunch API happy path (vitest, real HTTP, real database, real Gemini sandbox).
 *
 * RUNS ONLY WHEN API_BASE_URL IS SET. Without it the whole suite is skipped,
 * so a plain `npm test` (unit tests, no server) still passes.
 *
 *   API_BASE_URL=http://localhost:3000 npm --prefix server test -- tests/api
 *   API_BASE_URL=https://hunch-api.vercel.app npm --prefix server test -- tests/api
 *   (add `--reporter=verbose` to see the time of every step)
 *
 * One sequence, one `it` per step, state shared through the variables inside
 * the describe: health, join (200, 409, 400), feed over every lane (foryou,
 * live, tomorrow, week, later), the Later lane, context (twice; the second
 * answer is cached), swipe, the reveal's percentage sum, repeat swipe, settle,
 * leaderboard, profile, recent call. Every step asserts the status code and the documented shape
 * (docs/ARCHITECTURE.md "API contracts", docs/CONTEXT_DEV.md, lib/types.ts),
 * and every request logs its own duration as "[api happy] METHOD path -> status in N ms".
 *
 * Side effects: one player "qa <timestamp><2 digits>" (the orchestrator
 * deletes "qa %" players after runs; names allow letters, digits and spaces
 * only, so no hyphen); one real $1 sandbox order when a tradable card is dealt
 * and the player is under the daily cap; about two Context.dev credits when
 * the chosen card's context is not cached yet.
 *
 * If every lane is empty the card-dependent steps are skipped (not failed)
 * with a note.
 */
import { describe, expect, it, type TestContext } from "vitest";
import type { CardContext, CardPublic, Lane, LaneFilter, OrderReceipt, PlayerStatus, Reveal } from "../../lib/types";

const BASE_URL = (process.env.API_BASE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
const REQUEST_TIMEOUT_MS = 20_000;

/** Lanes fetched in order; the swipe prefers the first tradable card dealt. */
const LANES: readonly LaneFilter[] = ["foryou", "live", "tomorrow", "week", "later"];
const CARD_LANES: readonly string[] = ["live", "tomorrow", "week", "later"];
const CARD_KEYS = ["category", "eventTicker", "expiresAt", "instrumentSymbol", "lane", "question", "tradable"];
const CONTEXT_KEYS = ["available", "cached", "kind", "sourceDomain", "sourceTitle", "sourceUrl", "text"];
const MAX_FEED_CARDS = 20;
const RECEIPT_STATUSES: readonly string[] = ["filled", "open", "cancelled", "not_placed", "error"];
const RESULTS: readonly string[] = ["pending", "won", "lost"];
const LEVELS: readonly number[] = [1, 2, 3, 4];
const LEVEL_RULE = "Lose your edge, lose the level.";
/** app/api/leaderboard/route.ts returns at most this many rows. */
const LEADERBOARD_LIMIT = 100;

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;
/** Latest expiry a card in each lane may have (SPEC F2 plus the Later lane: beyond 7 days, within a year). */
const LANE_MAX_MS: Record<Lane, number> = {
  live: 60 * MINUTE_MS,
  tomorrow: 48 * HOUR_MS,
  week: WEEK_MS,
  later: 365 * DAY_MS,
};
/** Allowance for the time between the server computing a lane and this check. */
const LANE_SLACK_MS = 5_000;

/** Blocked odds terms from docs/CONTEXT_DEV.md ("Odds filter"): none may appear in context text. */
const BLOCKED_ODDS_TERMS =
  /\b(?:odds|bettors?|sportsbooks?|implied probabilit(?:y|ies)|traders give|kalshi|polymarket|predictit|gemini|draftkings|fanduel|betmgm|caesars)\b/i;
/** Excluded odds domains from docs/CONTEXT_DEV.md: never a context source. */
const EXCLUDED_SOURCE_DOMAINS =
  /(?:^|\.)(?:kalshi\.com|polymarket\.com|gemini\.com|predictit\.org|draftkings\.com|fanduel\.com|betmgm\.com|caesars\.com|oddschecker\.com|covers\.com|actionnetwork\.com|sportsbookreview\.com|oddsshark\.com)$/i;

// ---------- HTTP helper ----------

interface ApiResponse {
  status: number;
  contentType: string;
  text: string;
  json: unknown;
  ms: number;
}

async function call(method: "GET" | "POST", path: string, body?: unknown): Promise<ApiResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const started = Date.now();
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        Accept: "application/json",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const text = await res.text();
    const ms = Date.now() - started;
    console.info(`[api happy] ${method} ${path.replace(/playerId=[^&]+/, "playerId=...")} -> ${res.status} in ${ms} ms`);
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { status: res.status, contentType: res.headers.get("content-type") ?? "", text, json, ms };
  } finally {
    clearTimeout(timer);
  }
}

const enc = encodeURIComponent;

// ---------- Shape helpers ----------

type Obj = Record<string, unknown>;

function isObject(value: unknown): value is Obj {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Asserts the status code and a JSON object body; returns the body. */
function expectJson(res: ApiResponse, status: number): Obj {
  expect(res.status, `expected ${status}, got ${res.status}: ${res.text.slice(0, 300)}`).toBe(status);
  expect(res.contentType, "content-type").toContain("application/json");
  expect(isObject(res.json), `body is not a JSON object: ${res.text.slice(0, 300)}`).toBe(true);
  return res.json as Obj;
}

function expectError(res: ApiResponse, status: number, code: string): void {
  const body = expectJson(res, status);
  expect(body).toEqual({ error: code });
}

function expectPlayerStatus(value: unknown, playerId: string): asserts value is PlayerStatus {
  expect(isObject(value), "status is an object").toBe(true);
  const s = value as Obj;
  expect(s.playerId).toBe(playerId);
  expect(typeof s.name).toBe("string");
  expect(LEVELS, "level").toContain(s.level);
  for (const key of ["dailyCap", "paidUsedToday", "paidLeftToday", "stake"]) {
    expect(typeof s[key], key).toBe("number");
  }
  expect(s.paidLeftToday).toBe(Math.max(0, (s.dailyCap as number) - (s.paidUsedToday as number)));
  // Wallet fields added to the contract on 2026-10-11; checked when the deployed API sends them.
  for (const key of ["balance", "stakePerTrade"]) {
    if (key in s) expect(typeof s[key], key).toBe("number");
  }
}

function expectCard(value: unknown, lane: LaneFilter, now: number): asserts value is CardPublic {
  expect(isObject(value), "card is an object").toBe(true);
  const c = value as Obj;
  for (const key of ["eventTicker", "instrumentSymbol", "question", "category"]) {
    expect(typeof c[key], key).toBe("string");
    expect((c[key] as string).length, `${key} is not empty`).toBeGreaterThan(0);
  }
  expect(CARD_LANES, "lane").toContain(c.lane);
  if (lane !== "foryou") expect(c.lane, `lane filter ${lane}`).toBe(lane);
  expect(typeof c.tradable, "tradable").toBe("boolean");

  expect(typeof c.expiresAt, "expiresAt").toBe("string");
  const expires = new Date(c.expiresAt as string).getTime();
  expect(Number.isNaN(expires), `expiresAt parses: ${String(c.expiresAt)}`).toBe(false);
  expect(expires, `expiresAt is in the future: ${String(c.expiresAt)}`).toBeGreaterThan(now);
  // The lane matches the time left (upper bound only: the clock has moved since the server chose it).
  const cardLane = c.lane as Lane;
  const remaining = expires - now;
  expect(remaining, `${cardLane} card closes inside its window: ${String(c.expiresAt)}`).toBeLessThanOrEqual(LANE_MAX_MS[cardLane] + LANE_SLACK_MS);
  if (cardLane === "later") {
    expect(remaining, `later card closes more than 7 days out: ${String(c.expiresAt)}`).toBeGreaterThan(WEEK_MS - LANE_SLACK_MS);
  }

  // Blind means blind: exactly the seven CardPublic keys, nothing else.
  expect(Object.keys(c).sort(), "card keys").toEqual(CARD_KEYS);
}

function expectReceipt(value: unknown): asserts value is OrderReceipt {
  expect(isObject(value), "receipt is an object").toBe(true);
  const r = value as Obj;
  expect(r.orderId === null || typeof r.orderId === "string", "orderId is a string or null").toBe(true);
  expect(RECEIPT_STATUSES, "receipt.status").toContain(r.status);
  expect(typeof r.symbol, "receipt.symbol").toBe("string");
  expect(typeof r.price, "receipt.price").toBe("number");
  expect(typeof r.contracts, "receipt.contracts").toBe("number");
  if (r.message !== undefined) expect(typeof r.message, "receipt.message").toBe("string");
}

function expectCardContext(value: unknown): asserts value is CardContext {
  expect(isObject(value), "context is an object").toBe(true);
  const x = value as Obj;
  expect(Object.keys(x).sort(), "CardContext keys").toEqual(CONTEXT_KEYS);
  expect(typeof x.available, "available").toBe("boolean");
  expect(typeof x.cached, "cached").toBe("boolean");
  for (const key of ["text", "sourceTitle", "sourceUrl", "sourceDomain"]) {
    expect(x[key] === null || typeof x[key] === "string", `${key} is a string or null`).toBe(true);
  }
  if (x.available) {
    expect(typeof x.text, "available context has text").toBe("string");
    expect((x.text as string).length).toBeGreaterThan(0);
  } else {
    expect(x.text, "unavailable context has no text").toBeNull();
  }
  if (typeof x.text === "string") {
    const hit = x.text.match(BLOCKED_ODDS_TERMS);
    expect(hit, `context text contains the blocked odds term "${hit?.[0] ?? ""}": ${x.text}`).toBeNull();
  }
  if (typeof x.sourceUrl === "string") {
    expect(() => new URL(x.sourceUrl as string), "sourceUrl parses").not.toThrow();
  }
  if (typeof x.sourceDomain === "string") {
    expect(EXCLUDED_SOURCE_DOMAINS.test(x.sourceDomain), `source domain is not an odds site: ${x.sourceDomain}`).toBe(false);
  }
}

function skipNoCard(ctx: TestContext, step: string): never {
  const note = `${step} skipped: no lane (${LANES.join(", ")}) returned a card`;
  console.warn(`[api happy] ${note}`);
  return ctx.skip(note);
}

// ---------- The sequence ----------

describe.skipIf(!process.env.API_BASE_URL)("Hunch API happy path", () => {
  const suffix = Math.floor(Math.random() * 100)
    .toString()
    .padStart(2, "0");
  const name = `qa ${Date.now()}${suffix}`;

  let playerId = "";
  let card: CardPublic | null = null;
  let cardLane: LaneFilter | null = null;
  /** paidLeftToday as the feed reported it, before any swipe. */
  let paidLeftAtFeed = 0;
  let reveal: Reveal | null = null;

  /** One lane of the feed with every documented check applied; returns the cards. */
  async function fetchLane(lane: LaneFilter): Promise<{ cards: CardPublic[]; status: PlayerStatus }> {
    const res = await call("GET", `/api/feed?lane=${lane}&playerId=${enc(playerId)}`);
    const body = expectJson(res, 200);

    // Blind means blind: the raw text carries no price key at all.
    for (const forbidden of ["yesPrice", "noPrice", '"prices"']) {
      expect(res.text, `feed lane=${lane} leaks ${forbidden}`).not.toContain(forbidden);
    }
    expect(Object.keys(body).sort(), "feed keys").toEqual(["cards", "status"]);
    expectPlayerStatus(body.status, playerId);

    expect(Array.isArray(body.cards), "cards is an array").toBe(true);
    const cards = body.cards as unknown[];
    expect(cards.length, "at most 20 cards").toBeLessThanOrEqual(MAX_FEED_CARDS);
    const now = Date.now();
    for (const c of cards) expectCard(c, lane, now);
    const symbols = (cards as CardPublic[]).map((c) => c.instrumentSymbol);
    expect(new Set(symbols).size, "no duplicate instrumentSymbol").toBe(symbols.length);
    return { cards: cards as CardPublic[], status: body.status };
  }

  it("GET / answers with the plain-text health response", async () => {
    const res = await call("GET", "/");
    expect(res.status, res.text.slice(0, 300)).toBe(200);
    expect(res.text).toContain("Hunch API");
  });

  it("POST /api/join creates a player", async () => {
    const res = await call("POST", "/api/join", { name });
    const body = expectJson(res, 200);
    expect(typeof body.playerId).toBe("string");
    expect((body.playerId as string).length).toBeGreaterThan(0);
    expect(body.name).toBe(name);
    expect(Object.keys(body).sort()).toEqual(["name", "playerId"]);
    playerId = body.playerId as string;
    console.info(`[api happy] player ${name} = ${playerId} at ${BASE_URL}`);
  });

  it("POST /api/join with the same name returns 409 name_taken", async () => {
    const res = await call("POST", "/api/join", { name });
    expectError(res, 409, "name_taken");
  });

  it("POST /api/join with a one-letter name returns 400 invalid_name", async () => {
    const res = await call("POST", "/api/join", { name: "a" });
    expectError(res, 400, "invalid_name");
  });

  it(
    "GET /api/feed returns blind cards and the player status for foryou, live, tomorrow, week and later",
    async () => {
      expect(playerId, "join must have run").not.toBe("");
      const counts: string[] = [];
      const dealt: { card: CardPublic; lane: LaneFilter }[] = [];

      for (const lane of LANES) {
        const { cards, status } = await fetchLane(lane);
        if (lane === LANES[0]) paidLeftAtFeed = status.paidLeftToday;
        const tradable = cards.filter((c) => c.tradable).length;
        counts.push(`${lane}=${cards.length} (${tradable} tradable)`);
        for (const c of cards) dealt.push({ card: c, lane });
      }
      console.info(`[api happy] feed cards: ${counts.join(", ")}`);

      // The swipe exercises the real order path when it can: the first tradable card, else the first card.
      const pick = dealt.find((entry) => entry.card.tradable) ?? dealt[0];
      if (pick) {
        card = pick.card;
        cardLane = pick.lane;
        console.info(
          `[api happy] chosen card (${cardLane}, ${card.lane}, tradable=${card.tradable}): ${card.instrumentSymbol} "${card.question}" closes ${card.expiresAt}`,
        );
      } else {
        console.warn("[api happy] every lane is empty; card-dependent steps will be skipped");
      }
    },
    LANES.length * REQUEST_TIMEOUT_MS + 10_000,
  );

  it(
    "GET /api/feed?lane=later deals only cards that close more than 7 days out",
    async (ctx) => {
      const { cards } = await fetchLane("later");
      if (cards.length === 0) {
        const note = "later lane is empty on this API; nothing to check";
        console.warn(`[api happy] ${note}`);
        return ctx.skip(note);
      }
      const now = Date.now();
      let soonest = Number.POSITIVE_INFINITY;
      for (const c of cards) {
        expect(c.lane, `${c.instrumentSymbol} lane`).toBe("later");
        const remaining = new Date(c.expiresAt).getTime() - now;
        expect(remaining, `${c.instrumentSymbol} closes more than 7 days out (${c.expiresAt})`).toBeGreaterThan(WEEK_MS - LANE_SLACK_MS);
        soonest = Math.min(soonest, remaining);
      }
      console.info(`[api happy] later: ${cards.length} cards; the soonest closes in ${(soonest / DAY_MS).toFixed(1)} days`);
    },
    REQUEST_TIMEOUT_MS + 10_000,
  );

  it(
    "GET /api/context returns the CardContext shape without odds, and the second identical call is cached",
    async (ctx) => {
      const chosen = card;
      if (!chosen) return skipNoCard(ctx, "context");
      const path = `/api/context?eventTicker=${enc(chosen.eventTicker)}&instrumentSymbol=${enc(chosen.instrumentSymbol)}&playerId=${enc(playerId)}`;

      const first = expectJson(await call("GET", path), 200);
      expectCardContext(first);
      const second = expectJson(await call("GET", path), 200);
      expectCardContext(second);
      console.info(
        `[api happy] context: first available=${first.available} cached=${first.cached} source=${first.sourceDomain ?? "none"}; ` +
          `second available=${second.available} cached=${second.cached}` +
          (first.text ? `; text="${first.text}"` : ""),
      );

      if (!first.available && !second.available && second.cached !== true) {
        // Nothing was stored: the credit guard refused, the card had no quote, or Context.dev failed.
        const note = `context unavailable for ${chosen.instrumentSymbol} on both calls and nothing cached (credit guard, no quote or Context.dev failure); cache check skipped`;
        console.warn(`[api happy] ${note}`);
        return ctx.skip(note);
      }
      // Always-on context: a web answer (or a cached web miss) is served from the cache on the second call.
      // When the credit guard is on or the key is missing, market rules are rebuilt on each call and are not cached.
      expect(["web", "market"], "kind").toContain(second.kind);
      expect(second.available, "context is always available once the market is found").toBe(true);
      if (second.kind === "web") expect(second.cached, "a web answer is served from the cache on the second call").toBe(true);
      expect(second.available, "cached answer agrees on availability").toBe(first.available);
      // A live price line (kind "market" from the spot feed) can change between calls, so only a web answer must repeat exactly.
      if (second.kind === "web") expect(second.text, "cached answer carries the same text").toBe(first.text);
    },
    2 * REQUEST_TIMEOUT_MS + 10_000,
  );

  it(
    "POST /api/swipe YES on the chosen card returns a Reveal",
    async (ctx) => {
      const chosen = card;
      if (!chosen) return skipNoCard(ctx, "swipe");

      const res = await call("POST", "/api/swipe", {
        playerId,
        eventTicker: chosen.eventTicker,
        instrumentSymbol: chosen.instrumentSymbol,
        side: "yes",
      });
      const body = expectJson(res, 200);

      expect(body.side).toBe("yes");
      for (const key of ["yesPct", "noPct", "sidedWithPct"]) {
        const v = body[key];
        expect(Number.isInteger(v), `${key} is an integer: ${String(v)}`).toBe(true);
        expect(v as number, key).toBeGreaterThanOrEqual(0);
        expect(v as number, key).toBeLessThanOrEqual(100);
      }
      expect(body.sidedWithPct, "sidedWithPct equals yesPct for a YES call").toBe(body.yesPct);

      expect(["paid", "practice"], "mode").toContain(body.mode);
      expect(typeof body.stake, "stake").toBe("number");
      expect(typeof body.contracts, "contracts").toBe("number");
      expect(typeof body.payoutIfRight, "payoutIfRight").toBe("number");
      // Wallet fields added to the contract on 2026-10-11; checked when the deployed API sends them.
      for (const key of ["cost", "balanceAfter"]) {
        if (key in body) expect(typeof body[key], key).toBe("number");
      }
      expectPlayerStatus(body.status, playerId);

      if (body.receipt !== null) expectReceipt(body.receipt);

      if (!chosen.tradable) {
        expect(body.mode, "a card that is not on the sandbox is always practice").toBe("practice");
        expect(body.receipt, "a card that is not on the sandbox places no order").toBeNull();
      } else if (paidLeftAtFeed > 0) {
        expect(body.receipt, "a tradable card under the daily cap always carries a receipt").not.toBeNull();
      }

      if (body.mode === "paid") {
        expect(body.receipt, "a paid swipe carries a receipt").not.toBeNull();
        const receipt = body.receipt as OrderReceipt;
        // F8: paid means wallet-funded. The sandbox order may fill, or cancel for lack of liquidity.
        expect(["filled", "open", "cancelled", "error", "not_placed"], "documented receipt status").toContain(receipt.status);
        if (receipt.status === "filled" || receipt.status === "cancelled" || receipt.status === "open") {
          expect(typeof receipt.orderId, "an accepted order carries a real order id").toBe("string");
          expect((receipt.orderId as string).length).toBeGreaterThan(0);
        }
        expect(receipt.symbol).toBe(chosen.instrumentSymbol);
        expect(receipt.price).toBeGreaterThan(0);
        expect(receipt.price).toBeLessThan(1);
        expect(body.stake as number, "paid stake").toBeGreaterThan(0);
        expect(body.contracts as number, "paid contracts").toBeGreaterThan(0);
        expect(body.payoutIfRight, "payoutIfRight = contracts x $1").toBe(body.contracts);
        expect((body.status as PlayerStatus).paidUsedToday, "a paid swipe counts against today").toBeGreaterThanOrEqual(1);
      } else {
        expect(body.payoutIfRight, "practice pays nothing").toBe(0);
      }

      reveal = body as unknown as Reveal;
      const orderId = reveal.receipt?.orderId ?? "none";
      console.info(
        `[api happy] swipe: mode=${reveal.mode} yes=${reveal.yesPct}% no=${reveal.noPct}% stake=$${reveal.stake} ` +
          `contracts=${reveal.contracts} orderId=${orderId} receipt=${reveal.receipt?.status ?? "null"}` +
          (reveal.receipt?.message ? ` message="${reveal.receipt.message}"` : ""),
      );
    },
    REQUEST_TIMEOUT_MS + 10_000,
  );

  it("the Reveal's yesPct and noPct sum to about 100 (99 to 101)", (ctx) => {
    const seen = reveal;
    if (!seen) return skipNoCard(ctx, "percentage sum check");
    // Both come from buy prices, so a wide bid-ask spread shows up here as a sum well over 100.
    const sum = seen.yesPct + seen.noPct;
    const why = `yesPct ${seen.yesPct} + noPct ${seen.noPct} = ${sum}; the reveal shows two buy prices, not complementary probabilities`;
    expect(sum, why).toBeGreaterThanOrEqual(99);
    expect(sum, why).toBeLessThanOrEqual(101);
  });

  it("POST /api/swipe on the same card again returns 409 already_swiped", async (ctx) => {
    const chosen = card;
    if (!chosen) return skipNoCard(ctx, "repeat swipe");
    const res = await call("POST", "/api/swipe", {
      playerId,
      eventTicker: chosen.eventTicker,
      instrumentSymbol: chosen.instrumentSymbol,
      side: "yes",
    });
    expectError(res, 409, "already_swiped");
  });

  it("POST /api/settle returns a count", async () => {
    const res = await call("POST", "/api/settle");
    const body = expectJson(res, 200);
    expect(Object.keys(body)).toEqual(["settled"]);
    expect(Number.isInteger(body.settled), `settled is an integer: ${String(body.settled)}`).toBe(true);
    expect(body.settled as number).toBeGreaterThanOrEqual(0);
    console.info(`[api happy] settle: ${String(body.settled)} rows`);
  });

  it("GET /api/leaderboard lists the new player and database counters", async (ctx) => {
    const res = await call("GET", "/api/leaderboard");
    const body = expectJson(res, 200);
    expect(Object.keys(body).sort()).toEqual(["counters", "rows"]);

    expect(isObject(body.counters), "counters is an object").toBe(true);
    const counters = body.counters as Obj;
    for (const key of ["players", "calls", "geminiOrders"]) {
      expect(typeof counters[key], `counters.${key}`).toBe("number");
      expect(counters[key] as number, `counters.${key}`).toBeGreaterThanOrEqual(0);
    }
    expect(counters.players as number, "counts the new player").toBeGreaterThanOrEqual(1);
    if (reveal) expect(counters.calls as number, "counts the swipe").toBeGreaterThanOrEqual(1);
    if (reveal?.receipt?.orderId) expect(counters.geminiOrders as number, "counts the order").toBeGreaterThanOrEqual(1);

    expect(Array.isArray(body.rows), "rows is an array").toBe(true);
    const rows = body.rows as Obj[];
    rows.forEach((row, index) => {
      expect(isObject(row), `row ${index}`).toBe(true);
      expect(row.rank, `rank is the position`).toBe(index + 1);
      expect(typeof row.playerId, "playerId").toBe("string");
      expect(typeof row.name, "name").toBe("string");
      expect(typeof row.edgeTotal, "edgeTotal").toBe("number");
      expect(typeof row.settledCalls, "settledCalls").toBe("number");
      expect(LEVELS, "level").toContain(row.level);
      if (index > 0) {
        expect(row.edgeTotal as number, "Edge total descending").toBeLessThanOrEqual(rows[index - 1].edgeTotal as number);
      }
    });

    const mine = rows.find((row) => row.playerId === playerId);
    if (!mine && rows.length >= LEADERBOARD_LIMIT) {
      const note = `leaderboard holds ${rows.length} rows (the route caps at ${LEADERBOARD_LIMIT}); a zero-Edge player can fall off, so the containment check is skipped`;
      console.warn(`[api happy] ${note}`);
      return ctx.skip(note);
    }
    expect(mine, `leaderboard includes ${name} (${playerId})`).toBeDefined();
    expect(mine!.name).toBe(name);
    console.info(`[api happy] leaderboard: rank ${String(mine!.rank)} of ${rows.length}; counters ${JSON.stringify(counters)}`);
  });

  it("GET /api/profile returns the Profile with the level rule", async () => {
    const res = await call("GET", `/api/profile?playerId=${enc(playerId)}`);
    const body = expectJson(res, 200);
    expect(Object.keys(body).sort()).toEqual(["categories", "edgeTotal", "insight", "progress", "recent", "status"]);

    expectPlayerStatus(body.status, playerId);
    expect(typeof body.edgeTotal, "edgeTotal").toBe("number");

    expect(isObject(body.progress), "progress is an object").toBe(true);
    const progress = body.progress as Obj;
    expect(progress.rule).toBe(LEVEL_RULE);
    expect(LEVELS, "progress.level").toContain(progress.level);
    expect([2, 3, 4, null], "progress.nextLevel").toContain(progress.nextLevel);
    expect(typeof progress.settledCalls, "progress.settledCalls").toBe("number");
    expect(typeof progress.avgEdge, "progress.avgEdge").toBe("number");
    expect(progress.callsNeeded === null || typeof progress.callsNeeded === "number", "callsNeeded").toBe(true);
    expect(progress.avgEdgeNeeded === null || typeof progress.avgEdgeNeeded === "number", "avgEdgeNeeded").toBe(true);

    expect(Array.isArray(body.categories), "categories is an array").toBe(true);
    expect(body.insight === null || typeof body.insight === "string", "insight").toBe(true);
    expect(Array.isArray(body.recent), "recent is an array").toBe(true);
    expect((body.recent as unknown[]).length, "recent holds at most 10").toBeLessThanOrEqual(10);
  });

  it("profile.recent includes the swipe and matches the reveal", async (ctx) => {
    const chosen = card;
    const seen = reveal;
    if (!chosen || !seen) return skipNoCard(ctx, "recent call check");

    const res = await call("GET", `/api/profile?playerId=${enc(playerId)}`);
    const body = expectJson(res, 200);
    const recent = body.recent as Obj[];
    const mine = recent.find((r) => isObject(r) && r.instrumentSymbol === chosen.instrumentSymbol);
    expect(mine, `recent includes ${chosen.instrumentSymbol}`).toBeDefined();
    const row = mine!;

    expect(RESULTS, "result").toContain(row.result);
    expect(row.side).toBe("yes");
    expect(row.question).toBe(chosen.question);
    expect(row.mode, "mode matches the reveal").toBe(seen.mode);
    expect(row.orderId, "orderId matches the receipt").toBe(seen.receipt?.orderId ?? null);
    expect(row.contracts, "contracts match the reveal").toBe(seen.contracts);
    expect(typeof row.price, "price").toBe("number");
    expect(row.price as number).toBeGreaterThan(0);
    expect(row.price as number).toBeLessThan(1);
    // The stored price is the raw buy price of the chosen side. sidedWithPct is normalized so YES and NO sum to 100,
    // so the two differ by the spread. When a receipt exists, its price is the same raw price.
    if (reveal?.receipt) expect(row.price as number, "stored price is the receipt price").toBeCloseTo(reveal.receipt.price, 2);

    if (row.result === "pending") {
      expect(row.edge, "pending has no edge").toBeNull();
      expect(row.payout, "pending has no payout").toBeNull();
      expect(row.settledAt, "pending has no settledAt").toBeNull();
    } else {
      expect(typeof row.edge, "settled edge").toBe("number");
      expect(typeof row.payout, "settled payout").toBe("number");
      expect(typeof row.settledAt, "settled settledAt").toBe("string");
    }
    console.info(`[api happy] recent: ${chosen.instrumentSymbol} result=${String(row.result)} mode=${String(row.mode)}`);
  });
});
