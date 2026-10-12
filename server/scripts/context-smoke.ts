// Context smoke test for Hunch (docs/CONTEXT_DEV.md, "Always-on context"). Run from server/:
//   npx tsx scripts/context-smoke.ts                  ten real cards, each looked up twice
//   npx tsx scripts/context-smoke.ts --clear-misses   first delete the stored "nothing found" rows
//   npx tsx scripts/context-smoke.ts --budget=12      credits this run may spend (default 24)
//   npx tsx scripts/context-smoke.ts --six            six cards, one line each: BTC, ETH, SOL or XRP, and three
//                                                     other categories (kind, source title, ms, text); budget 5
// Ten real cards from as many categories as the feed offers go through
// resolveCardContext (the same code path as GET /api/context) twice. Passes
// when 10 of 10 are available and every second call answers in under 1 s.
// Credits: a search costs 0 to 2 credits (nothing when Context.dev times out),
// and a card that is not stored yet runs one or two searches, so a fully cold
// run of ten cards spends 40 credits at most; a stored card spends none. The
// run budget is enforced by the real credit guard: the daily cap is lowered
// for this process to "used today plus budget", so once the budget is spent the
// remaining cards answer from the market rules (tier 3).
// Loads server/.env.local. Prints credits used and remaining. Never prints the key.
import { config as loadEnv } from "dotenv";

loadEnv({ path: "/Users/nishkadesai/hunch/server/.env.local", quiet: true });

import { fetchActiveCards } from "../lib/gemini/feed";
import type { CardContext, CardQuote } from "../lib/types";
import {
  MARKET_SOURCE_TITLE,
  MAX_LINE_LENGTH,
  MAX_MARKET_TEXT_LENGTH,
  PRICE_SOURCE_TITLE,
  clearCachedMisses,
  dailyCreditCap,
  hasContextKey,
  laDayOf,
  mentionsOdds,
  priceAssetFor,
  readUsage,
  resolveCardContext,
  runUsage,
  type ContextLookup,
} from "../lib/context";

const CLEAR_MISSES = process.argv.includes("--clear-misses");
const SIX = process.argv.includes("--six");
const CARD_COUNT = 10;
/** Categories the live check missed; each gets a card when the feed has one. */
const WANTED = ["Culture", "Crypto", "Business", "Weather", "Tech", "Sports"];
const DEFAULT_BUDGET = SIX ? 5 : 24;
const SECOND_CALL_LIMIT_MS = 1_000;
/** Cards closing sooner than this are left out of the run. */
const MIN_TIME_LEFT_MS = 10 * 60_000;

function budgetArg(): number {
  const raw = process.argv.find((arg) => arg.startsWith("--budget="))?.slice("--budget=".length);
  const value = Number(raw);
  return raw !== undefined && Number.isInteger(value) && value >= 0 ? value : DEFAULT_BUDGET;
}

function describeError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

function expect(condition: boolean, step: string, detail: string): void {
  if (!condition) throw new Error(`${step} failed: ${detail}`);
}

/** The letters-and-digits prefix of a ticker before its date stamp ("BTC05M2610112230" gives "BTC05M"). */
function tickerPrefix(ticker: string): string {
  return ticker.replace(/\d{6,}.*$/, "");
}

/**
 * Ten cards: one per wanted category first, then one per other category, then
 * further rounds over all categories. No event twice, and no ticker prefix
 * twice inside a category while it has others, so the lookups hit different
 * cache keys.
 */
function pickCards(cards: readonly CardQuote[], count: number): CardQuote[] {
  // The feed can be two minutes old; a card about to close would be closed by the time it is looked up.
  const open = cards.filter((card) => new Date(card.expiresAt).getTime() - Date.now() > MIN_TIME_LEFT_MS);
  const byCategory = new Map<string, CardQuote[]>();
  for (const card of open) byCategory.set(card.category, [...(byCategory.get(card.category) ?? []), card]);
  const order = [...WANTED.filter((c) => byCategory.has(c)), ...[...byCategory.keys()].filter((c) => !WANTED.includes(c))];

  const picked: CardQuote[] = [];
  const events = new Set<string>();
  const prefixes = new Set<string>();
  for (const distinctPrefix of [true, false]) {
    let added = true;
    while (picked.length < count && added) {
      added = false;
      for (const category of order) {
        if (picked.length >= count) break;
        const next = (byCategory.get(category) ?? []).find(
          (card) => !events.has(card.eventTicker) && !(distinctPrefix && prefixes.has(`${category}|${tickerPrefix(card.eventTicker)}`)),
        );
        if (!next) continue;
        events.add(next.eventTicker);
        prefixes.add(`${category}|${tickerPrefix(next.eventTicker)}`);
        picked.push(next);
        added = true;
      }
    }
  }
  return picked;
}

