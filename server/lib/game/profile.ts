import type { CategoryStat } from "../types";

/** One settled swipe as the profile needs it. */
export interface SettledRow {
  category: string;
  won: boolean;
  /** Price of the chosen side at swipe time, 0 to 1. */
  price: number;
  /** Edge stored with one decimal. */
  edge: number;
}

/** Categories need this many settled calls to count toward the insight line. */
export const INSIGHT_MIN_CALLS = 3;

interface Bucket {
  calls: number;
  wins: number;
  priceSum: number;
  /** Edge summed as integer tenths so the total stays exact. */
  edgeTenths: number;
}

function byEdgeDesc(a: CategoryStat, b: CategoryStat): number {
  return b.edgeTotal - a.edgeTotal || a.category.localeCompare(b.category);
}

/**
 * Per-category stats (SPEC F6): settled calls, hit rate, average implied
 * probability of the chosen side and total Edge. Sorted by total Edge
 * descending; ties fall back to category name so the order is stable.
 */
export function categoryStats(rows: readonly SettledRow[]): CategoryStat[] {
  const buckets = new Map<string, Bucket>();
  for (const row of rows) {
    let bucket = buckets.get(row.category);
    if (!bucket) {
      bucket = { calls: 0, wins: 0, priceSum: 0, edgeTenths: 0 };
      buckets.set(row.category, bucket);
    }
    bucket.calls += 1;
    if (row.won) bucket.wins += 1;
    bucket.priceSum += row.price;
    bucket.edgeTenths += Math.round(row.edge * 10);
  }

  const stats: CategoryStat[] = [];
  for (const [category, bucket] of buckets) {
    const edgeTotal = bucket.edgeTenths / 10;
    stats.push({
      category,
      settledCalls: bucket.calls,
      hitRate: bucket.wins / bucket.calls,
      avgImplied: bucket.priceSum / bucket.calls,
      edgeTotal: edgeTotal === 0 ? 0 : edgeTotal,
    });
  }
  return stats.sort(byEdgeDesc);
}

/**
 * The one insight line (SPEC F6), using only categories with at least 3
 * settled calls. Null when fewer than two categories qualify or when best and
 * worst are the same category. The input order does not matter.
 */
export function insight(stats: readonly CategoryStat[]): string | null {
  const qualifying = stats.filter((stat) => stat.settledCalls >= INSIGHT_MIN_CALLS).sort(byEdgeDesc);
  if (qualifying.length < 2) return null;
  const best = qualifying[0];
  const worst = qualifying[qualifying.length - 1];
  if (best.category === worst.category) return null;
  return `Ahead of the market on ${best.category}. Behind on ${worst.category}.`;
}
