import { describe, expect, it } from "vitest";
import { FRACTIONAL_CONTRACTS, contractsFor, edgeFor, pct } from "../../lib/game/scoring";

describe("FRACTIONAL_CONTRACTS", () => {
  it("defaults to fractional contracts", () => {
    expect(FRACTIONAL_CONTRACTS).toBe(true);
  });
});

describe("edgeFor", () => {
  it("rewards a right call at p = 0.26 with 10 x (1 - p)", () => {
    expect(edgeFor(0.26, true)).toBe(7.4);
  });

  it("charges a wrong call at p = 0.26 with -10 x p", () => {
    expect(edgeFor(0.26, false)).toBe(-2.6);
  });

  it("rewards a right call at p = 0.74 with 10 x (1 - p)", () => {
    expect(edgeFor(0.74, true)).toBe(2.6);
  });

  it("charges a wrong call at p = 0.74 with -10 x p", () => {
    expect(edgeFor(0.74, false)).toBe(-7.4);
  });

  it("rounds to one decimal", () => {
    expect(edgeFor(0.333, true)).toBe(6.7);
    expect(edgeFor(0.333, false)).toBe(-3.3);
    expect(edgeFor(0.35, true)).toBe(6.5);
    expect(edgeFor(0.123, false)).toBe(-1.2);
  });

  it("is symmetric: right plus wrong at the same price sums to 10 x (1 - 2p)", () => {
    expect(edgeFor(0.5, true)).toBe(5);
    expect(edgeFor(0.5, false)).toBe(-5);
  });

  it("never returns negative zero", () => {
    expect(Object.is(edgeFor(0, false), -0)).toBe(false);
    expect(edgeFor(0, false)).toBe(0);
    expect(edgeFor(1, true)).toBe(0);
  });
});

describe("contractsFor", () => {
  it("buys 1.35 fractional contracts for $1 at 0.74", () => {
    expect(contractsFor(1, 0.74)).toBe(1.35);
  });

  it("buys 3.84 fractional contracts for $1 at 0.26", () => {
    expect(contractsFor(1, 0.26)).toBe(3.84);
  });

  it("buys 1 whole contract for $1 at 0.74", () => {
    expect(contractsFor(1, 0.74, false)).toBe(1);
  });

  it("buys 3 whole contracts for $1 at 0.26", () => {
    expect(contractsFor(1, 0.26, false)).toBe(3);
  });

  it("uses FRACTIONAL_CONTRACTS as the default mode", () => {
    expect(contractsFor(1, 0.74)).toBe(contractsFor(1, 0.74, FRACTIONAL_CONTRACTS));
  });

  it("never costs more than the stake in fractional mode", () => {
    const stakes = [1, 2, 3, 5];
    for (const stake of stakes) {
      for (let cents = 1; cents <= 99; cents++) {
        const price = cents / 100;
        const contracts = contractsFor(stake, price);
        expect(contracts * price).toBeLessThanOrEqual(stake + 1e-9);
        // At most two decimals, as the order quantity string requires.
        expect(Math.abs(contracts * 100 - Math.round(contracts * 100))).toBeLessThan(1e-9);
      }
    }
  });

  it("buys an exact whole number when the price divides the stake", () => {
    expect(contractsFor(1, 0.5)).toBe(2);
    expect(contractsFor(1, 0.25)).toBe(4);
    expect(contractsFor(1, 0.2)).toBe(5);
    expect(contractsFor(2, 0.05)).toBe(40);
    expect(contractsFor(3, 0.06)).toBe(50);
    expect(contractsFor(1, 0.5, false)).toBe(2);
    expect(contractsFor(3, 0.06, false)).toBe(50);
  });

  it("scales with the stake", () => {
    expect(contractsFor(2, 0.74)).toBe(2.7);
    expect(contractsFor(5, 0.74)).toBe(6.75);
    expect(contractsFor(5, 0.26, false)).toBe(19);
  });

  it("whole mode never returns fewer than 1 contract", () => {
    expect(contractsFor(1, 0.99, false)).toBe(1);
    expect(contractsFor(1, 0.74, false)).toBe(1);
  });

  it("returns 0 when the price is zero or negative", () => {
    expect(contractsFor(1, 0)).toBe(0);
    expect(contractsFor(1, -0.5)).toBe(0);
    expect(contractsFor(1, 0, false)).toBe(0);
    expect(contractsFor(1, -0.5, false)).toBe(0);
  });

  it("returns 0 for a non-finite price or stake", () => {
    expect(contractsFor(1, Number.NaN)).toBe(0);
    expect(contractsFor(Number.NaN, 0.5)).toBe(0);
    expect(contractsFor(1, Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe("pct", () => {
  it("rounds a probability to a whole percentage", () => {
    expect(pct(0.74)).toBe(74);
    expect(pct(0.26)).toBe(26);
    expect(pct(0.5)).toBe(50);
    expect(pct(0.004)).toBe(0);
    expect(pct(0.006)).toBe(1);
    expect(pct(0.996)).toBe(100);
  });

  it("stays within 0 to 100", () => {
    expect(pct(0)).toBe(0);
    expect(pct(1)).toBe(100);
    expect(pct(-0.2)).toBe(0);
    expect(pct(1.2)).toBe(100);
  });

  it("never returns negative zero", () => {
    expect(Object.is(pct(-0.001), -0)).toBe(false);
  });
});
