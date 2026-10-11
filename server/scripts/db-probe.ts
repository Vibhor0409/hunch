// Database probe: exercises lib/db against the real Supabase project, then cleans up.
// Run from server/:  npx tsx scripts/db-probe.ts
// Loads server/.env.local (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY). Exits 1 on any failure.
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";

loadEnv({ path: fileURLToPath(new URL("../.env.local", import.meta.url)), quiet: true });

import { laDayBounds } from "../lib/game";
import {
  counters,
  createPlayer,
  getDb,
  getPlayer,
  insertSwipe,
  lastSettled,
  leaderboardRows,
  paidCountBetween,
  recentSwipes,
  settledSwipes,
  settleSwipe,
  swipedSymbols,
  unsettledExpired,
} from "../lib/db";

const stamp = Date.now();
const PLAYER_NAME = `__probe__${stamp}`;
const SYMBOL = `__probe__${stamp}`;

function ok(step: string, detail: string): void {
  console.log(`ok    ${step}: ${detail}`);
}

function expect(condition: boolean, step: string, detail: string): void {
  if (!condition) throw new Error(`${step} failed: ${detail}`);
}

async function deletePlayer(id: string): Promise<void> {
  const { error } = await getDb().from("players").delete().eq("id", id);
  if (error) throw new Error(`cleanup failed: ${error.message} (code ${error.code})`);
}

