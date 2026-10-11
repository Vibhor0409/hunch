import { describe, expect, it } from "vitest";
import { categoryStats, insight } from "../../lib/game/profile";
import type { CategoryStat } from "../../lib/types";

type Row = { category: string; won: boolean; price: number; edge: number };

function row(category: string, won: boolean, price: number): Row {
  const edge = won ? Math.round(10 * (1 - price) * 10) / 10 : Math.round(-10 * price * 10) / 10;
  return { category, won, price, edge };
}

describe("categoryStats", () => {
  it("returns an empty list for no rows", () => {
    expect(categoryStats([])).toEqual([]);
  });

  it("aggregates one category", () => {
    const stats = categoryStats([row("crypto", true, 0.3), row("crypto", false, 0.6), row("crypto", true, 0.5)]);
    expect(stats).toHaveLength(1);
    const s = stats[0];
    expect(s.category).toBe("crypto");
    expect(s.settledCalls).toBe(3);
    expect(s.hitRate).toBeCloseTo(2 / 3, 10);
    expect(s.avgImplied).toBeCloseTo((0.3 + 0.6 + 0.5) / 3, 10);
    // Edges: +7, -6, +5 = 6.
    expect(s.edgeTotal).toBe(6);
  });

  it("groups rows by category", () => {
    const stats = categoryStats([
      row("crypto", true, 0.4),
      row("sports", false, 0.7),
      row("crypto", true, 0.6),
      row("politics", true, 0.2),
    ]);
    expect(stats.map((s) => s.category).sort()).toEqual(["crypto", "politics", "sports"]);
    const crypto = stats.find((s) => s.category === "crypto")!;
    expect(crypto.settledCalls).toBe(2);
    expect(crypto.hitRate).toBe(1);
    expect(crypto.avgImplied).toBeCloseTo(0.5, 10);
    expect(crypto.edgeTotal).toBe(10);
    const sports = stats.find((s) => s.category === "sports")!;
    expect(sports.settledCalls).toBe(1);
    expect(sports.hitRate).toBe(0);
    expect(sports.avgImplied).toBeCloseTo(0.7, 10);
    expect(sports.edgeTotal).toBe(-7);
  });

  it("sorts by total Edge descending", () => {
    const stats = categoryStats([
      row("sports", false, 0.7),
      row("crypto", true, 0.4),
      row("politics", true, 0.2),
      row("politics", false, 0.1),
    ]);
    expect(stats.map((s) => s.category)).toEqual(["politics", "crypto", "sports"]);
    expect(stats.map((s) => s.edgeTotal)).toEqual([7, 6, -7]);
  });

  it("breaks Edge ties by category name for a stable order", () => {
    const stats = categoryStats([row("zeta", true, 0.5), row("alpha", true, 0.5)]);
    expect(stats.map((s) => s.category)).toEqual(["alpha", "zeta"]);
  });

  it("sums Edge without float noise", () => {
    // 0.3 - 0.1 - 0.2 is -2.7e-17 in naive double arithmetic.
    const rows: Row[] = [
      { category: "x", won: true, price: 0.97, edge: 0.3 },
      { category: "x", won: false, price: 0.01, edge: -0.1 },
      { category: "x", won: false, price: 0.02, edge: -0.2 },
    ];
    const [s] = categoryStats(rows);
    expect(s.edgeTotal).toBe(0);
    expect(Object.is(s.edgeTotal, -0)).toBe(false);
  });

  it("keeps edgeTotal at one decimal", () => {
    const rows: Row[] = [
      { category: "x", won: true, price: 0.5, edge: 0.1 },
      { category: "x", won: true, price: 0.5, edge: 0.2 },
      { category: "x", won: true, price: 0.5, edge: 0.7 },
    ];
    expect(categoryStats(rows)[0].edgeTotal).toBe(1);
  });
});

function stat(category: string, settledCalls: number, edgeTotal: number): CategoryStat {
  return { category, settledCalls, hitRate: 0.5, avgImplied: 0.5, edgeTotal };
}

describe("insight", () => {
  it("is null with no stats", () => {
    expect(insight([])).toBeNull();
  });

  it("is null when no category has 3 settled calls", () => {
    expect(insight([stat("crypto", 2, 9), stat("sports", 2, -9), stat("politics", 1, 3)])).toBeNull();
  });

  it("is null when only one category has 3 settled calls", () => {
    expect(insight([stat("crypto", 3, 9), stat("sports", 2, -9)])).toBeNull();
    expect(insight([stat("crypto", 12, 9)])).toBeNull();
  });

  it("names the best and worst qualifying categories", () => {
    expect(insight([stat("crypto", 3, 9), stat("sports", 3, -9)])).toBe("Ahead of the market on crypto. Behind on sports.");
  });

  it("ignores categories with fewer than 3 settled calls when picking best and worst", () => {
    const stats = [
      stat("politics", 2, 50), // would be best, but does not qualify
      stat("crypto", 3, 9),
      stat("sports", 4, -2),
      stat("weather", 1, -50), // would be worst, but does not qualify
    ];
    expect(insight(stats)).toBe("Ahead of the market on crypto. Behind on sports.");
  });

  it("does not depend on the input order", () => {
    const stats = [stat("sports", 5, -4), stat("crypto", 3, 1), stat("politics", 6, 12)];
    expect(insight(stats)).toBe("Ahead of the market on politics. Behind on sports.");
    expect(insight([...stats].reverse())).toBe("Ahead of the market on politics. Behind on sports.");
  });

  it("accepts exactly 3 settled calls as qualifying", () => {
    expect(insight([stat("a", 3, 1), stat("b", 3, 0)])).toBe("Ahead of the market on a. Behind on b.");
  });

  it("works end to end from categoryStats", () => {
    const rows = [
      row("crypto", true, 0.3),
      row("crypto", true, 0.4),
      row("crypto", false, 0.5),
      row("sports", false, 0.6),
      row("sports", false, 0.7),
      row("sports", true, 0.8),
      row("politics", true, 0.1), // only one call, does not qualify
    ];
    expect(insight(categoryStats(rows))).toBe("Ahead of the market on crypto. Behind on sports.");
  });

  it("does not mutate the stats array", () => {
    const stats = [stat("sports", 5, -4), stat("crypto", 3, 1)];
    const before = stats.map((s) => s.category);
    insight(stats);
    expect(stats.map((s) => s.category)).toEqual(before);
  });
});
