// Tier 0 (lib/context/price.ts): the spot price sentence of a crypto price card.
// The composer, the asset mapping and the row parser are pure; the fetch layer
// runs against a stand-in for Gemini's public candles endpoint.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mentionsOdds, splitSentences } from "../../lib/context/pick";
import {
  FLAT_BELOW_PERCENT,
  PRICE_ABORT_MS,
  PRICE_MEMO_MS,
  PRICE_SOURCE_TITLE,
  PRICE_STALE_MS,
  PRICE_WINDOW_MS,
  composePriceLine,
  formatPrice,
  parseCandles,
  priceAssetFor,
  type Candle,
  type PriceAsset,
} from "../../lib/context/price";

const MINUTE = 60_000;
/** 2026-10-12 00:31:30 UTC; the newest finished minute then opened at 00:30:00. */
const NOW = new Date(1791765090000);
const NEWEST = 1791765000000;

const BTC = priceAssetFor("Crypto", "BTC05M2610112315", "BTC05M")!;
const ETH = priceAssetFor("Crypto", "ETH2610122100", "ETH1H")!;
const SOL = priceAssetFor("Crypto", "SOL15M2610112315", "SOL15M")!;
const XRP = priceAssetFor("Crypto", "XRP2610312100", "XRP")!;

// Rows copied from docs/samples/candles-btcusd-1m.json (2026-10-11): [time_ms, open, high, low, close, volume], newest first.
const REAL_ROWS = [
  [1791765000000, 83747.69, 83752.09, 83721.76, 83721.76, 0.01286206],
  [1791764940000, 83779.93, 83779.93, 83747.69, 83747.69, 0.06097504],
  [1791764880000, 83716.34, 83790.79, 83716.34, 83779.93, 0.36493958],
];

interface Shape {
  /** Minutes of rows, ending at the newest finished minute. */
  minutes?: number;
  /** The close of the row `i` minutes before the newest (0 is the newest). */
  close: (i: number) => number;
  /** How far high and low sit from the close. */
  spread?: number;
  volume?: (i: number) => number | null;
  newest?: number;
}

/** One row per minute, newest first, each opening at the close before it. */
function rows(shape: Shape): Candle[] {
  const minutes = shape.minutes ?? 180;
  const newest = shape.newest ?? NEWEST;
  const spread = shape.spread ?? 0;
  return Array.from({ length: minutes }, (_, i) => {
    const close = shape.close(i);
    const open = shape.close(i + 1);
    return { time: newest - i * MINUTE, open, high: Math.max(open, close) + spread, low: Math.min(open, close) - spread, close, volume: shape.volume ? shape.volume(i) : 1 };
  });
}

/**
 * The clock reads 90 seconds past the newest row's opening, so the past 2 hours
 * hold the rows 0 to 118 and row 119 is the last one before them.
 */
const BEFORE = 119;

/** A straight walk from `from` (the close of the last row before the 2 hours) to `to` (the newest close). */
function walk(from: number, to: number): (i: number) => number {
  return (i) => (i >= BEFORE ? from : to + ((from - to) * i) / BEFORE);
}

function expectOneLine(line: string | null): asserts line is string {
  expect(line).not.toBeNull();
  expect(line!.length).toBeLessThanOrEqual(180);
  expect(splitSentences(line!)).toHaveLength(1);
  expect(line!.endsWith(".")).toBe(true);
  expect(mentionsOdds(line!)).toBe(false);
  expect(line!).not.toMatch(/\u2014|\n|\s{2,}/);
}

