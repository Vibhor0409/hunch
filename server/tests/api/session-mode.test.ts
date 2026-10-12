/**
 * Hunch API session mode: the optional `mode` field of POST /api/swipe
 * (vitest, real HTTP, real database, real Gemini quotes).
 *
 * The HTTP sequence RUNS ONLY WHEN API_BASE_URL IS SET, like happy.test.ts:
 *
 *   API_BASE_URL=http://localhost:3100 npm --prefix server test -- tests/api
 *
 * The small pure block at the top (sessionModeOf) always runs, so a plain
 * `npm test` still proves that a missing, null or unknown `mode` means "live".
 *
 * Sequence, one `it` per step: join; read the wallet; deal three cards; swipe
 * one with mode "practice" (practice, cost 0, not_placed receipt with the
 * practice-session message, wallet untouched, no new transaction); swipe one
 * with mode "live" (paid, cost above 0, balance down by the cost); swipe one
 * with no `mode` field (behaves like live); read the stored rows back through
 * the profile. Every request logs "[api mode] METHOD path -> status in N ms".
 *
 * Side effects: one player "qa mode <unix seconds><2 digits>" (names allow at
 * most 20 letters, digits and spaces; delete "qa %" players after runs), three
 * swipes and two wallet transactions. The practice swipe prefers a tradable
 * card, because that is where "no order placed" means something. The two live
 * swipes prefer cards that are not on the sandbox, so the run normally places
 * no sandbox order; when only tradable cards are dealt, each live swipe places
 * one real $1 sandbox order.
 *
 * If the feed deals fewer than three usable cards, the swipe steps are skipped
 * (not failed) with a note.
 */
import { describe, expect, it, type TestContext } from "vitest";
import { sessionModeOf } from "../../app/api/_lib/validate";
import type { CardPublic, LaneFilter, PlayerStatus, Profile, Reveal, Wallet } from "../../lib/types";

const BASE_URL = (process.env.API_BASE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
const REQUEST_TIMEOUT_MS = 20_000;
/** Message of the not_placed receipt on a practice-session swipe (app/api/swipe/route.ts). */
const PRACTICE_SESSION_MESSAGE = "Practice session. Scores Edge only.";
/** Lanes read to collect cards; long-dated lanes first, they do not close mid-test. */
const LANES: readonly LaneFilter[] = ["later", "week", "tomorrow", "live", "foryou"];
/** Cards closing sooner than this are left out, so a swipe does not race the close. */
const MIN_TIME_LEFT_MS = 3 * 60_000;
/** Cards tried for one swipe before giving up; a 410 (closed since the feed) moves on to the next. */
const MAX_ATTEMPTS = 5;

// ---------- Pure: always runs ----------

describe("sessionModeOf", () => {
  it('selects a practice session only for the exact string "practice"', () => {
    expect(sessionModeOf("practice")).toBe("practice");
  });

  it('reads "live", a missing field and null as live', () => {
    expect(sessionModeOf("live")).toBe("live");
    expect(sessionModeOf(undefined)).toBe("live");
    expect(sessionModeOf(null)).toBe("live");
  });

  it("reads any other value as live, so an unknown mode can never change behavior", () => {
    for (const value of ["", "Practice", "PRACTICE", " practice", "paid", "demo", 0, 1, true, false, {}, [], ["practice"]]) {
      expect(sessionModeOf(value), JSON.stringify(value)).toBe("live");
    }
  });
});

// ---------- HTTP helper ----------

interface ApiResponse {
  status: number;
  text: string;
  json: unknown;
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
    console.info(`[api mode] ${method} ${path.replace(/playerId=[^&]+/, "playerId=...")} -> ${res.status} in ${Date.now() - started} ms`);
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { status: res.status, text, json };
  } finally {
    clearTimeout(timer);
  }
}

type Obj = Record<string, unknown>;

