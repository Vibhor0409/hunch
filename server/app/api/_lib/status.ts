import { paidCountBetween, settledSwipes, type Player } from "@/lib/db";
import { capFor, laDayBounds, levelFor, stakeFor, type SettledRow } from "@/lib/game";
import type { PlayerStatus } from "@/lib/types";

/**
 * The PlayerStatus the app shows in the Deck header and after every swipe.
 * Level comes from every settled call (levelFor), cap and stake from the
 * level table, and paidUsedToday from paid swipes in the current
 * America/Los_Angeles calendar day. Pass `settled` (rows or a pending
 * promise) when the caller already loads it, to save one query.
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
  const level = levelFor(rows);
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
