// Context.dev smoke test for Hunch (docs/CONTEXT_DEV.md). Run from server/:
//   npx tsx scripts/context-smoke.ts              part 1 (one raw search, saved) then part 2
//   npx tsx scripts/context-smoke.ts --skip-raw   part 2 only, reusing the saved sample
// Part 1: ONE raw POST /web/search for a real card's question; the raw response
// is saved to docs/samples/context-search.json. Part 2: getCardContext (the same
// code path as GET /api/context) for three real cards from different categories
// (different series when the feed has fewer categories), then the first one
// again, which must come back cached.
// Loads server/.env.local. Prints credits consumed and remaining. Never prints the key.
// Budget: about 2 credits per lookup; a cold cache costs at most 8 credits per full run.
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";

loadEnv({ path: "/Users/nishkadesai/hunch/server/.env.local", quiet: true });

import { fetchActiveCards } from "../lib/gemini/feed";
import type { CardContext, CardQuote } from "../lib/types";
import { freshnessFor, parseSearchResponse, queryFor, recordRunUsage, runUsage, searchRaw } from "../lib/context/client";
import { getCardContext, laDayOf, MAX_TEXT_LENGTH, mentionsOdds, readUsage } from "../lib/context";

const SAMPLES_DIR = fileURLToPath(new URL("../../docs/samples/", import.meta.url));
const SAMPLE_FILE = "context-search.json";
const SKIP_RAW = process.argv.includes("--skip-raw");
const CARD_COUNT = 3;
/** Stop before any further call once the key reports fewer credits than this. */
const STOP_BELOW_REMAINING = 50;
/** Hard ceiling for one run of this script. */
const RUN_BUDGET = 12;

function describeError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

function expect(condition: boolean, step: string, detail: string): void {
  if (!condition) throw new Error(`${step} failed: ${detail}`);
}

/** The letters-and-digits prefix of a ticker before its date stamp ("BTC05M2610112230" gives "BTC05M"). */
function tickerPrefix(ticker: string): string {
  return ticker.replace(/\d{6,}$/, "");
}

/**
 * Up to `count` cards: first one per category, then (when the feed has fewer
 * categories than that) one per ticker prefix not yet used, so the lookups
 * still hit different cache keys.
 */
function pickCards(cards: readonly CardQuote[], count: number): CardQuote[] {
  const picked: CardQuote[] = [];
  const categories = new Set<string>();
  const prefixes = new Set<string>();
  for (const card of cards) {
    if (picked.length >= count || categories.has(card.category)) continue;
    categories.add(card.category);
    prefixes.add(tickerPrefix(card.eventTicker));
    picked.push(card);
  }
  for (const card of cards) {
    if (picked.length >= count) break;
    const prefix = tickerPrefix(card.eventTicker);
    if (prefixes.has(prefix)) continue;
    prefixes.add(prefix);
    picked.push(card);
  }
  return picked;
}

function checkRemaining(): void {
  const remaining = runUsage().lastCreditsRemaining;
  if (remaining !== null && remaining < STOP_BELOW_REMAINING) {
    throw new Error(`credits_remaining is ${remaining} (below ${STOP_BELOW_REMAINING}); stopping. Ask the human to add credits.`);
  }
  const used = runUsage().creditsConsumed;
  if (used > RUN_BUDGET) throw new Error(`this run used ${used} credits, more than the ${RUN_BUDGET} allowed; stopping`);
}

function describeContext(ctx: CardContext): string {
  if (!ctx.available) return `available=false cached=${ctx.cached} (card back says "Trust your gut.")`;
  return `cached=${ctx.cached} source=${ctx.sourceDomain}\n    "${ctx.text}"\n    ${ctx.sourceTitle ?? ""} ${ctx.sourceUrl}`;
}

