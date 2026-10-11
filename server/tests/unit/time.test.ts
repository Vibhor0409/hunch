import { describe, expect, it } from "vitest";
import { laDayBounds } from "../../lib/game/time";

const HOUR = 3_600_000;

function span(bounds: { startIso: string; endIso: string }): number {
  return new Date(bounds.endIso).getTime() - new Date(bounds.startIso).getTime();
}

describe("laDayBounds", () => {
  it("uses the LA calendar day when UTC is already on the next day (PDT)", () => {
    // 2026-10-11 05:30 UTC is 2026-10-10 22:30 PDT.
    const b = laDayBounds(new Date("2026-10-11T05:30:00.000Z"));
    expect(b.startIso).toBe("2026-10-10T07:00:00.000Z");
    expect(b.endIso).toBe("2026-10-11T07:00:00.000Z");
  });

  it("moves to the next LA day once LA midnight has passed", () => {
    // 2026-10-11 08:00 UTC is 2026-10-11 01:00 PDT.
    const b = laDayBounds(new Date("2026-10-11T08:00:00.000Z"));
    expect(b.startIso).toBe("2026-10-11T07:00:00.000Z");
    expect(b.endIso).toBe("2026-10-12T07:00:00.000Z");
  });

  it("treats LA midnight itself as the start of the new day", () => {
    const b = laDayBounds(new Date("2026-10-11T07:00:00.000Z"));
    expect(b.startIso).toBe("2026-10-11T07:00:00.000Z");
    expect(b.endIso).toBe("2026-10-12T07:00:00.000Z");
  });

  it("treats the last millisecond before LA midnight as the previous day", () => {
    const b = laDayBounds(new Date("2026-10-11T06:59:59.999Z"));
    expect(b.startIso).toBe("2026-10-10T07:00:00.000Z");
    expect(b.endIso).toBe("2026-10-11T07:00:00.000Z");
  });

  it("uses an 8 hour offset in winter (PST)", () => {
    const b = laDayBounds(new Date("2026-01-15T12:00:00.000Z"));
    expect(b.startIso).toBe("2026-01-15T08:00:00.000Z");
    expect(b.endIso).toBe("2026-01-16T08:00:00.000Z");
    expect(span(b)).toBe(24 * HOUR);
  });

  it("gives a 23 hour day when clocks spring forward (2026-03-08)", () => {
    // Midday PST on March 8, 2026, the day the US moves to daylight time.
    const b = laDayBounds(new Date("2026-03-08T20:00:00.000Z"));
    expect(b.startIso).toBe("2026-03-08T08:00:00.000Z");
    expect(b.endIso).toBe("2026-03-09T07:00:00.000Z");
    expect(span(b)).toBe(23 * HOUR);
  });

  it("gives a 25 hour day when clocks fall back (2026-11-01)", () => {
    const b = laDayBounds(new Date("2026-11-01T20:00:00.000Z"));
    expect(b.startIso).toBe("2026-11-01T07:00:00.000Z");
    expect(b.endIso).toBe("2026-11-02T08:00:00.000Z");
    expect(span(b)).toBe(25 * HOUR);
  });

  it("handles the day before a spring-forward transition", () => {
    const b = laDayBounds(new Date("2026-03-08T07:59:59.000Z"));
    expect(b.startIso).toBe("2026-03-07T08:00:00.000Z");
    expect(b.endIso).toBe("2026-03-08T08:00:00.000Z");
  });

  it("handles month and year boundaries", () => {
    // 2026-01-01 03:00 UTC is still 2025-12-31 19:00 PST.
    const b = laDayBounds(new Date("2026-01-01T03:00:00.000Z"));
    expect(b.startIso).toBe("2025-12-31T08:00:00.000Z");
    expect(b.endIso).toBe("2026-01-01T08:00:00.000Z");
  });

  it("returns a half-open interval that contains now", () => {
    const samples = [
      "2026-10-11T05:30:00.000Z",
      "2026-10-11T07:00:00.000Z",
      "2026-03-08T10:30:00.000Z",
      "2026-11-01T09:30:00.000Z",
      "2026-11-02T07:30:00.000Z",
    ];
    for (const iso of samples) {
      const now = new Date(iso);
      const b = laDayBounds(now);
      const start = new Date(b.startIso).getTime();
      const end = new Date(b.endIso).getTime();
      expect(start).toBeLessThanOrEqual(now.getTime());
      expect(end).toBeGreaterThan(now.getTime());
    }
  });

  it("returns ISO strings with millisecond precision in UTC", () => {
    const b = laDayBounds(new Date("2026-10-11T18:00:00.000Z"));
    expect(b.startIso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(b.endIso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });
});