describe("priceAssetFor", () => {
  it("maps the tickers and series seen in the Gemini samples", () => {
    const seen: [ticker: string, series: string, code: string][] = [
      ["BTC2610122100", "BTC1H", "BTC"],
      ["BTC2610312100", "BTC", "BTC"],
      ["BTC05M2610112315", "BTC05M", "BTC"],
      ["BTC15M2610112315", "BTC15M", "BTC"],
      ["ETH2610122100", "ETH1H", "ETH"],
      ["ETH05M2610112315", "ETH05M", "ETH"],
      ["SOL2610122100", "SOL1H", "SOL"],
      ["SOL15M2610112315", "SOL15M", "SOL"],
      ["XRP2610122100", "XRP1H", "XRP"],
      ["XRP05M2610112315", "XRP05M", "XRP"],
    ];
    for (const [ticker, series, code] of seen) {
      expect(priceAssetFor("Crypto", ticker, series)?.code).toBe(code);
      expect(priceAssetFor("Crypto", ticker, null)?.code).toBe(code);
      expect(priceAssetFor("Crypto", ticker)?.code).toBe(code);
    }
    expect(BTC).toEqual({ code: "BTC", name: "Bitcoin", symbol: "btcusd" });
    expect(ETH).toEqual({ code: "ETH", name: "Ethereum", symbol: "ethusd" });
    expect(SOL).toEqual({ code: "SOL", name: "Solana", symbol: "solusd" });
    expect(XRP).toEqual({ code: "XRP", name: "XRP", symbol: "xrpusd" });
  });

  it("applies to the Crypto category only", () => {
    for (const category of ["Tech", "Commodities", "Sports", "Other", "", null, undefined]) {
      expect(priceAssetFor(category, "BTC2610122100", "BTC1H")).toBeNull();
    }
    expect(priceAssetFor(" crypto ", "BTC2610122100", "BTC1H")?.code).toBe("BTC");
  });

  it("is null for assets outside the mapping and for tickers that are not a price series", () => {
    expect(priceAssetFor("Crypto", "ZEC2610122100", "ZEC1H")).toBeNull();
    expect(priceAssetFor("Crypto", "HYPE2610120000", "HYPE1H")).toBeNull();
    expect(priceAssetFor("Crypto", "BTC100K2028", null)).toBeNull();
    expect(priceAssetFor("Crypto", "BTCETF2610122100", null)).toBeNull();
    expect(priceAssetFor("Crypto", "BTC", null)).toBeNull();
    expect(priceAssetFor("Crypto", "WXHIGH-AUS-2610120359", "WXHIGH")).toBeNull();
    expect(priceAssetFor("Crypto", "", "")).toBeNull();
  });

  it("is null when the series and the ticker name different assets", () => {
    expect(priceAssetFor("Crypto", "BTC2610122100", "ETH1H")).toBeNull();
    expect(priceAssetFor("Crypto", "BTC2610122100", "SOMETHING")?.code).toBe("BTC");
    expect(priceAssetFor("Crypto", "CRYPTOMIX-2610122100", "SOL1H")?.code).toBe("SOL");
  });

  const samples = ["events-production.json", "events.json"]
    .map((name) => fileURLToPath(new URL(`../../../docs/samples/${name}`, import.meta.url)))
    .filter((path) => existsSync(path));

  it.skipIf(samples.length === 0)("names the same asset as Gemini's own index for every Crypto event in the saved samples", () => {
    const indexCode: Record<string, string> = { XBT: "BTC", ETH: "ETH", SOLN: "SOL", XRP: "XRP" };
    let mapped = 0;
    for (const path of samples) {
      const events = (JSON.parse(readFileSync(path, "utf8")) as { data?: { ticker?: string; series?: string | null; category?: string; sourceDetails?: { index?: string | null } | null }[] }).data ?? [];
      for (const event of events) {
        const asset = priceAssetFor(event.category, event.ticker ?? "", event.series);
        if (event.category !== "Crypto") {
          expect(asset).toBeNull();
          continue;
        }
        // Index names read "LS-LRRR-XBTUSD", "LS-LRRR-SOLNUSD", "LS-LRRR-HYPE22USD".
        const fromIndex = /^LS-LRRR-([A-Z]+?)\d*USD$/.exec(event.sourceDetails?.index ?? "")?.[1] ?? "";
        expect(asset?.code ?? null).toBe(indexCode[fromIndex] ?? null);
        if (asset) mapped++;
      }
    }
    expect(mapped).toBeGreaterThan(0);
  });
});

