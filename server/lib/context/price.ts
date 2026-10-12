// Tier 0, crypto price cards only: one sentence on what the asset's spot price
// has done over the past 2 hours. No credits, no database, and silent on any
// failure: priceContext answers null and the existing tiers run unchanged.
//
// Source: Gemini's public spot candles, no auth.
//   GET https://api.gemini.com/v2/candles/{symbol}/1m
// Observed 2026-10-11 (docs/samples/candles-btcusd-1m.json): a JSON array of
// [time_ms, open, high, low, close, volume], all numbers, newest first, one
// row per minute for the last 24 hours (1,439 rows). `time_ms` is the minute's
// opening time. A minute without a trade is still listed, with volume 0 and all
// four prices equal to the last close. The newest row is the last finished
// minute, so it is one to two minutes old. The 5m and 15m frames answer in the
// same shape but their newest row is 5 to 15 minutes old, so 1m is used. A bad
// symbol answers HTTP 400 with a plain text body.
//
// Assets: the four that docs/samples/events-production.json lists under Crypto
// (BTC, ETH, SOL, XRP), each checked to return candles. Their event tickers are
// the code, an optional interval and a date stamp ("BTC2610122100",
// "BTC05M2610112315"), and their series the code and an optional interval
// ("BTC", "BTC1H", "BTC05M", "BTC15M").

export const PRICE_SOURCE_TITLE = "Gemini spot price, past 2 hours";
/** The stretch the sentence covers. */
export const PRICE_WINDOW_MS = 2 * 60 * 60 * 1000;
/** No trade for this long means the price is too old to state as current. */
export const PRICE_STALE_MS = 30 * 60 * 1000;
/** Below this absolute move, in percent, the price is called flat. */
export const FLAT_BELOW_PERCENT = 0.05;
/** The candles request is aborted after this long. */
export const PRICE_ABORT_MS = 2_500;
/** One sentence per asset is reused on this instance for this long. */
export const PRICE_MEMO_MS = 60_000;

const CANDLES_URL = "https://api.gemini.com/v2/candles";
const TIME_FRAME = "1m";
/** A row dated later than this past the clock is not trusted. */
const CLOCK_SLACK_MS = 2 * 60 * 1000;
/** The rows inside the 2 hours must begin within this long of their start, or they do not speak for all of it. */
const MAX_LATE_START_MS = 15 * 60 * 1000;

export interface PriceAsset {
  code: "BTC" | "ETH" | "SOL" | "XRP";
  /** The name the sentence uses. */
  name: string;
  /** The Gemini spot symbol of the candles endpoint. */
  symbol: string;
}

const ASSETS: Readonly<Record<PriceAsset["code"], PriceAsset>> = {
  BTC: { code: "BTC", name: "Bitcoin", symbol: "btcusd" },
  ETH: { code: "ETH", name: "Ethereum", symbol: "ethusd" },
  SOL: { code: "SOL", name: "Solana", symbol: "solusd" },
  XRP: { code: "XRP", name: "XRP", symbol: "xrpusd" },
};

/** An asset code with the optional interval seen in tickers and series: "BTC", "BTC1H", "BTC05M", "BTC15M". */
const ASSET_CODE = /^(BTC|ETH|SOL|XRP)(?:\d{1,2}[MH])?$/;

function assetOf(code: string | null | undefined): PriceAsset | null {
  const match = ASSET_CODE.exec((code ?? "").trim());
  return match ? ASSETS[match[1] as PriceAsset["code"]] : null;
}

/**
 * The asset a card is about, or null. Only for the Crypto category, and only
 * when the series or the event ticker (without its date stamp) is an asset
 * code. When both name an asset they must agree.
 */
export function priceAssetFor(category: string | null | undefined, eventTicker: string, series?: string | null): PriceAsset | null {
  if ((category ?? "").trim().toLowerCase() !== "crypto") return null;
  const fromSeries = assetOf(series);
  const stem = eventTicker.trim().replace(/\d{6,}$/, "");
  const fromTicker = stem !== eventTicker.trim() ? assetOf(stem) : null;
  if (fromSeries && fromTicker && fromSeries.code !== fromTicker.code) return null;
  return fromSeries ?? fromTicker;
}

// ---------- Candles ----------

export interface Candle {
  /** Opening time of the minute, epoch ms. */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  /** Null when the row carries no usable volume. */
  volume: number | null;
}

function positive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/** The rows of a candles response that have the observed shape, newest first. Anything else is skipped. */
export function parseCandles(body: unknown): Candle[] {
  if (!Array.isArray(body)) return [];
  const candles: Candle[] = [];
  for (const row of body) {
    if (!Array.isArray(row) || row.length < 5) continue;
    const [time, open, high, low, close, volume] = row as unknown[];
    if (!positive(time) || !positive(open) || !positive(high) || !positive(low) || !positive(close)) continue;
    if (low > high || close > high || close < low) continue;
    candles.push({ time, open, high, low, close, volume: typeof volume === "number" && Number.isFinite(volume) && volume >= 0 ? volume : null });
  }
  return candles.sort((a, b) => b.time - a.time);
}

