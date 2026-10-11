// Feed check: builds the live card feed through lib/gemini and prints its
// diversity and timings. Run from server/:  npx tsx scripts/gemini-check.ts
// Loads server/.env.local (Supabase for the snapshot; Gemini reads are public).
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";

loadEnv({ path: fileURLToPath(new URL("../.env.local", import.meta.url)), quiet: true });

import { currentFeed, fetchActiveCards, lastSnapshotSaved, rebuildFeed } from "../lib/gemini/feed";
import { getQuote, quoteLive } from "../lib/gemini/quote";
import type { CardQuote, Lane } from "../lib/types";

const LANES: Lane[] = ["live", "tomorrow", "week", "later"];

function counts<T>(items: readonly T[], keyOf: (item: T) => string): [string, number][] {
  const map = new Map<string, number>();
  for (const item of items) map.set(keyOf(item), (map.get(keyOf(item)) ?? 0) + 1);
  return [...map].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function describeCards(cards: CardQuote[]): void {
  console.log(`  per category: ${counts(cards, (c) => c.category).map(([k, v]) => `${k}=${v}`).join(", ")}`);
  console.log(`  per lane: ${LANES.map((lane) => `${lane}=${cards.filter((c) => c.lane === lane).length}`).join(", ")}`);
  const tradable = cards.filter((c) => c.tradable).length;
  console.log(`  tradable: ${tradable} of ${cards.length} (${cards.length ? Math.round((100 * tradable) / cards.length) : 0}%); events: ${new Set(cards.map((c) => c.eventTicker)).size}`);
}

async function main(): Promise<void> {
  const t0 = Date.now();
  const first = await currentFeed();
  const coldMs = Date.now() - t0;
  console.log(`cold fetchActiveCards: ${first.cards.length} cards in ${coldMs} ms (source: ${first.source}, built ${Math.round((Date.now() - first.builtAt) / 1000)} s ago)`);

  const t1 = Date.now();
  const warm = await fetchActiveCards();
  console.log(`warm fetchActiveCards: ${warm.length} cards in ${Date.now() - t1} ms`);

  const t2 = Date.now();
  const live = await rebuildFeed();
  console.log(`live build (rebuildFeed): ${live.cards.length} cards in ${Date.now() - t2} ms; snapshot saved: ${String(lastSnapshotSaved())}`);
  describeCards(live.cards);

  console.log("\nfirst 12 cards:");
  for (const card of live.cards.slice(0, 12)) {
    console.log(`  [${card.lane}${card.tradable ? ", tradable" : ""}] ${card.category}: ${card.question}`);
  }
  console.log("\none card per category:");
  const seen = new Set<string>();
  for (const card of live.cards) {
    if (seen.has(card.category)) continue;
    seen.add(card.category);
    console.log(`  ${card.category} [${card.lane}] ${card.question}  (${card.instrumentSymbol}, yes ${card.yesPrice.toFixed(2)} no ${card.noPrice.toFixed(2)})`);
  }

  const pick = live.cards.find((c) => c.tradable) ?? live.cards[0];
  if (pick) {
    const t3 = Date.now();
    const quote = await getQuote(pick.eventTicker, pick.instrumentSymbol);
    console.log(`\ngetQuote (dealt card path) ${pick.instrumentSymbol}: ${quote ? `yes ${quote.yesPrice.toFixed(2)} no ${quote.noPrice.toFixed(2)} tradable=${quote.tradable}` : "null"} in ${Date.now() - t3} ms`);
    const t4 = Date.now();
    const fresh = await quoteLive(pick.eventTicker, pick.instrumentSymbol);
    console.log(`quoteLive (network path) ${pick.instrumentSymbol}: ${fresh ? `yes ${fresh.yesPrice.toFixed(2)} no ${fresh.noPrice.toFixed(2)} tradable=${fresh.tradable}` : "null"} in ${Date.now() - t4} ms`);
  }

  if (live.cards.length === 0) {
    console.error("CHECK FAILED: no cards");
    process.exitCode = 1;
    return;
  }
  console.log("\nCHECK OK");
}

main().catch((error: unknown) => {
  console.error(`CHECK FAILED: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`);
  process.exitCode = 1;
});