describe("parseCandles", () => {
  it("reads the observed rows, newest first", () => {
    const candles = parseCandles(REAL_ROWS);
    expect(candles).toHaveLength(3);
    expect(candles[0]).toEqual({ time: 1791765000000, open: 83747.69, high: 83752.09, low: 83721.76, close: 83721.76, volume: 0.01286206 });
    expect(parseCandles([...REAL_ROWS].reverse()).map((c) => c.time)).toEqual(candles.map((c) => c.time));
  });

  it("skips rows that do not have the observed shape", () => {
    const candles = parseCandles([
      REAL_ROWS[0],
      "nope",
      null,
      [],
      [1791764940000, 83779.93, 83779.93],
      [1791764940000, "83779.93", 83779.93, 83747.69, 83747.69, 1],
      [1791764940000, 83779.93, 83779.93, 0, 83747.69, 1],
      [1791764940000, 83779.93, 83700, 83747.69, 83747.69, 1],
      [1791764940000, 83779.93, 83779.93, 83747.69, 90000, 1],
      [Number.NaN, 1, 1, 1, 1, 1],
      [1791764880000, 83716.34, 83790.79, 83716.34, 83779.93],
      [1791764820000, 83716.34, 83790.79, 83716.34, 83779.93, "0.3"],
    ]);
    expect(candles.map((c) => [c.time, c.volume])).toEqual([
      [1791765000000, 0.01286206],
      [1791764880000, null],
      [1791764820000, null],
    ]);
  });

  it("returns nothing for a body that is not a list", () => {
    for (const body of [null, undefined, {}, "Supplied value 'nopeusd' is not a valid symbol", { result: "error", reason: "InvalidParameterValue" }, 5]) {
      expect(parseCandles(body)).toEqual([]);
    }
  });
});

describe("formatPrice", () => {
  it("drops the decimals from $1,000 up", () => {
    expect(formatPrice(83690.4)).toBe("$83,690");
    expect(formatPrice(83721.76)).toBe("$83,722");
    expect(formatPrice(2538.06)).toBe("$2,538");
    expect(formatPrice(1000)).toBe("$1,000");
    expect(formatPrice(1234567.8)).toBe("$1,234,568");
  });

  it("keeps two decimals from $1 to $1,000", () => {
    expect(formatPrice(111.071)).toBe("$111.07");
    expect(formatPrice(1.4076)).toBe("$1.41");
    expect(formatPrice(1)).toBe("$1.00");
    expect(formatPrice(999.5)).toBe("$999.50");
  });

  it("keeps four decimals under $1", () => {
    expect(formatPrice(0.98761)).toBe("$0.9876");
    expect(formatPrice(0.5)).toBe("$0.5000");
    expect(formatPrice(0.00123)).toBe("$0.0012");
  });
});