// ---------- The sentence ----------

const WHOLE = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const CENTS = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const FINE = new Intl.NumberFormat("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 });

/** "$83,690" from $1,000 up, "$111.07" from $1, "$0.4076" below. */
export function formatPrice(value: number): string {
  const format = value >= 1000 ? WHOLE : value >= 1 ? CENTS : FINE;
  return `$${format.format(value)}`;
}

/**
 * One sentence on the past 2 hours, or null when the rows cannot back one:
 * none at all, no trade in the last 30 minutes, or less than 2 hours covered.
 * - The price is the newest close.
 * - The move is from the last close before the 2 hours began (else the first
 *   open inside them) to the newest close; under 0.05% it reads "flat".
 * - The range is the lowest low and the highest high inside the 2 hours, left
 *   out when both print the same.
 * Example: "Bitcoin is at $83,690, up 0.2% over the past 2 hours, ranging from $83,511 to $83,702."
 */
export function composePriceLine(asset: PriceAsset, candles: readonly Candle[], now: Date): string | null {
  const nowMs = now.getTime();
  const rows = [...candles].filter((c) => c.time <= nowMs + CLOCK_SLACK_MS).sort((a, b) => b.time - a.time);
  const newest = rows[0];
  if (!newest) return null;

  // Rows without a trade repeat the last price, so freshness is the newest row that traded.
  const traded = rows.find((c) => c.volume === null || c.volume > 0);
  if (!traded || nowMs - traded.time > PRICE_STALE_MS) return null;

  const start = nowMs - PRICE_WINDOW_MS;
  const inside = rows.filter((c) => c.time >= start);
  const before = rows.find((c) => c.time < start);
  const oldest = inside[inside.length - 1];
  if (!oldest || oldest.time - start > MAX_LATE_START_MS) return null;

  const price = newest.close;
  const reference = before ? before.close : oldest.open;
  const low = Math.min(...inside.map((c) => c.low));
  const high = Math.max(...inside.map((c) => c.high));
  const change = ((price - reference) / reference) * 100;
  const size = Math.abs(change).toFixed(1);
  const move = Math.abs(change) < FLAT_BELOW_PERCENT || size === "0.0" ? "flat" : `${change > 0 ? "up" : "down"} ${size}%`;

  const head = `${asset.name} is at ${formatPrice(price)}, ${move} over the past 2 hours`;
  const from = formatPrice(low);
  const to = formatPrice(high);
  return from === to ? `${head}.` : `${head}, ranging from ${from} to ${to}.`;
}

// ---------- Fetch, bounded and remembered ----------

/** One GET of the asset's 1m candles, aborted after 2.5 s. Throws on any failure. */
export async function fetchCandles(asset: PriceAsset): Promise<Candle[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PRICE_ABORT_MS);
  try {
    const res = await fetch(`${CANDLES_URL}/${asset.symbol}/${TIME_FRAME}`, { method: "GET", headers: { Accept: "application/json" }, signal: controller.signal });
    if (!res.ok) throw new Error(`candles answered HTTP ${res.status}`);
    return parseCandles((await res.json()) as unknown);
  } finally {
    clearTimeout(timer);
  }
}

const memo = new Map<string, { at: number; text: string }>();
const inflight = new Map<string, Promise<string | null>>();

/**
 * The sentence for an asset and whether it came from this instance's memory.
 * Null on any error, timeout or stale data. Never throws.
 */
export async function spotLine(asset: PriceAsset): Promise<{ text: string; cached: boolean } | null> {
  try {
    const kept = memo.get(asset.code);
    if (kept && Date.now() - kept.at < PRICE_MEMO_MS) return { text: kept.text, cached: true };

    let pending = inflight.get(asset.code);
    if (!pending) {
      pending = fetchCandles(asset)
        .then((candles) => {
          const text = composePriceLine(asset, candles, new Date());
          if (text) memo.set(asset.code, { at: Date.now(), text });
          return text;
        })
        .catch(() => null)
        .finally(() => {
          inflight.delete(asset.code);
        });
      inflight.set(asset.code, pending);
    }
    const text = await pending;
    return text ? { text, cached: false } : null;
  } catch {
    return null;
  }
}

/** What tier 0 hands back: the fields of a CardContext of kind "market", minus `available` and `kind`. */
export interface PriceContext {
  text: string;
  sourceTitle: string;
  sourceUrl: null;
  sourceDomain: null;
  cached: boolean;
}

/**
 * Tier 0 for one card: the spot sentence when the card is a crypto price card
 * of a supported asset, else null. Null also on any failure. Never throws.
 */
export async function priceContext(category: string | null | undefined, eventTicker: string, series?: string | null): Promise<PriceContext | null> {
  try {
    const asset = priceAssetFor(category, eventTicker, series);
    if (!asset) return null;
    const line = await spotLine(asset);
    return line ? { text: line.text, sourceTitle: PRICE_SOURCE_TITLE, sourceUrl: null, sourceDomain: null, cached: line.cached } : null;
  } catch {
    return null;
  }
}
