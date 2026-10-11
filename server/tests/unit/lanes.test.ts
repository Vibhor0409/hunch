import { describe, expect, it } from "vitest";
import { laneFor, mixForYou } from "../../lib/game/lanes";
import type { CardPublic } from "../../lib/types";

const NOW = new Date("2026-10-11T18:00:00.000Z");
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

function at(offsetMs: number): string {
  return new Date(NOW.getTime() + offsetMs).toISOString();
}

describe("laneFor", () => {
  it("is live within 60 minutes", () => {
    expect(laneFor(at(1 * MIN), NOW)).toBe("live");
    expect(laneFor(at(59 * MIN), NOW)).toBe("live");
    expect(laneFor(at(60 * MIN), NOW)).toBe("live");
  });

  it("is tomorrow between 60 minutes and 48 hours", () => {
    expect(laneFor(at(61 * MIN), NOW)).toBe("tomorrow");
    expect(laneFor(at(47 * HOUR), NOW)).toBe("tomorrow");
    expect(laneFor(at(48 * HOUR), NOW)).toBe("tomorrow");
  });

  it("is week between 48 hours and 7 days", () => {
    expect(laneFor(at(49 * HOUR), NOW)).toBe("week");
    expect(laneFor(at(7 * DAY), NOW)).toBe("week");
  });

  it("is null beyond 7 days", () => {
    expect(laneFor(at(7 * DAY + 1), NOW)).toBeNull();
    expect(laneFor(at(8 * DAY), NOW)).toBeNull();
  });

  it("is null when expired or expiring right now", () => {
    expect(laneFor(at(0), NOW)).toBeNull();
    expect(laneFor(at(-1 * MIN), NOW)).toBeNull();
    expect(laneFor(at(-3 * DAY), NOW)).toBeNull();
  });

  it("is null for an unparseable timestamp", () => {
    expect(laneFor("not a date", NOW)).toBeNull();
    expect(laneFor("", NOW)).toBeNull();
  });
});

function card(id: string, lane: CardPublic["lane"]): CardPublic {
  return {
    eventTicker: `EVT-${id}`,
    instrumentSymbol: id,
    question: `Question ${id}?`,
    category: "test",
    lane,
    expiresAt: at(HOUR),
  };
}

const ids = (cards: CardPublic[]) => cards.map((c) => c.instrumentSymbol);

describe("mixForYou", () => {
  it("returns the original order when there are no live cards", () => {
    const cards = [card("a", "tomorrow"), card("b", "week"), card("c", "tomorrow"), card("d", "week")];
    expect(ids(mixForYou(cards))).toEqual(["a", "b", "c", "d"]);
  });

  it("places a live card at every third slot (positions 2, 5, 8)", () => {
    const cards = [
      card("L1", "live"),
      card("o1", "tomorrow"),
      card("o2", "week"),
      card("L2", "live"),
      card("o3", "tomorrow"),
      card("o4", "week"),
      card("o5", "tomorrow"),
      card("L3", "live"),
      card("o6", "week"),
    ];
    const mixed = mixForYou(cards);
    expect(ids(mixed)).toEqual(["o1", "o2", "L1", "o3", "o4", "L2", "o5", "o6", "L3"]);
    expect(mixed[2].lane).toBe("live");
    expect(mixed[5].lane).toBe("live");
    expect(mixed[8].lane).toBe("live");
  });

  it("appends the remaining non-live cards when live cards run out", () => {
    const cards = [card("L1", "live"), card("o1", "week"), card("o2", "week"), card("o3", "week"), card("o4", "week"), card("o5", "week")];
    expect(ids(mixForYou(cards))).toEqual(["o1", "o2", "L1", "o3", "o4", "o5"]);
  });

  it("appends the remaining live cards when non-live cards run out", () => {
    const cards = [card("o1", "week"), card("L1", "live"), card("L2", "live"), card("L3", "live"), card("L4", "live")];
    expect(ids(mixForYou(cards))).toEqual(["o1", "L1", "L2", "L3", "L4"]);
  });

  it("never drops or duplicates cards", () => {
    const cards = [card("L1", "live"), card("o1", "week"), card("L2", "live"), card("L3", "live"), card("o2", "tomorrow"), card("o3", "week"), card("o4", "week")];
    const mixed = mixForYou(cards);
    expect(mixed).toHaveLength(cards.length);
    expect([...ids(mixed)].sort()).toEqual([...ids(cards)].sort());
  });

  it("keeps the relative order within each group", () => {
    const cards = [card("L1", "live"), card("o1", "week"), card("L2", "live"), card("o2", "week"), card("L3", "live"), card("o3", "week"), card("o4", "week")];
    const mixed = mixForYou(cards);
    const lives = mixed.filter((c) => c.lane === "live");
    const others = mixed.filter((c) => c.lane !== "live");
    expect(ids(lives)).toEqual(["L1", "L2", "L3"]);
    expect(ids(others)).toEqual(["o1", "o2", "o3", "o4"]);
  });

  it("returns only live cards unchanged when every card is live", () => {
    const cards = [card("L1", "live"), card("L2", "live"), card("L3", "live")];
    expect(ids(mixForYou(cards))).toEqual(["L1", "L2", "L3"]);
  });

  it("handles an empty deck", () => {
    expect(mixForYou([])).toEqual([]);
  });

  it("does not mutate the input array", () => {
    const cards = [card("L1", "live"), card("o1", "week"), card("o2", "week")];
    const before = ids(cards);
    mixForYou(cards);
    expect(ids(cards)).toEqual(before);
  });
});