describe("composePriceLine", () => {
  it("writes the example sentence", () => {
    const candles = rows({ close: walk(83523, 83690), spread: 12 });
    // The high is the newest close plus the spread; the low is the first row's open minus it.
    expect(composePriceLine(BTC, candles, NOW)).toBe("Bitcoin is at $83,690, up 0.2% over the past 2 hours, ranging from $83,511 to $83,702.");
  });

  it("says down, with the size as a positive number", () => {
    const line = composePriceLine(ETH, rows({ close: walk(2570, 2538.06), spread: 1 }), NOW);
    expect(line).toBe("Ethereum is at $2,538, down 1.2% over the past 2 hours, ranging from $2,537 to $2,571.");
    expectOneLine(line);
  });

  it("says flat when the move is under 0.05%", () => {
    expect(FLAT_BELOW_PERCENT).toBe(0.05);
    expect(composePriceLine(SOL, rows({ close: walk(111.1, 111.14), spread: 0.2 }), NOW)).toBe(
      "Solana is at $111.14, flat over the past 2 hours, ranging from $110.90 to $111.34.",
    );
    expect(composePriceLine(SOL, rows({ close: walk(111.14, 111.1), spread: 0.2 }), NOW)).toMatch(/^Solana is at \$111\.10, flat over the past 2 hours, /);
    expect(composePriceLine(SOL, rows({ close: () => 111.1 }), NOW)).toBe("Solana is at $111.10, flat over the past 2 hours.");
    // Just past the line it is a move again, and never "0.0%".
    expect(composePriceLine(SOL, rows({ close: walk(100, 100.06) }), NOW)).toMatch(/, up 0\.1% over the past 2 hours/);
    expect(composePriceLine(SOL, rows({ close: walk(100, 99.94) }), NOW)).toMatch(/, down 0\.1% over the past 2 hours/);
  });

  it("leaves the range out when both ends print the same", () => {
    const line = composePriceLine(XRP, rows({ close: walk(1.4068, 1.4076), spread: 0.0005 }), NOW);
    expect(line).toBe("XRP is at $1.41, up 0.1% over the past 2 hours.");
    expectOneLine(line);
  });

  it("uses four decimals for a price under $1", () => {
    expect(composePriceLine(XRP, rows({ close: walk(0.97, 0.9876), spread: 0.001 }), NOW)).toBe(
      "XRP is at $0.9876, up 1.8% over the past 2 hours, ranging from $0.9690 to $0.9886.",
    );
  });

  it("measures the move from the last close before the 2 hours began", () => {
    // Flat at 100 until a jump to 110 exactly as the 2 hours begin, then flat: the move is the jump.
    const jump = rows({ close: (i) => (i >= BEFORE ? 100 : 110) });
    expect(composePriceLine(BTC, jump, NOW)).toBe("Bitcoin is at $110.00, up 10.0% over the past 2 hours, ranging from $100.00 to $110.00.");
    // Without a row from before, the first open inside the 2 hours stands in.
    const inside = jump.filter((c) => c.time >= NOW.getTime() - PRICE_WINDOW_MS);
    expect(inside.length).toBeLessThan(jump.length);
    expect(composePriceLine(BTC, inside, NOW)).toMatch(/^Bitcoin is at \$110\.00, up 10\.0% over the past 2 hours/);
  });

  it("takes the range from inside the 2 hours only", () => {
    const spike = rows({ close: (i) => (i >= 150 ? 500 : 100) });
    expect(composePriceLine(BTC, spike, NOW)).toBe("Bitcoin is at $100.00, flat over the past 2 hours.");
  });

  it("is null when the newest row is more than 30 minutes old", () => {
    expect(PRICE_STALE_MS).toBe(30 * MINUTE);
    const candles = rows({ close: walk(83523, 83690) });
    expect(composePriceLine(BTC, candles, new Date(NEWEST + 29 * MINUTE))).not.toBeNull();
    expect(composePriceLine(BTC, candles, new Date(NEWEST + 31 * MINUTE))).toBeNull();
    expect(composePriceLine(BTC, candles, new Date(NEWEST + 24 * 60 * MINUTE))).toBeNull();
  });

  it("is null when nothing has traded for 30 minutes, though rows keep coming", () => {
    // A minute without a trade is listed with volume 0 and the last price repeated.
    const quiet = (minutes: number) => rows({ close: (i) => (i < minutes ? 83690 : walk(83523, 83690)(i)), volume: (i) => (i < minutes ? 0 : 1) });
    expect(composePriceLine(BTC, quiet(28), NOW)).not.toBeNull();
    expect(composePriceLine(BTC, quiet(32), NOW)).toBeNull();
    expect(composePriceLine(BTC, rows({ close: () => 83690, volume: () => 0 }), NOW)).toBeNull();
    // Rows without a usable volume count as traded.
    expect(composePriceLine(BTC, rows({ close: walk(83523, 83690), volume: () => null }), NOW)).not.toBeNull();
  });

  it("is null when the rows do not reach back 2 hours", () => {
    const upTo = (minutes: number) => rows({ minutes, close: walk(83523, 83690) });
    expect(composePriceLine(BTC, upTo(110), NOW)).not.toBeNull();
    expect(composePriceLine(BTC, upTo(100), NOW)).toBeNull();
    expect(composePriceLine(BTC, upTo(5), NOW)).toBeNull();
    expect(composePriceLine(BTC, [], NOW)).toBeNull();
    // A gap: one old row and then only the last 10 minutes.
    const gappy = [...upTo(10), ...rows({ minutes: 1, newest: NEWEST - 170 * MINUTE, close: () => 83000 })];
    expect(composePriceLine(BTC, gappy, NOW)).toBeNull();
  });

  it("does not depend on the order of the rows and ignores rows dated in the future", () => {
    const candles = rows({ close: walk(83523, 83690), spread: 12 });
    const expected = composePriceLine(BTC, candles, NOW);
    expect(composePriceLine(BTC, [...candles].reverse(), NOW)).toBe(expected);
    const future: Candle = { time: NEWEST + 60 * MINUTE, open: 1, high: 1, low: 1, close: 1, volume: 1 };
    expect(composePriceLine(BTC, [future, ...candles], NOW)).toBe(expected);
  });

  it("is one plain sentence without odds talk for every asset", () => {
    const shapes: [PriceAsset, number, number][] = [
      [BTC, 83523, 83690],
      [ETH, 2531, 2538.06],
      [SOL, 110.97, 111.07],
      [XRP, 1.4051, 1.407],
    ];
    for (const [asset, from, to] of shapes) {
      const line = composePriceLine(asset, rows({ close: walk(from, to), spread: to / 2000 }), NOW);
      expectOneLine(line);
      expect(line.startsWith(`${asset.name} is at $`)).toBe(true);
      expect(line).toContain(" over the past 2 hours");
    }
  });

  const sample = fileURLToPath(new URL("../../../docs/samples/candles-btcusd-1m.json", import.meta.url));

  it.skipIf(!existsSync(sample))("reads the saved 1m sample", () => {
    const candles = parseCandles(JSON.parse(readFileSync(sample, "utf8")));
    expect(candles.length).toBeGreaterThan(120);
    const line = composePriceLine(BTC, candles, new Date(candles[0]!.time + 90_000));
    expectOneLine(line);
    expect(line).toMatch(/^Bitcoin is at \$[\d,]+, (?:flat|(?:up|down) \d+\.\d%) over the past 2 hours(?:, ranging from \$[\d,]+ to \$[\d,]+)?\.$/);
  });
});