function checkContextShape(ctx: CardContext, step: string): void {
  expect(typeof ctx.available === "boolean" && typeof ctx.cached === "boolean", step, "available and cached must be booleans");
  if (ctx.available) {
    expect(typeof ctx.text === "string" && ctx.text.length > 0, step, "available context must have text");
    expect(ctx.text!.length <= MAX_TEXT_LENGTH, step, `text is ${ctx.text!.length} chars, more than ${MAX_TEXT_LENGTH}`);
    expect(!mentionsOdds(ctx.text!), step, "text mentions odds or a betting site");
    expect(typeof ctx.sourceUrl === "string" && /^https?:\/\//.test(ctx.sourceUrl), step, "source url must be http(s)");
    expect(typeof ctx.sourceDomain === "string" && ctx.sourceDomain.length > 0, step, "source domain required");
  } else {
    expect(ctx.text === null && ctx.sourceTitle === null && ctx.sourceUrl === null && ctx.sourceDomain === null, step, "unavailable context must have null fields");
  }
}

async function partOneRawSearch(cards: readonly CardQuote[]): Promise<void> {
  console.log("\n== part 1: one raw POST /web/search, saved to docs/samples/context-search.json");
  // Prefer a non-crypto card so the sample shows news highlights; crypto price windows have little coverage.
  const card = cards.find((c) => c.category !== "Crypto") ?? cards[0];
  if (!card) throw new Error("the feed has no cards; nothing to search for");
  const query = queryFor(card.question);
  const freshness = freshnessFor(card.lane);
  console.log(`card ${card.eventTicker} / ${card.instrumentSymbol} [${card.category}, ${card.lane}]`);
  console.log(`query "${query}" freshness=${freshness}`);
  const raw = await searchRaw(query, freshness);
  await mkdir(SAMPLES_DIR, { recursive: true });
  await writeFile(`${SAMPLES_DIR}${SAMPLE_FILE}`, `${JSON.stringify(raw, null, 2)}\n`);
  console.log(`saved docs/samples/${SAMPLE_FILE}`);
  const parsed = parseSearchResponse(raw);
  recordRunUsage(parsed);
  console.log(
    `request_id=${parsed.requestId ?? "none"} credits_consumed=${parsed.creditsConsumed} credits_remaining=${parsed.creditsRemaining ?? "unknown"} partial=${parsed.partial} results=${parsed.results.length}`,
  );
  for (const r of parsed.results) {
    const n = r.highlights?.highlights?.length ?? 0;
    console.log(`  [${r.relevance ?? "?"}] ${r.url} highlights=${n} title="${r.title ?? ""}"`);
  }
  checkRemaining();
}

async function partTwoCards(cards: readonly CardQuote[]): Promise<void> {
  console.log(`\n== part 2: getCardContext for ${CARD_COUNT} real cards, then the first again`);
  const picked = pickCards(cards, CARD_COUNT);
  expect(picked.length === CARD_COUNT, "part 2", `only ${picked.length} distinct cards in the feed`);

  const results: { card: CardQuote; ctx: CardContext }[] = [];
  for (const card of picked) {
    console.log(`\ncard ${card.eventTicker} / ${card.instrumentSymbol} [${card.category}, ${card.lane}]`);
    console.log(`  question "${card.question}"`);
    const ctx = await getCardContext(card.eventTicker, card.instrumentSymbol);
    checkContextShape(ctx, `context for ${card.eventTicker}`);
    console.log(`  ${describeContext(ctx)}`);
    results.push({ card, ctx });
    checkRemaining();
  }
  const available = results.filter((r) => r.ctx.available);
  expect(available.length > 0, "part 2", "no card returned context; check the Context.dev results and pickContext");

  // Second call for the first card that produced a result: must be served from card_context.
  const again = (available[0] ?? results[0]).card;
  console.log(`\nagain ${again.eventTicker} / ${again.instrumentSymbol} (expect cached: true)`);
  const before = runUsage().creditsConsumed;
  const second = await getCardContext(again.eventTicker, again.instrumentSymbol);
  checkContextShape(second, "cached call");
  console.log(`  ${describeContext(second)}`);
  expect(second.cached === true, "cached call", `cached=${second.cached}`);
  expect(runUsage().creditsConsumed === before, "cached call", "the cached call spent credits");
  const firstCtx = (available[0] ?? results[0]).ctx;
  expect(second.text === firstCtx.text && second.sourceUrl === firstCtx.sourceUrl, "cached call", "cached text differs from the first answer");

  console.log("\nsummary:");
  for (const { card, ctx } of results) {
    console.log(`  [${card.category}/${card.lane}] ${card.eventTicker}: ${ctx.available ? `"${ctx.text}" (${ctx.sourceDomain})` : "no context"}`);
  }
}

async function main(): Promise<void> {
  if (!process.env.CONTEXT_DEV_API_KEY) throw new Error("CONTEXT_DEV_API_KEY is missing in server/.env.local");
  console.log(`now ${new Date().toISOString()}`);

  const cards = await fetchActiveCards();
  const categories = [...new Set(cards.map((c) => c.category))];
  console.log(`feed: ${cards.length} cards, ${categories.length} categories: ${categories.join(", ")}`);

  if (SKIP_RAW) console.log("\n== part 1 skipped (--skip-raw)");
  else await partOneRawSearch(cards);

  await partTwoCards(cards);

  const usage = runUsage();
  const day = laDayOf(new Date());
  const today = await readUsage(day);
  console.log(`\ncredits used in this run: ${usage.creditsConsumed} over ${usage.calls} call(s); credits remaining: ${usage.lastCreditsRemaining ?? "unknown"}`);
  console.log(`context_usage ${day}: calls=${today.calls} credits_used=${today.creditsUsed} last_credits_remaining=${today.lastCreditsRemaining ?? "null"}`);
  expect(usage.creditsConsumed <= RUN_BUDGET, "budget", `used ${usage.creditsConsumed} credits, more than the ${RUN_BUDGET} allowed`);
  console.log("\nCONTEXT SMOKE OK");
}

main().catch((error: unknown) => {
  console.error(`CONTEXT SMOKE FAILED: ${describeError(error)}`);
  const usage = runUsage();
  console.error(`credits used in this run: ${usage.creditsConsumed}; credits remaining: ${usage.lastCreditsRemaining ?? "unknown"}`);
  process.exitCode = 1;
});
