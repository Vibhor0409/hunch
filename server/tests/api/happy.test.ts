/**
 * Hunch API happy path (vitest, real HTTP, real database, real Gemini sandbox).
 *
 * RUNS ONLY WHEN API_BASE_URL IS SET. Without it the whole suite is skipped,
 * so a plain `npm test` (unit tests, no server) still passes.
 *
 *   API_BASE_URL=http://localhost:3000 npm --prefix server test -- tests/api
 *   API_BASE_URL=https://<deployed-api> npm --prefix server test -- tests/api
 *
 * One sequence, one `it` per step, state shared through the variables inside
 * the describe: health, join (200, 409, 400), feed, swipe, repeat swipe,
 * settle, leaderboard, profile. Every step asserts the status code and the
 * documented shape (docs/ARCHITECTURE.md "API contracts", lib/types.ts).
 *
 * Side effects: creates one player named "qa <timestamp><2 digits>" and, when
 * the feed has a card, places one real $1 sandbox order for it (or a practice
 * swipe once the daily cap is used up). Names allow letters, digits and spaces
 * only, so the name uses a space rather than a hyphen.
 *
 * If every lane is empty the swipe steps are skipped (not failed) with a note.
 */
import { describe, expect, it, type TestContext } from "vitest";
import type { CardPublic, LaneFilter, OrderReceipt, PlayerStatus, Reveal } from "../../lib/types";

const BASE_URL = (process.env.API_BASE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
const REQUEST_TIMEOUT_MS = 20_000;

/** Lanes tried in order until one returns a card. */
const LANES: readonly LaneFilter[] = ["foryou", "live", "tomorrow", "week"];
const CARD_LANES: readonly string[] = ["live", "tomorrow", "week"];
const CARD_KEYS = ["category", "eventTicker", "expiresAt", "instrumentSymbol", "lane", "question"];
const MAX_FEED_CARDS = 20;
const RECEIPT_STATUSES: readonly string[] = ["filled", "open", "cancelled", "not_placed", "error"];
const RESULTS: readonly string[] = ["pending", "won", "lost"];
const LEVELS: readonly number[] = [1, 2, 3, 4];
const LEVEL_RULE = "Lose your edge, lose the level.";
/** app/api/leaderboard/route.ts returns at most this many rows. */
const LEADERBOARD_LIMIT = 100;

// ---------- HTTP helper ----------

interface ApiResponse {
  status: number;
  contentType: string;
  text: string;
  json: unknown;
}

async function call(method: "GET" | "POST", path: string, body?: unknown): Promise<ApiResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
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
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { status: res.status, contentType: res.headers.get("content-type") ?? "", text, json };
  } finally {
    clearTimeout(timer);
  }
}

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
  expect(typeof c.expiresAt, "expiresAt").toBe("string");
  const expires = new Date(c.expiresAt as string).getTime();
  expect(Number.isNaN(expires), `expiresAt parses: ${String(c.expiresAt)}`).toBe(false);
  expect(expires, `expiresAt is in the future: ${String(c.expiresAt)}`).toBeGreaterThan(now);
  // Blind means blind: exactly the six CardPublic keys, nothing else.
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
  let reveal: Reveal | null = null;

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
    "GET /api/feed returns blind cards and the player status (foryou, then live, tomorrow, week)",
    async () => {
      expect(playerId, "join must have run").not.toBe("");
      const counts: string[] = [];

      for (const lane of LANES) {
        const res = await call("GET", `/api/feed?lane=${lane}&playerId=${encodeURIComponent(playerId)}`);
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

        counts.push(`${lane}=${cards.length}`);
        if (card === null && cards.length > 0) {
          card = cards[0] as CardPublic;
          cardLane = lane;
        }
      }

      console.info(`[api happy] feed cards: ${counts.join(" ")}`);
      if (card) {
        console.info(`[api happy] first card (${cardLane}): ${card.instrumentSymbol} "${card.question}" closes ${card.expiresAt}`);
      } else {
        console.warn("[api happy] every lane is empty; swipe steps will be skipped");
      }
    },
    LANES.length * REQUEST_TIMEOUT_MS + 10_000,
  );

  it(
    "POST /api/swipe YES on the first card returns a Reveal",
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
      const sum = (body.yesPct as number) + (body.noPct as number);
      expect(sum, `yesPct + noPct = ${sum} (buy-side spread wider than 1 point?)`).toBeGreaterThanOrEqual(99);
      expect(sum, `yesPct + noPct = ${sum} (buy-side spread wider than 1 point?)`).toBeLessThanOrEqual(101);
      expect(body.sidedWithPct, "sidedWithPct equals yesPct for a YES call").toBe(body.yesPct);

      expect(["paid", "practice"], "mode").toContain(body.mode);
      expect(typeof body.stake, "stake").toBe("number");
      expect(typeof body.contracts, "contracts").toBe("number");
      expect(typeof body.payoutIfRight, "payoutIfRight").toBe("number");
      expectPlayerStatus(body.status, playerId);

      if (body.receipt !== null) expectReceipt(body.receipt);

      if (body.mode === "paid") {
        expect(body.receipt, "a paid swipe carries a receipt").not.toBeNull();
        const receipt = body.receipt as OrderReceipt;
        expect(receipt.status, "paid means filled").toBe("filled");
        expect(typeof receipt.orderId, "paid means a real order id").toBe("string");
        expect((receipt.orderId as string).length).toBeGreaterThan(0);
        expect(receipt.symbol).toBe(chosen.instrumentSymbol);
        expect(receipt.price).toBeGreaterThan(0);
        expect(receipt.price).toBeLessThan(1);
        expect(body.stake as number, "paid stake").toBeGreaterThan(0);
        expect(body.contracts as number, "paid contracts").toBeGreaterThan(0);
        expect(body.payoutIfRight, "payoutIfRight = contracts x $1").toBe(body.contracts);
      } else {
        expect(body.payoutIfRight, "practice pays nothing").toBe(0);
      }

      reveal = body as unknown as Reveal;
      const orderId = reveal.receipt?.orderId ?? "none";
      console.info(
        `[api happy] swipe: mode=${reveal.mode} yes=${reveal.yesPct}% no=${reveal.noPct}% stake=$${reveal.stake} ` +
          `contracts=${reveal.contracts} orderId=${orderId} receipt=${reveal.receipt?.status ?? "null"}`,
      );
    },
    REQUEST_TIMEOUT_MS + 10_000,
  );

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
    const res = await call("GET", `/api/profile?playerId=${encodeURIComponent(playerId)}`);
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

    const res = await call("GET", `/api/profile?playerId=${encodeURIComponent(playerId)}`);
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
    expect(Math.round((row.price as number) * 100), "stored price agrees with sidedWithPct").toBe(seen.sidedWithPct);

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