describe("spotLine and priceContext", () => {
  type Price = typeof import("../../lib/context/price");
  let price: Price;
  let calls: { url: string; init: RequestInit | undefined }[];

  function reply(body: unknown, status = 200): Response {
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  }

  /** Rows as the endpoint sends them, ending at the newest finished minute before the (fake) clock. */
  function wire(from: number, to: number): number[][] {
    const newest = Math.floor(Date.now() / MINUTE) * MINUTE - MINUTE;
    return rows({ newest, close: walk(from, to), spread: 12 }).map((c) => [c.time, c.open, c.high, c.low, c.close, c.volume ?? 0]);
  }

  function stub(answer: (url: string, init: RequestInit | undefined) => Promise<Response>): void {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown, init?: RequestInit) => {
        calls.push({ url: String(url), init });
        return answer(String(url), init);
      }),
    );
  }

  beforeEach(async () => {
    vi.useFakeTimers({ now: NOW });
    vi.resetModules(); // a fresh per-asset memory for every test
    price = await import("../../lib/context/price");
    calls = [];
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("answers a crypto price card with the spot sentence, labelled as Gemini spot data", async () => {
    stub(async () => reply(wire(83523, 83690)));

    const context = await price.priceContext("Crypto", "BTC05M2610120115", "BTC05M");

    expect(context).toEqual({
      text: "Bitcoin is at $83,690, up 0.2% over the past 2 hours, ranging from $83,511 to $83,702.",
      sourceTitle: "Gemini spot price, past 2 hours",
      sourceUrl: null,
      sourceDomain: null,
      cached: false,
    });
    expect(PRICE_SOURCE_TITLE).toBe("Gemini spot price, past 2 hours");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://api.gemini.com/v2/candles/btcusd/1m");
    expect(calls[0]!.init?.method).toBe("GET");
    expect(calls[0]!.init?.body).toBeUndefined();
    expect(JSON.stringify(calls[0]!.init?.headers ?? {})).not.toMatch(/authorization|x-gemini/i);
  });

  it("asks for the card's own asset", async () => {
    stub(async () => reply(wire(100, 101)));
    await price.priceContext("Crypto", "ETH2610122100", "ETH1H");
    await price.priceContext("Crypto", "SOL15M2610112315", null);
    await price.priceContext("Crypto", "XRP2610312100", "XRP");
    expect(calls.map((c) => c.url)).toEqual([
      "https://api.gemini.com/v2/candles/ethusd/1m",
      "https://api.gemini.com/v2/candles/solusd/1m",
      "https://api.gemini.com/v2/candles/xrpusd/1m",
    ]);
  });

  it("does not ask at all for another category, an unknown asset or a ticker that is not a price series", async () => {
    stub(async () => reply(wire(83523, 83690)));
    expect(await price.priceContext("Politics", "BTC05M2610120115", "BTC05M")).toBeNull();
    expect(await price.priceContext("Crypto", "ZEC2610122100", "ZEC1H")).toBeNull();
    expect(await price.priceContext("Crypto", "BTC100K2028", null)).toBeNull();
    expect(await price.priceContext(null, "", null)).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("reuses one sentence per asset for 60 seconds, and marks it cached", async () => {
    expect(PRICE_MEMO_MS).toBe(60_000);
    stub(async () => reply(wire(83523, 83690)));

    const first = await price.priceContext("Crypto", "BTC05M2610120115", "BTC05M");
    vi.advanceTimersByTime(59_000);
    const second = await price.priceContext("Crypto", "BTC2610122100", "BTC1H");
    expect(calls).toHaveLength(1);
    expect(first?.cached).toBe(false);
    expect(second).toEqual({ ...first, cached: true });

    // Another asset has its own entry.
    await price.priceContext("Crypto", "ETH2610122100", "ETH1H");
    expect(calls).toHaveLength(2);

    vi.advanceTimersByTime(2_000);
    const third = await price.priceContext("Crypto", "BTC05M2610120115", "BTC05M");
    expect(calls).toHaveLength(3);
    expect(third?.cached).toBe(false);
  });

  it("shares one request between lookups that arrive together", async () => {
    stub(async () => reply(wire(83523, 83690)));
    const [a, b] = await Promise.all([price.spotLine(BTC), price.spotLine(BTC)]);
    expect(calls).toHaveLength(1);
    expect(a?.text).toBe(b?.text);
    expect(a?.text).toMatch(/^Bitcoin is at \$83,690/);
  });

  it("is null, and remembers nothing, on an error status", async () => {
    let status = 400;
    stub(async () => (status === 200 ? reply(wire(83523, 83690)) : reply("Supplied value 'btcusd' is not a valid symbol", status)));
    expect(await price.priceContext("Crypto", "BTC05M2610120115", "BTC05M")).toBeNull();
    status = 500;
    expect(await price.priceContext("Crypto", "BTC05M2610120115", "BTC05M")).toBeNull();
    status = 200;
    expect((await price.priceContext("Crypto", "BTC05M2610120115", "BTC05M"))?.cached).toBe(false);
    expect(calls).toHaveLength(3);
  });

  it("is null on a network failure, a body that is not JSON, and a body without rows", async () => {
    const answers: (() => Promise<Response>)[] = [
      async () => {
        throw new TypeError("fetch failed");
      },
      async () => reply("<html>busy</html>"),
      async () => reply({ result: "error", reason: "InvalidParameterValue" }),
      async () => reply([]),
      async () => reply([["x"], [1, 2]]),
    ];
    for (const answer of answers) {
      stub(answer);
      expect(await price.priceContext("Crypto", "BTC05M2610120115", "BTC05M")).toBeNull();
    }
    expect(calls).toHaveLength(answers.length);
  });

  it("is null on stale data", async () => {
    const old = rows({ newest: NEWEST - 45 * MINUTE, close: walk(83523, 83690) }).map((c) => [c.time, c.open, c.high, c.low, c.close, 1]);
    stub(async () => reply(old));
    expect(await price.priceContext("Crypto", "BTC05M2610120115", "BTC05M")).toBeNull();
  });

  it("gives up after 2.5 seconds", async () => {
    expect(PRICE_ABORT_MS).toBe(2_500);
    stub(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("The operation was aborted.", "AbortError")));
        }),
    );
    let settled: unknown = "pending";
    const pending = price.priceContext("Crypto", "BTC05M2610120115", "BTC05M").then((value) => {
      settled = value;
    });
    await vi.advanceTimersByTimeAsync(2_400);
    expect(settled).toBe("pending");
    await vi.advanceTimersByTimeAsync(200);
    await pending;
    expect(settled).toBeNull();
    expect(calls[0]!.init?.signal?.aborted).toBe(true);
  });

  it("never throws", async () => {
    vi.stubGlobal("fetch", undefined);
    await expect(price.priceContext("Crypto", "BTC05M2610120115", "BTC05M")).resolves.toBeNull();
    await expect(price.spotLine(BTC)).resolves.toBeNull();
  });
});
