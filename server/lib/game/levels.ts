import type { LevelProgress } from "../types";

export type Level = 1 | 2 | 3 | 4;

/** One row of the SPEC F5 level table. */
export interface LevelRule {
  level: Level;
  /** Paid swipes per LA day. */
  cap: number;
  /** Dollars per paid swipe. */
  stake: number;
  /** Settled calls required (practice swipes count). */
  minCalls: number;
  /** Average Edge required, or null when there is no Edge requirement. */
  minAvgEdge: number | null;
  /** True when the average must be strictly above minAvgEdge. */
  strictAvg: boolean;
}

/** SPEC F5 table, ascending. Level 4 is the ceiling. */
export const LEVELS: readonly LevelRule[] = [
  { level: 1, cap: 10, stake: 1, minCalls: 0, minAvgEdge: null, strictAvg: false },
  { level: 2, cap: 15, stake: 2, minCalls: 10, minAvgEdge: 0, strictAvg: true },
  { level: 3, cap: 20, stake: 3, minCalls: 25, minAvgEdge: 0.5, strictAvg: false },
  { level: 4, cap: 25, stake: 5, minCalls: 50, minAvgEdge: 1.0, strictAvg: false },
];

/** Rule text shown under the level bar (SPEC F5). */
export const LEVEL_RULE = "Lose your edge, lose the level.";

/** How many of the most recent settled calls the demotion rule looks at. */
export const DEMOTION_WINDOW = 10;

type Settled = readonly { edge: number }[];

/**
 * Edges are stored with one decimal. Summing them as integer tenths keeps
 * sums exact, so 0.3 - 0.1 - 0.2 is 0 and not -2.7e-17, which would otherwise
 * trigger a demotion.
 */
function tenths(edge: number): number {
  return Math.round(edge * 10);
}

function sumTenths(settled: Settled): number {
  let total = 0;
  for (const call of settled) total += tenths(call.edge);
  return total;
}

function ruleFor(level: Level): LevelRule {
  return LEVELS.find((rule) => rule.level === level) ?? LEVELS[0];
}

function qualifies(rule: LevelRule, calls: number, avgEdge: number): boolean {
  if (calls < rule.minCalls) return false;
  if (rule.minAvgEdge === null) return true;
  return rule.strictAvg ? avgEdge > rule.minAvgEdge : avgEdge >= rule.minAvgEdge;
}

/** Average Edge over all settled calls; 0 when there are none. Never negative zero. */
export function averageEdge(settled: Settled): number {
  if (settled.length === 0) return 0;
  const avg = sumTenths(settled) / (10 * settled.length);
  return avg === 0 ? 0 : avg;
}

/**
 * Level from the F5 table (count and average Edge over every settled call,
 * oldest first), then the demotion rule: when the Edge over the last 10
 * settled calls sums to a negative number, drop one level, never below 1.
 */
export function levelFor(settled: Settled): Level {
  const calls = settled.length;
  const avg = averageEdge(settled);

  let level: Level = 1;
  for (const rule of LEVELS) {
    if (qualifies(rule, calls, avg)) level = rule.level;
  }

  const recent = sumTenths(settled.slice(-DEMOTION_WINDOW));
  if (recent < 0 && level > 1) level = (level - 1) as Level;
  return level;
}

/** Paid swipes per LA day at a level. */
export function capFor(level: Level): number {
  return ruleFor(level).cap;
}

/** Dollars per paid swipe at a level. */
export function stakeFor(level: Level): number {
  return ruleFor(level).stake;
}

/**
 * Level bar data for the Me tab. callsNeeded and avgEdgeNeeded are the next
 * level's thresholds from the table (null at the ceiling). For level 2 the
 * average must be strictly above avgEdgeNeeded (0); for 3 and 4 it may equal it.
 */
export function progressFor(settled: Settled): LevelProgress {
  const level = levelFor(settled);
  const next = level < 4 ? ruleFor((level + 1) as Level) : null;
  return {
    level,
    nextLevel: next ? (next.level as 2 | 3 | 4) : null,
    settledCalls: settled.length,
    callsNeeded: next ? next.minCalls : null,
    avgEdge: averageEdge(settled),
    avgEdgeNeeded: next ? next.minAvgEdge : null,
    rule: LEVEL_RULE,
  };
}