function isObject(value: unknown): value is Obj {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Asserts the status code and a JSON object body; returns the body. */
function expectJson(res: ApiResponse, status: number): Obj {
  expect(res.status, `expected ${status}, got ${res.status}: ${res.text.slice(0, 300)}`).toBe(status);
  expect(isObject(res.json), `body is not a JSON object: ${res.text.slice(0, 300)}`).toBe(true);
  return res.json as Obj;
}

const enc = encodeURIComponent;

// ---------- The sequence ----------

describe.skipIf(!process.env.API_BASE_URL)("Hunch API session mode (practice / live)", () => {
  const suffix = Math.floor(Math.random() * 100)
    .toString()
    .padStart(2, "0");
  // "qa mode " + 10 digits of unix seconds + 2 random digits = 20 characters, the name limit.
  const name = `qa mode ${Math.floor(Date.now() / 1000)}${suffix}`;

  let playerId = "";
  /** Cards not swiped yet, in the order the feed dealt them. */
  let pool: CardPublic[] = [];
  /** The card behind each swipe, for the stored-row check at the end. */
  const swiped: { card: CardPublic; mode: "practice" | "paid" }[] = [];

  async function readWallet(): Promise<Wallet> {
    const res = await call("GET", `/api/wallet?playerId=${enc(playerId)}`);
    const body = expectJson(res, 200);
    expect(typeof body.balance, "wallet.balance").toBe("number");
    expect(Array.isArray(body.transactions), "wallet.transactions is an array").toBe(true);
    return body as unknown as Wallet;
  }

  async function readStatus(): Promise<PlayerStatus> {
    const res = await call("GET", `/api/profile?playerId=${enc(playerId)}`);
    const body = expectJson(res, 200);
    return (body as unknown as Profile).status;
  }

  /**
   * Swipes YES on the first card in the pool that is still open, preferring
   * tradable or non-tradable cards as asked. `mode` is sent only when given,
   * so `undefined` exercises a body without the field. A card that closed
   * since the feed (410, nothing stored) is dropped and the next one tried.
   * Returns null when no usable card is left.
   */
  async function swipeNext(
    prefer: "tradable" | "notTradable",
    mode: "practice" | "live" | undefined,
  ): Promise<{ card: CardPublic; reveal: Reveal } | null> {
    const wantTradable = prefer === "tradable";
    const ordered = [...pool.filter((c) => c.tradable === wantTradable), ...pool.filter((c) => c.tradable !== wantTradable)];
    for (const card of ordered.slice(0, MAX_ATTEMPTS)) {
      pool = pool.filter((c) => c.instrumentSymbol !== card.instrumentSymbol);
      const res = await call("POST", "/api/swipe", {
        playerId,
        eventTicker: card.eventTicker,
        instrumentSymbol: card.instrumentSymbol,
        side: "yes",
        ...(mode !== undefined ? { mode } : {}),
      });
      if (res.status === 410) {
        console.warn(`[api mode] ${card.instrumentSymbol} closed since the feed; trying the next card`);
        continue;
      }
      const body = expectJson(res, 200);
      return { card, reveal: body as unknown as Reveal };
    }
    return null;
  }

  function skipNoCard(ctx: TestContext, step: string): never {
    const note = `${step} skipped: the feed has no usable card left (lanes ${LANES.join(", ")})`;
    console.warn(`[api mode] ${note}`);
    return ctx.skip(note);
  }

  /** A live swipe: wallet-funded, cost above 0, balance down by exactly the cost, one new stake transaction. */
  async function expectLiveSwipe(ctx: TestContext, step: string, mode: "live" | undefined): Promise<void> {
    expect(playerId, "join must have run").not.toBe("");
    const before = await readWallet();
    const statusBefore = await readStatus();
    expect(statusBefore.paidLeftToday, "the fresh player is under the daily cap").toBeGreaterThan(0);
    expect(before.balance, "the wallet covers the amount per trade").toBeGreaterThanOrEqual(before.stakePerTrade);

    const result = await swipeNext("notTradable", mode);
    if (!result) return skipNoCard(ctx, step);
    const { card, reveal } = result;

    expect(reveal.mode, "a live session swipe under the cap with balance is paid").toBe("paid");
    expect(reveal.cost, "cost").toBeGreaterThan(0);
    expect(reveal.cost, "cost never exceeds the amount per trade").toBeLessThanOrEqual(before.stakePerTrade + 0.005);
    expect(reveal.contracts, "contracts").toBeGreaterThan(0);
    expect(reveal.payoutIfRight, "payoutIfRight = contracts x $1").toBe(reveal.contracts);
    expect(reveal.balanceAfter, "balanceAfter = balance before minus the cost").toBeCloseTo(before.balance - reveal.cost, 2);
    expect(reveal.status.balance, "status carries the new balance").toBe(reveal.balanceAfter);
    expect(reveal.status.paidUsedToday, "a paid swipe counts against today").toBe(statusBefore.paidUsedToday + 1);
    expect(reveal.receipt?.message, "a live swipe is not labelled as a practice session").not.toBe(PRACTICE_SESSION_MESSAGE);
    if (!card.tradable) expect(reveal.receipt, "a card that is not on the sandbox places no order").toBeNull();

    const after = await readWallet();
    expect(after.balance, "wallet balance is down by the cost").toBeCloseTo(before.balance - reveal.cost, 2);
    expect(after.transactions.length, "exactly one new wallet transaction").toBe(before.transactions.length + 1);
    const tx = after.transactions[0];
    expect(tx.kind, "the newest transaction is the stake").toBe("stake");
    expect(tx.amount, "the stake is the negative cost").toBeCloseTo(-reveal.cost, 2);
    expect(tx.balanceAfter, "the stake row carries the new balance").toBeCloseTo(after.balance, 2);

    swiped.push({ card, mode: "paid" });
    console.info(
      `[api mode] ${step}: mode=${reveal.mode} cost=$${reveal.cost} balance ${before.balance} -> ${after.balance} ` +
        `tradable=${card.tradable} receipt=${reveal.receipt?.status ?? "null"} card=${card.instrumentSymbol}`,
    );
  }

  it("POST /api/join creates the player", async () => {
    const res = await call("POST", "/api/join", { name });
    const body = expectJson(res, 200);
    expect(typeof body.playerId).toBe("string");
    expect(body.name).toBe(name);
    playerId = body.playerId as string;
    console.info(`[api mode] player ${name} = ${playerId} at ${BASE_URL}`);
  });

  it("GET /api/wallet shows a fresh wallet with no transactions", async () => {
    expect(playerId, "join must have run").not.toBe("");
    const wallet = await readWallet();
    expect(wallet.balance, "starting balance").toBe(wallet.startingBalance);
    expect(wallet.balance).toBeGreaterThan(0);
    expect(wallet.stakePerTrade, "default amount per trade").toBeGreaterThanOrEqual(1);
    expect(wallet.transactions).toEqual([]);
  });

  it(
    "GET /api/feed deals at least three cards to swipe",
    async (ctx) => {
      expect(playerId, "join must have run").not.toBe("");
      const seen = new Set<string>();
      const now = Date.now();
      for (const lane of LANES) {
        const res = await call("GET", `/api/feed?lane=${lane}&playerId=${enc(playerId)}`);
        const body = expectJson(res, 200);
        expect(Array.isArray(body.cards), `feed lane=${lane} cards is an array`).toBe(true);
        for (const card of body.cards as CardPublic[]) {
          if (seen.has(card.instrumentSymbol)) continue;
          if (!(new Date(card.expiresAt).getTime() - now > MIN_TIME_LEFT_MS)) continue;
          seen.add(card.instrumentSymbol);
          pool.push(card);
        }
      }
      const tradable = pool.filter((c) => c.tradable).length;
      console.info(`[api mode] ${pool.length} usable cards dealt (${tradable} tradable, ${pool.length - tradable} not)`);
      if (pool.length < 3) {
        const note = `only ${pool.length} usable card(s) dealt; the swipe steps need three`;
        console.warn(`[api mode] ${note}`);
        pool = [];
        return ctx.skip(note);
      }
    },
    LANES.length * REQUEST_TIMEOUT_MS + 10_000,
  );

  it(
    'POST /api/swipe with mode "practice" is a practice swipe that leaves the wallet alone',
    async (ctx) => {
      expect(playerId, "join must have run").not.toBe("");
      const before = await readWallet();
      const statusBefore = await readStatus();
      // The point of the toggle: this player could have paid (under the cap, funded) and still does not.
      expect(statusBefore.paidLeftToday, "the fresh player is under the daily cap").toBeGreaterThan(0);
      expect(before.balance, "the wallet covers the amount per trade").toBeGreaterThanOrEqual(before.stakePerTrade);

      const result = await swipeNext("tradable", "practice");
      if (!result) return skipNoCard(ctx, "practice swipe");
      const { card, reveal } = result;

      expect(reveal.side).toBe("yes");
      expect(reveal.mode, "mode").toBe("practice");
      expect(reveal.cost, "cost").toBe(0);
      expect(reveal.stake, "stake").toBe(0);
      expect(reveal.contracts, "contracts").toBe(0);
      expect(reveal.payoutIfRight, "payoutIfRight").toBe(0);
      expect(reveal.balanceAfter, "balanceAfter equals the balance before").toBe(before.balance);

      expect(reveal.receipt, "a practice-session swipe carries the reason as a receipt").not.toBeNull();
      expect(reveal.receipt?.status, "receipt.status").toBe("not_placed");
      expect(reveal.receipt?.orderId, "no order was placed").toBeNull();
      expect(reveal.receipt?.message, "receipt.message").toBe(PRACTICE_SESSION_MESSAGE);
      expect(reveal.receipt?.symbol).toBe(card.instrumentSymbol);
      expect(reveal.receipt?.contracts).toBe(0);

      // The quote and the percentages are untouched by the session mode.
      for (const pct of [reveal.yesPct, reveal.noPct, reveal.sidedWithPct]) {
        expect(Number.isInteger(pct), `percentage is an integer: ${String(pct)}`).toBe(true);
        expect(pct).toBeGreaterThanOrEqual(0);
        expect(pct).toBeLessThanOrEqual(100);
      }
      expect(reveal.yesPct + reveal.noPct, "yesPct + noPct").toBe(100);
      expect(reveal.sidedWithPct, "sidedWithPct equals yesPct for a YES call").toBe(reveal.yesPct);

      expect(reveal.status.balance, "status.balance is unchanged").toBe(before.balance);
      expect(reveal.status.paidUsedToday, "a practice swipe does not count against today").toBe(statusBefore.paidUsedToday);
      expect(reveal.status.paidLeftToday, "paid swipes left today are unchanged").toBe(statusBefore.paidLeftToday);

      const after = await readWallet();
      expect(after.balance, "wallet balance is unchanged").toBe(before.balance);
      expect(after.transactions.length, "no new wallet transaction").toBe(before.transactions.length);

      swiped.push({ card, mode: "practice" });
      console.info(
        `[api mode] practice swipe: mode=${reveal.mode} cost=$${reveal.cost} balance ${before.balance} -> ${after.balance} ` +
          `tradable=${card.tradable} receipt=${reveal.receipt?.status ?? "null"} message="${reveal.receipt?.message ?? ""}" card=${card.instrumentSymbol}`,
      );
    },
    MAX_ATTEMPTS * REQUEST_TIMEOUT_MS + 3 * REQUEST_TIMEOUT_MS,
  );

  it(
    'POST /api/swipe with mode "live" is paid and debits the cost',
    async (ctx) => {
      await expectLiveSwipe(ctx, "live swipe", "live");
    },
    MAX_ATTEMPTS * REQUEST_TIMEOUT_MS + 3 * REQUEST_TIMEOUT_MS,
  );

  it(
    "POST /api/swipe with no mode field behaves like live",
    async (ctx) => {
      await expectLiveSwipe(ctx, "default swipe (no mode field)", undefined);
    },
    MAX_ATTEMPTS * REQUEST_TIMEOUT_MS + 3 * REQUEST_TIMEOUT_MS,
  );

  it("GET /api/profile shows each swipe stored with its mode", async (ctx) => {
    if (swiped.length === 0) return skipNoCard(ctx, "stored rows");
    const res = await call("GET", `/api/profile?playerId=${enc(playerId)}`);
    const profile = expectJson(res, 200) as unknown as Profile;
    for (const { card, mode } of swiped) {
      const row = profile.recent.find((recent) => recent.instrumentSymbol === card.instrumentSymbol);
      expect(row, `recent call for ${card.instrumentSymbol}`).toBeDefined();
      expect(row?.mode, `stored mode of ${card.instrumentSymbol}`).toBe(mode);
      if (mode === "practice") {
        expect(row?.contracts, "a practice row holds no contracts").toBe(0);
        expect(row?.orderId, "a practice row has no order id").toBeNull();
      } else {
        expect(row?.contracts, "a paid row holds contracts").toBeGreaterThan(0);
      }
    }
    const paid = swiped.filter((s) => s.mode === "paid").length;
    expect(profile.status.paidUsedToday, "only the paid swipes count against today").toBe(paid);
  });
});
