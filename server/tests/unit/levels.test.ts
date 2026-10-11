import { describe, expect, it } from "vitest";
import { LEVELS, capFor, levelFor, progressFor, stakeFor } from "../../lib/game/levels";

/** n settled calls, each with the same edge. */
function calls(n: number, edge: number): { edge: number }[] {
  return Array.from({ length: n }, () => ({ edge }));
}

describe("LEVELS table", () => {
  it("matches the F5 table", () => {
    expect(LEVELS).toEqual([
      { level: 1, cap: 10, stake: 1, minCalls: 0, minAvgEdge: null, strictAvg: false },
      { level: 2, cap: 15, stake: 2, minCalls: 10, minAvgEdge: 0, strictAvg: true },
      { level: 3, cap: 20, stake: 3, minCalls: 25, minAvgEdge: 0.5, strictAvg: false },
      { level: 4, cap: 25, stake: 5, minCalls: 50, minAvgEdge: 1.0, strictAvg: false },
    ]);
  });
});

describe("capFor and stakeFor", () => {
  it("returns the daily cap for each level", () => {
    expect(capFor(1)).toBe(10);
    expect(capFor(2)).toBe(15);
    expect(capFor(3)).toBe(20);
    expect(capFor(4)).toBe(25);
  });

  it("returns the stake per swipe for each level", () => {
    expect(stakeFor(1)).toBe(1);
    expect(stakeFor(2)).toBe(2);
    expect(stakeFor(3)).toBe(3);
    expect(stakeFor(4)).toBe(5);
  });
});

describe("levelFor", () => {
  it("starts at level 1 with no settled calls", () => {
    expect(levelFor([])).toBe(1);
  });

  it("stays at level 1 with fewer than 10 settled calls, whatever the edge", () => {
    expect(levelFor(calls(9, 5))).toBe(1);
    expect(levelFor(calls(1, 9.9))).toBe(1);
  });

  it("reaches level 2 with 10 settled calls and average Edge above 0", () => {
    expect(levelFor(calls(10, 0.1))).toBe(2);
    expect(levelFor(calls(10, 3))).toBe(2);
  });

  it("stays at level 1 with 10 settled calls and average Edge of exactly 0", () => {
    expect(levelFor(calls(10, 0))).toBe(1);
    expect(levelFor([...calls(5, 1), ...calls(5, -1)])).toBe(1);
  });

  it("reaches level 3 with 25 settled calls and average Edge of 0.5 or more", () => {
    expect(levelFor(calls(25, 0.5))).toBe(3);
    expect(levelFor(calls(25, 2))).toBe(3);
  });

  it("stays at level 2 with 25 settled calls and average Edge below 0.5", () => {
    expect(levelFor(calls(25, 0.4))).toBe(2);
  });

  it("stays at level 2 with fewer than 25 calls even with a high average", () => {
    expect(levelFor(calls(24, 5))).toBe(2);
  });

  it("reaches level 4 with 50 settled calls and average Edge of 1.0 or more", () => {
    expect(levelFor(calls(50, 1))).toBe(4);
    expect(levelFor(calls(50, 4.2))).toBe(4);
  });

  it("stays at level 3 with 50 settled calls and average Edge below 1.0", () => {
    expect(levelFor(calls(50, 0.9))).toBe(3);
  });

  it("stays at level 3 with fewer than 50 calls even with a high average", () => {
    expect(levelFor(calls(49, 5))).toBe(3);
  });

  it("caps at level 4", () => {
    expect(levelFor(calls(200, 9))).toBe(4);
  });

  it("uses the average, not the total, for thresholds", () => {
    // 25 calls: 24 at 0 and one big win. Total 10, average 0.4, below 0.5.
    expect(levelFor([...calls(24, 0), { edge: 10 }])).toBe(2);
    // 10 calls: total 0.1 is enough for a positive average.
    expect(levelFor([...calls(9, 0), { edge: 0.1 }])).toBe(2);
  });

  it("drops one level when the last 10 settled edges sum to a negative number", () => {
    // 40 strong calls then 10 small losses: average 2.38, base level 4, demoted to 3.
    expect(levelFor([...calls(40, 3), ...calls(10, -0.1)])).toBe(3);
    // 20 strong calls then 10 losses: n = 30, average 1.8, base level 3, demoted to 2.
    expect(levelFor([...calls(20, 3), ...calls(10, -0.3)])).toBe(2);
    // 10 wins then 10 losses: n = 20, average 1, base level 2, demoted to 1.
    expect(levelFor([...calls(10, 3), ...calls(10, -1)])).toBe(1);
  });

  it("only looks at the last 10 for demotion", () => {
    // Losses older than the last 10 do not demote.
    expect(levelFor([...calls(10, -5), ...calls(40, 3)])).toBe(4);
    // A single loss among the last 10 does not demote if the window still sums positive.
    expect(levelFor([...calls(49, 3), { edge: -2 }])).toBe(4);
  });

  it("treats a last-10 window with mixed signs by its sum", () => {
    // Last 10: nine wins of 0.1 and one loss of 1.0 sums to -0.1.
    expect(levelFor([...calls(40, 3), ...calls(9, 0.1), { edge: -1 }])).toBe(3);
    // Last 10: nine wins of 0.2 and one loss of 1.0 sums to +0.8.
    expect(levelFor([...calls(40, 3), ...calls(9, 0.2), { edge: -1 }])).toBe(4);
  });

  it("does not demote when the last 10 sum to exactly zero, even with float noise", () => {
    // 0.3 - 0.1 - 0.2 is -2.7e-17 in naive double arithmetic. Edges are stored
    // with one decimal, so the sum must be treated as exactly zero.
    const noisy = [{ edge: 0.3 }, { edge: -0.1 }, { edge: -0.2 }, ...calls(7, 0)];
    expect(levelFor([...calls(5, 5), ...noisy])).toBe(2);
  });

  it("never drops below level 1", () => {
    expect(levelFor(calls(5, -1))).toBe(1);
    expect(levelFor(calls(10, -3))).toBe(1);
    expect(levelFor(calls(100, -1))).toBe(1);
  });

  it("applies demotion to a window shorter than 10 when the player has fewer calls", () => {
    expect(levelFor(calls(3, -0.5))).toBe(1);
  });
});

