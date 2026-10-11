import { paidCountBetween, settledSwipes, type Player } from "@/lib/db";
import { capFor, laDayBounds, levelFor, stakeFor, type SettledRow } from "@/lib/game";
import type { PlayerStatus } from "@/lib/types";

/**
 * PlayerStatus from values already in hand: level from every settled call
 * (levelFor), cap and stake from the level table, paidUsedToday as counted
 * for the current America/Los_Angeles day. Pure, no queries.
 */
export function statusFrom(player: Player, settled: readonly SettledRow[], paidUsedToday: number): PlayerStatus {
  const level = levelFor(settled);
  const dailyCap = capFor(level);
  return {
    playerId: player.id,
    name: player.name,
    level,
    dailyCap,
    paidUsedToday,
    paidLeftToday: Math.max(0, dailyCap - paidUsedToday),
    stake: stakeFor(level),
  };
}

/**
 * The PlayerStatus the app shows in the Deck header, loaded from the
 * database. Pass `settled` (rows or a pending promise) when the caller
 * already loads it, to save one query.
 */
export async function buildStatus(
  player: Player,
  settled?: SettledRow[] | Promise<SettledRow[]>,
  now: Date = new Date(),
): Promise<PlayerStatus> {
  const { startIso, endIso } = laDayBounds(now);
  const [rows, paidUsedToday] = await Promise.all([
    settled ?? settledSwipes(player.id),
    paidCountBetween(player.id, startIso, endIso),
  ]);
  return statusFrom(player, rows, paidUsedToday);
}