async function main(): Promise<void> {
  const created = await createPlayer(PLAYER_NAME);
  expect(created.ok, "createPlayer", "name_taken for a timestamped name");
  if (!created.ok) return;
  const playerId = created.player.id;
  ok("createPlayer", `${PLAYER_NAME} -> ${playerId}`);

  try {
    const taken = await createPlayer(PLAYER_NAME.toUpperCase());
    expect(!taken.ok && taken.error === "name_taken", "createPlayer duplicate", "expected name_taken (case-insensitive index)");
    ok("createPlayer duplicate", "name_taken");

    const player = await getPlayer(playerId);
    expect(player?.name === PLAYER_NAME, "getPlayer", `expected ${PLAYER_NAME}, got ${player?.name ?? "null"}`);
    ok("getPlayer", player!.name);

    const missing = await getPlayer("not-a-uuid");
    expect(missing === null, "getPlayer malformed id", "expected null");
    ok("getPlayer malformed id", "null");

    const now = new Date();
    const inserted = await insertSwipe({
      playerId,
      eventTicker: `__probe__event_${stamp}`,
      instrumentSymbol: SYMBOL,
      question: "Probe: does the swipes table accept this row?",
      category: "probe",
      lane: "live",
      side: "yes",
      price: 0.45,
      mode: "paid",
      stake: 1,
      contracts: 2.22,
      orderId: `probe-${stamp}`,
      orderStatus: "filled",
      expiresAt: new Date(now.getTime() - 60_000).toISOString(), // already expired, so settlement picks it up
    });
    expect(inserted.ok, "insertSwipe", "already_swiped on first insert");
    if (!inserted.ok) return;
    const swipe = inserted.swipe;
    expect(swipe.price === 0.45 && swipe.contracts === 2.22 && swipe.stake === 1, "insertSwipe numerics", JSON.stringify({ price: swipe.price, contracts: swipe.contracts, stake: swipe.stake }));
    expect(typeof swipe.price === "number", "insertSwipe numeric type", typeof swipe.price);
    ok("insertSwipe", `${swipe.id} price=${swipe.price} contracts=${swipe.contracts} settled=${swipe.settled}`);

    const repeat = await insertSwipe({ ...swipe, orderId: null, orderStatus: null });
    expect(!repeat.ok && repeat.error === "already_swiped", "insertSwipe repeat", "expected already_swiped");
    ok("insertSwipe repeat", "already_swiped");

    const symbols = await swipedSymbols(playerId);
    expect(symbols.has(SYMBOL) && symbols.size === 1, "swipedSymbols", `size ${symbols.size}`);
    ok("swipedSymbols", `{${[...symbols].join(", ")}}`);

    const { startIso, endIso } = laDayBounds(now);
    const paid = await paidCountBetween(playerId, startIso, endIso);
    expect(paid === 1, "paidCountBetween", `expected 1, got ${paid}`);
    ok("paidCountBetween", `${paid} paid swipe in LA day ${startIso} to ${endIso}`);

    const expired = await unsettledExpired(200);
    expect(expired.some((row) => row.id === swipe.id), "unsettledExpired", "probe swipe not returned");
    ok("unsettledExpired", `${expired.length} row(s), includes probe swipe`);

    const settled = await settleSwipe(swipe.id, { won: true, edge: 5.5, payout: 2.22 });
    expect(settled !== null, "settleSwipe", "returned null");
    expect(settled!.settled && settled!.won === true && settled!.edge === 5.5 && settled!.payout === 2.22 && settled!.settledAt !== null, "settleSwipe fields", JSON.stringify(settled));
    ok("settleSwipe", `won=${settled!.won} edge=${settled!.edge} payout=${settled!.payout} settledAt=${settled!.settledAt}`);

    const again = await settleSwipe(swipe.id, { won: false, edge: -4.5, payout: 0 });
    expect(again === null, "settleSwipe repeat", "expected null for an already settled swipe");
    ok("settleSwipe repeat", "null (no double settlement)");

    const rows = await settledSwipes(playerId);
    expect(rows.length === 1 && rows[0].edge === 5.5 && rows[0].won && rows[0].category === "probe" && rows[0].price === 0.45, "settledSwipes", JSON.stringify(rows));
    ok("settledSwipes", JSON.stringify(rows[0]));

    const last = await lastSettled(playerId, 10);
    expect(last.length === 1 && last[0].id === swipe.id && last[0].edge === 5.5, "lastSettled", JSON.stringify(last.map((r) => r.id)));
    ok("lastSettled", `${last.length} row(s)`);

    const recent = await recentSwipes(playerId, 10);
    expect(recent.length === 1 && recent[0].id === swipe.id && recent[0].settled, "recentSwipes", JSON.stringify(recent.map((r) => r.id)));
    ok("recentSwipes", `${recent.length} row(s), newest ${recent[0].instrumentSymbol}`);

    const board = await leaderboardRows(1000);
    const mine = board.find((row) => row.playerId === playerId);
    expect(mine !== undefined, "leaderboardRows", "probe player missing from the top 1000");
    expect(mine!.edgeTotal === 5.5 && mine!.settledCalls === 1 && mine!.totalCalls === 1, "leaderboardRows values", JSON.stringify(mine));
    expect(typeof mine!.edgeTotal === "number" && typeof mine!.settledCalls === "number", "leaderboardRows numeric types", `${typeof mine!.edgeTotal}/${typeof mine!.settledCalls}`);
    ok("leaderboardRows", `${board.length} row(s); probe at index ${board.indexOf(mine!)} with edgeTotal=${mine!.edgeTotal}`);

    const totals = await counters();
    expect(totals.players >= 1 && totals.calls >= 1 && totals.geminiOrders >= 1, "counters", JSON.stringify(totals));
    ok("counters", JSON.stringify(totals));
  } finally {
    await deletePlayer(playerId);
    ok("deletePlayer", `${playerId} removed`);
  }

  const gone = await getPlayer(playerId);
  expect(gone === null, "cascade", "player still present after delete");
  const orphans = await recentSwipes(playerId, 10);
  expect(orphans.length === 0, "cascade", `${orphans.length} swipe(s) survived the player delete`);
  ok("cascade", "player and swipe gone");

  console.log("DB PROBE PASSED");
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`DB PROBE FAILED: ${message}`);
  process.exitCode = 1;
});
