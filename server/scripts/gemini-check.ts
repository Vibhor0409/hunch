// Feed check: builds the live card feed through lib/gemini and prints a sample.
// Run from server/:  npx tsx scripts/gemini-check.ts
// Public endpoints only; loads server/.env.local for parity with the server.
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";

loadEnv({ path: fileURLToPath(new URL("../.env.local", import.meta.url)), quiet: true });

import { fetchActiveCards } from "../lib/gemini/feed";
import type { CardQuote, Lane } from "../lib/types";

const LANES: Lane[] = ["live", "tomorrow", "week"];

function minutesLeft(card: CardQuote, now: Date): string {
  const minutes = (new Date(card.expiresAt).getTime() - now.getTime()) / 60_000;
  return minutes < 90 ? `${minutes.toFixed(1)} min` : `${(minutes / 60).toFixed(1)} h`;
}

async function main(): Promise<void> {
  const started = Date.now();
  const cards = await fetchActiveCards();
  const now = new Date();
  console.log(`fetchActiveCards: ${cards.length} cards in ${Date.now() - started} ms`);

  console.log("\nfirst 5 cards:");
  for (const card of cards.slice(0, 5)) {
    console.log(`  [${card.lane}] ${card.question}`);
    console.log(`      ${card.eventTicker} / ${card.instrumentSymbol} / ${card.category} / expires ${card.expiresAt} (${minutesLeft(card, now)}) / yes ${card.yesPrice.toFixed(2)} no ${card.noPrice.toFixed(2)}`);
  }

  console.log("\ncards per lane:");
  for (const lane of LANES) console.log(`  ${lane}: ${cards.filter((c) => c.lane === lane).length}`);
  const events = new Set(cards.map((c) => c.eventTicker));
  console.log(`events: ${events.size}`);
  const categories = new Map<string, number>();
  for (const card of cards) categories.set(card.category, (categories.get(card.category) ?? 0) + 1);
  console.log(`per category: ${[...categories].map(([k, v]) => `${k}=${v}`).join(", ")}`);

  const again = Date.now();
  const cached = await fetchActiveCards();
  console.log(`\nsecond call: ${cached.length} cards in ${Date.now() - again} ms (${cached === cards ? "served from cache" : "not cached"})`);
  if (cards.length === 0) {
    console.error("CHECK FAILED: no cards");
    process.exitCode = 1;
    return;
  }
  console.log("CHECK OK");
}

main().catch((error: unknown) => {
  console.error(`CHECK FAILED: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`);
  process.exitCode = 1;
});
