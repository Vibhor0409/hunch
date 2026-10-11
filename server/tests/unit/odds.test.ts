import { describe, expect, it } from "vitest";
import { revealPcts } from "../../app/api/_lib/odds";

describe("revealPcts", () => {
  it("normalizes buy prices that include the spread (77 + 54) to 59 / 41", () => {
    expect(revealPcts(0.77, 0.54, "yes")).toEqual({ yesPct: 59, noPct: 41, sidedWithPct: 59 });
    expect(revealPcts(0.77, 0.54, "no")).toEqual({ yesPct: 59, noPct: 41, sidedWithPct: 41 });
  });

  it("sums to 100 for every price pair on the 0.01 grid", () => {
    for (let yes = 1; yes <= 99; yes++) {
      for (let no = 1; no <= 99; no++) {
        const r = revealPcts(yes / 100, no / 100, "yes");
        expect(r.yesPct + r.noPct).toBe(100);
        expect(r.yesPct).toBeGreaterThanOrEqual(0);
        expect(r.yesPct).toBeLessThanOrEqual(100);
      }
    }
  });

  it("falls back to 50 / 50 when the total is zero, negative or not a number", () => {
    expect(revealPcts(0, 0, "yes")).toEqual({ yesPct: 50, noPct: 50, sidedWithPct: 50 });
    expect(revealPcts(-0.3, 0.1, "no")).toEqual({ yesPct: 50, noPct: 50, sidedWithPct: 50 });
    expect(revealPcts(Number.NaN, 0.4, "yes")).toEqual({ yesPct: 50, noPct: 50, sidedWithPct: 50 });
  });

  it("rounds to whole percentages and never changes a fair 50 / 50", () => {
    expect(revealPcts(0.5, 0.5, "yes")).toEqual({ yesPct: 50, noPct: 50, sidedWithPct: 50 });
    expect(revealPcts(0.12, 0.92, "yes")).toEqual({ yesPct: 12, noPct: 88, sidedWithPct: 12 });
  });
});