describe("progressFor", () => {
  const RULE = "Lose your edge, lose the level.";

  it("describes a brand new player", () => {
    expect(progressFor([])).toEqual({
      level: 1,
      nextLevel: 2,
      settledCalls: 0,
      callsNeeded: 10,
      avgEdge: 0,
      avgEdgeNeeded: 0,
      rule: RULE,
    });
  });

  it("reports progress toward level 2", () => {
    const p = progressFor([...calls(4, 1), ...calls(2, -0.5)]);
    expect(p.level).toBe(1);
    expect(p.nextLevel).toBe(2);
    expect(p.settledCalls).toBe(6);
    expect(p.callsNeeded).toBe(10);
    expect(p.avgEdge).toBeCloseTo(0.5, 10);
    expect(p.avgEdgeNeeded).toBe(0);
    expect(p.rule).toBe(RULE);
  });

  it("reports progress toward level 3", () => {
    const p = progressFor(calls(12, 0.3));
    expect(p.level).toBe(2);
    expect(p.nextLevel).toBe(3);
    expect(p.settledCalls).toBe(12);
    expect(p.callsNeeded).toBe(25);
    expect(p.avgEdge).toBeCloseTo(0.3, 10);
    expect(p.avgEdgeNeeded).toBe(0.5);
  });

  it("reports progress toward level 4", () => {
    const p = progressFor(calls(30, 0.8));
    expect(p.level).toBe(3);
    expect(p.nextLevel).toBe(4);
    expect(p.callsNeeded).toBe(50);
    expect(p.avgEdgeNeeded).toBe(1);
  });

  it("has no next level at the ceiling", () => {
    const p = progressFor(calls(60, 2));
    expect(p.level).toBe(4);
    expect(p.nextLevel).toBeNull();
    expect(p.callsNeeded).toBeNull();
    expect(p.avgEdgeNeeded).toBeNull();
    expect(p.settledCalls).toBe(60);
    expect(p.avgEdge).toBe(2);
    expect(p.rule).toBe(RULE);
  });

  it("reflects a demotion in the level and the next level", () => {
    const p = progressFor([...calls(40, 3), ...calls(10, -0.1)]);
    expect(p.level).toBe(3);
    expect(p.nextLevel).toBe(4);
    expect(p.callsNeeded).toBe(50);
    expect(p.avgEdgeNeeded).toBe(1);
  });

  it("never reports negative zero for the average", () => {
    const p = progressFor([{ edge: 0.3 }, { edge: -0.1 }, { edge: -0.2 }]);
    expect(Object.is(p.avgEdge, -0)).toBe(false);
    expect(p.avgEdge).toBe(0);
  });
});