function checkShape(ctx: CardContext, step: string): void {
  expect(ctx.available === true, step, "context must be available for a live card");
  expect(ctx.kind === "web" || ctx.kind === "market", step, `kind is ${String(ctx.kind)}`);
  expect(typeof ctx.cached === "boolean", step, "cached must be a boolean");
  expect(typeof ctx.text === "string" && ctx.text.trim().length > 0, step, "text must not be empty");
  const text = ctx.text ?? "";
  expect(!mentionsOdds(text), step, "text mentions odds or a betting site");
  expect(!/<[a-z/][^>]*>|\]\(|\*\*/i.test(text), step, "text carries HTML or markdown");
  expect(!/\n/.test(text) && /[.!?]["”’)\]]?$/.test(text), step, "text must be one line that ends as a sentence");
  if (ctx.kind === "web") {
    expect(text.length <= MAX_LINE_LENGTH, step, `web text is ${text.length} characters, more than ${MAX_LINE_LENGTH}`);
    expect(typeof ctx.sourceUrl === "string" && /^https?:\/\//.test(ctx.sourceUrl), step, "web source url must be http(s)");
    expect(typeof ctx.sourceDomain === "string" && ctx.sourceDomain.length > 0, step, "web source domain required");
  } else {
    expect(text.length <= MAX_MARKET_TEXT_LENGTH, step, `market text is ${text.length} characters, more than ${MAX_MARKET_TEXT_LENGTH}`);
    expect(ctx.sourceTitle === MARKET_SOURCE_TITLE || ctx.sourceTitle === PRICE_SOURCE_TITLE, step, `market source title is "${ctx.sourceTitle}"`);
    expect(ctx.sourceDomain === null, step, "market source domain must be null");
    expect(ctx.sourceUrl === null || /^https:\/\//.test(ctx.sourceUrl), step, "market source url must be null or https");
    if (ctx.sourceTitle === PRICE_SOURCE_TITLE) expect(ctx.sourceUrl === null, step, "the spot price line carries no link");
  }
}

interface Row {
  card: CardQuote;
  first: ContextLookup;
  second: ContextLookup;
}

function cell(value: string | number, width: number): string {
  const text = String(value);
  return text.length >= width ? text.slice(0, width) : text.padEnd(width);
}

/** How the first call got its answer, for the table. */
function routeOf(first: ContextLookup): string {
  if (first.tier === 0) return "spot price";
  if (first.context.kind === "web") return first.context.cached ? "cached" : "searched";
  if (first.context.cached) return "cached miss";
  return first.searches > 0 ? "web miss" : "no search";
}

function printTable(rows: readonly Row[]): void {
  console.log(`\n${cell("category", 12)} ${cell("tier", 4)} ${cell("kind", 6)} ${cell("ms", 5)} ${cell("2nd ms", 6)} ${cell("route", 11)} text (first 80 characters)`);
  for (const { card, first, second } of rows) {
    const text = (first.context.text ?? "").slice(0, 80);
    console.log(`${cell(card.category, 12)} ${cell(first.tier, 4)} ${cell(first.context.kind, 6)} ${cell(first.ms, 5)} ${cell(second.ms, 6)} ${cell(routeOf(first), 11)} ${text}`);
  }
  console.log(
    "route: spot price = tier 0, the asset's spot move (crypto price cards); searched = a web tier answered now; cached = a stored web line; web miss = the web was searched and gave nothing usable; cached miss = a stored miss; no search = the web tiers were skipped (credit guard, no key, or a closed market)",
  );
}

/**
 * --six: one BTC, one ETH and one SOL or XRP price card, then three cards from
 * three other categories. Each is looked up once and printed as one line:
 * kind, source title, ms, text. The crypto cards must be answered by tier 0.
 */
function pickSix(cards: readonly CardQuote[]): CardQuote[] {
  const open = cards.filter((card) => new Date(card.expiresAt).getTime() - Date.now() > MIN_TIME_LEFT_MS);
  const assetOf = (card: CardQuote) => priceAssetFor(card.category, card.eventTicker)?.code ?? null;
  const crypto = [["BTC"], ["ETH"], ["SOL", "XRP"]].map((codes) => open.find((card) => codes.includes(assetOf(card) ?? "")));
  const others: CardQuote[] = [];
  for (const category of [...WANTED, ...new Set(open.map((card) => card.category))]) {
    if (others.length >= 3 || category === "Crypto" || others.some((card) => card.category === category)) continue;
    const card = open.find((c) => c.category === category);
    if (card) others.push(card);
  }
  return [...crypto.filter((card): card is CardQuote => card !== undefined), ...others];
}

async function sixLines(cards: readonly CardQuote[]): Promise<void> {
  const picked = pickSix(cards);
  expect(picked.length === 6, "card selection", `found ${picked.length} of the six cards (BTC, ETH, SOL or XRP, three other categories)`);
  const lines: string[] = [];
  for (const card of picked) {
    const lookup = await resolveCardContext(card.eventTicker, card.instrumentSymbol);
    const { context } = lookup;
    checkShape(context, `lookup for ${card.eventTicker}`);
    const asset = priceAssetFor(card.category, card.eventTicker);
    if (asset) {
      expect(lookup.tier === 0 && context.sourceTitle === PRICE_SOURCE_TITLE, `lookup for ${card.eventTicker}`, `a ${asset.code} price card was answered by tier ${lookup.tier}, not by the spot price`);
      expect((context.text ?? "").startsWith(`${asset.name} is at $`), `lookup for ${card.eventTicker}`, "the spot line must lead with the asset and its price");
    } else {
      expect(lookup.tier !== 0, `lookup for ${card.eventTicker}`, "only crypto price cards get the spot line");
    }
    lines.push(`${cell(card.category, 11)} | ${cell(context.kind, 6)} | ${cell(context.sourceTitle ?? "", 34)} | ${cell(`${lookup.ms} ms`, 8)} | ${context.text}`);
  }
  console.log(`\n${cell("category", 11)} | ${cell("kind", 6)} | ${cell("sourceTitle", 34)} | ${cell("ms", 8)} | text`);
  for (const line of lines) console.log(line);
}

async function main(): Promise<void> {
  console.log(`now ${new Date().toISOString()}`);
  if (!hasContextKey()) console.log("CONTEXT_DEV_API_KEY is not set: the web tiers are skipped and every card answers from the market rules");

  const day = laDayOf(new Date());
  const before = await readUsage(day);
  const budget = budgetArg();
  const cap = Math.min(dailyCreditCap(), before.creditsUsed + budget);
  process.env.CONTEXT_DEV_DAILY_CREDIT_CAP = String(Math.max(1, cap));
  console.log(
    `context_usage ${day} before: calls=${before.calls} credits_used=${before.creditsUsed} last_credits_remaining=${before.lastCreditsRemaining ?? "null"}; run budget ${budget} credits (guard cap for this process: ${cap})`,
  );

  if (CLEAR_MISSES) console.log(`--clear-misses: deleted ${await clearCachedMisses()} card_context row(s) with no text`);

  const cards = await fetchActiveCards();
  const categories = [...new Set(cards.map((c) => c.category))];
  console.log(`feed: ${cards.length} cards, ${categories.length} categories: ${categories.join(", ")}`);
  const missing = WANTED.filter((c) => !categories.includes(c));
  if (missing.length > 0) console.log(`not in the feed right now: ${missing.join(", ")}`);

  if (SIX) {
    await sixLines(cards);
    const spent = runUsage();
    const now = await readUsage(day);
    console.log(`\ncredits used in this run: ${spent.creditsConsumed}; credits remaining: ${spent.lastCreditsRemaining ?? now.lastCreditsRemaining ?? "unknown"}`);
    expect(spent.creditsConsumed <= budget + 1, "budget", `used ${spent.creditsConsumed} credits against a budget of ${budget}`);
    console.log("\nCONTEXT SIX OK");
    return;
  }

  const picked = pickCards(cards, CARD_COUNT);
  expect(picked.length === CARD_COUNT, "card selection", `only ${picked.length} distinct events in the feed`);

  const rows: Row[] = [];
  for (const card of picked) {
    console.log(`\ncard ${card.eventTicker} / ${card.instrumentSymbol} [${card.category}, ${card.lane}]\n  question "${card.question}"`);
    const first = await resolveCardContext(card.eventTicker, card.instrumentSymbol);
    checkShape(first.context, `first call for ${card.eventTicker}`);
    const spentBefore = runUsage().creditsConsumed;
    const second = await resolveCardContext(card.eventTicker, card.instrumentSymbol);
    checkShape(second.context, `second call for ${card.eventTicker}`);
    expect(runUsage().creditsConsumed === spentBefore, `second call for ${card.eventTicker}`, "the second call spent credits");
    expect(second.context.kind === first.context.kind, `second call for ${card.eventTicker}`, `kind changed from ${first.context.kind} to ${second.context.kind}`);
    if (first.context.kind === "web") {
      expect(second.context.cached === true, `second call for ${card.eventTicker}`, "a web line must come back cached");
      expect(second.context.text === first.context.text, `second call for ${card.eventTicker}`, "cached text differs from the first answer");
    }
    console.log(
      `  tier ${first.tier} ${first.context.kind} in ${first.ms} ms (cached=${first.context.cached}, searches=${first.searches}, credits=${first.credits}); again in ${second.ms} ms (cached=${second.context.cached})`,
    );
    console.log(`  "${first.context.text}"\n  ${first.context.sourceTitle ?? ""}${first.context.sourceUrl ? ` ${first.context.sourceUrl.slice(0, 100)}` : ""}`);
    rows.push({ card, first, second });
  }

  printTable(rows);

  const web = rows.filter((r) => r.first.context.kind === "web").length;
  const slowest = rows.reduce((a, b) => (b.first.ms > a.first.ms ? b : a));
  const slowestSecond = rows.reduce((a, b) => (b.second.ms > a.second.ms ? b : a));
  console.log(`\navailable: ${rows.filter((r) => r.first.context.available).length} of ${rows.length}; web ${web}, market ${rows.length - web}`);
  console.log(`categories covered: ${[...new Set(rows.map((r) => r.card.category))].join(", ")}`);
  console.log(`slowest first call: ${slowest.first.ms} ms (${slowest.card.category}, tier ${slowest.first.tier}); slowest second call: ${slowestSecond.second.ms} ms`);

  const usage = runUsage();
  const after = await readUsage(day);
  const sent = rows.reduce((sum, r) => sum + r.first.searches + r.second.searches, 0);
  console.log(
    `credits used in this run: ${usage.creditsConsumed} (${sent} search(es) sent, ${usage.calls} answered); credits remaining: ${usage.lastCreditsRemaining ?? after.lastCreditsRemaining ?? "unknown"}`,
  );
  console.log(
    `context_usage ${day} after: calls=${after.calls} credits_used=${after.creditsUsed} last_credits_remaining=${after.lastCreditsRemaining ?? "null"} (the table is shared with production, so its change can exceed this run)`,
  );

  expect(rows.every((r) => r.first.context.available && r.second.context.available), "availability", "not every card had context");
  const slow = rows.filter((r) => r.second.ms >= SECOND_CALL_LIMIT_MS);
  expect(slow.length === 0, "second calls", `${slow.length} took ${SECOND_CALL_LIMIT_MS} ms or more (slowest ${slowestSecond.second.ms} ms)`);
  expect(usage.creditsConsumed <= budget + 2, "budget", `used ${usage.creditsConsumed} credits against a budget of ${budget}`);
  console.log("\nCONTEXT SMOKE OK");
}

main().catch((error: unknown) => {
  console.error(`CONTEXT SMOKE FAILED: ${describeError(error)}`);
  const usage = runUsage();
  console.error(`credits used in this run: ${usage.creditsConsumed}; credits remaining: ${usage.lastCreditsRemaining ?? "unknown"}`);
  process.exitCode = 1;
});
