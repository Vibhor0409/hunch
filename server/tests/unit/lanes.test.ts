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

  it("is later between 7 days and 365 days", () => {
    expect(laneFor(at(7 * DAY + 1), NOW)).toBe("later");
    expect(laneFor(at(8 * DAY), NOW)).toBe("later");
    expect(laneFor(at(30 * DAY), NOW)).toBe("later");
    expect(laneFor(at(365 * DAY), NOW)).toBe("later");
  });

  it("is null beyond 365 days", () => {
    expect(laneFor(at(365 * DAY + 1), NOW)).toBeNull();
    expect(laneFor(at(400 * DAY), NOW)).toBeNull();
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

function card(id: string, lane: CardPublic["lane"], category = "test"): CardPublic {
  return {
    eventTicker: `EVT-${id}`,
    instrumentSymbol: id,
    question: `Question ${id}?`,
    category,
    lane,
    expiresAt: at(HOUR),
    tradable: true,
  };
}

const ids = (cards: CardPublic[]) => cards.map((c) => c.instrumentSymbol);

/** Positions where two neighbours share a category. */
function adjacentRepeats(cards: CardPublic[]): number[] {
  const repeats: number[] = [];
  for (let i = 1; i < cards.length; i++) {
    if (cards[i].category === cards[i - 1].category) repeats.push(i);
  }
  return repeats;
}

describe("mixForYou: lane rule", () => {
  it("returns the original order when there are no live cards and one category", () => {
    const cards = [card("a", "tomorrow"), card("b", "week"), card("c", "later"), card("d", "week")];
    expect(ids(mixForYou(cards))).toEqual(["a", "b", "c", "d"]);
  });

  it("places a live card at every third slot (positions 2, 5, 8)", () => {
    const cards = [
      card("L1", "live"),
      card("o1", "tomorrow"),
      card("o2", "week"),
      card("L2", "live"),
      card("o3", "tomorrow"),
      card("o4", "later"),
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
    const cards = [card("L1", "live"), card("o1", "week"), card("L2", "live"), card("L3", "live"), card("o2", "tomorrow"), card("o3", "week"), card("o4", "later")];
    const mixed = mixForYou(cards);
    expect(mixed).toHaveLength(cards.length);
    expect([...ids(mixed)].sort()).toEqual([...ids(cards)].sort());
  });

  it("keeps the relative order within each group when categories match", () => {
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

  it("does not mutate the input array or its cards", () => {
    const cards = [card("L1", "live", "crypto"), card("o1", "week", "crypto"), card("o2", "week", "sports")];
    const before = JSON.stringify(cards);
    mixForYou(cards);
    expect(JSON.stringify(cards)).toBe(before);
  });
});

describe("mixForYou: category rule", () => {
  it("separates same-category neighbours when no live cards exist", () => {
    const cards = [card("a", "week", "crypto"), card("b", "week", "crypto"), card("c", "tomorrow", "sports"), card("d", "later", "sports")];
    const mixed = mixForYou(cards);
    expect(ids(mixed)).toEqual(["a", "c", "b", "d"]);
    expect(adjacentRepeats(mixed)).toEqual([]);
  });

  it("prefers the earliest card of a different category", () => {
    const cards = [
      card("a", "week", "crypto"),
      card("b", "week", "crypto"),
      card("c", "week", "politics"),
      card("d", "week", "sports"),
      card("e", "week", "sports"),
    ];
    // a (crypto), then the earliest non-crypto is c (politics), then the
    // earliest non-politics is b (crypto), then d (sports), then e is forced.
    expect(ids(mixForYou(cards))).toEqual(["a", "c", "b", "d", "e"]);
  });

  it("falls back to the earliest card when every remaining card shares the category", () => {
    const uniform = [card("a", "week", "crypto"), card("b", "week", "crypto"), card("c", "week", "crypto")];
    expect(ids(mixForYou(uniform))).toEqual(["a", "b", "c"]);

    const tail = [card("a", "week", "crypto"), card("b", "week", "sports"), card("c", "week", "crypto"), card("d", "week", "crypto"), card("e", "week", "crypto")];
    const mixed = mixForYou(tail);
    expect(ids(mixed)).toEqual(["a", "b", "c", "d", "e"]);
    // Only the unavoidable repeats at the end remain.
    expect(adjacentRepeats(mixed)).toEqual([3, 4]);
  });

  it("applies the category rule inside both pools while keeping live cards every third slot", () => {
    const cards = [
      card("o1", "week", "crypto"),
      card("L1", "live", "crypto"),
      card("o2", "week", "crypto"),
      card("o3", "tomorrow", "sports"),
      card("L2", "live", "sports"),
      card("o4", "later", "sports"),
    ];
    const mixed = mixForYou(cards);
    // Slot 0 o1 (crypto); slot 1 first non-crypto other o3 (sports); slot 2 is
    // live and the first non-sports live is L1 (crypto); slot 3 first non-crypto
    // other o4 (sports); slot 4 o2 (crypto); slot 5 is live, L2 (sports).
    expect(ids(mixed)).toEqual(["o1", "o3", "L1", "o4", "o2", "L2"]);
    expect(mixed[2].lane).toBe("live");
    expect(mixed[5].lane).toBe("live");
    expect(adjacentRepeats(mixed)).toEqual([]);
  });

  it("lets the lane rule win when the only live card repeats the category", () => {
    const cards = [card("o1", "week", "crypto"), card("o2", "week", "sports"), card("o3", "week", "crypto"), card("L1", "live", "sports")];
    const mixed = mixForYou(cards);
    // Slot 2 must be live even though L1 shares a category with o2.
    expect(ids(mixed)).toEqual(["o1", "o2", "L1", "o3"]);
    expect(mixed[2].lane).toBe("live");
    expect(adjacentRepeats(mixed)).toEqual([2]);
  });

  it("picks a different-category live card for a live slot when one exists", () => {
    const cards = [card("o1", "week", "crypto"), card("o2", "week", "sports"), card("L1", "live", "sports"), card("L2", "live", "crypto"), card("o3", "week", "politics")];
    const mixed = mixForYou(cards);
    // Slot 2 is live; L1 repeats sports so L2 (crypto) goes first. L1 then
    // fills the last slot once the other pool is empty.
    expect(ids(mixed)).toEqual(["o1", "o2", "L2", "o3", "L1"]);
    expect(adjacentRepeats(mixed)).toEqual([]);
  });

  it("keeps the deck complete when categories are shuffled across lanes", () => {
    const cards = [
      card("L1", "live", "a"),
      card("o1", "week", "a"),
      card("L2", "live", "b"),
      card("o2", "tomorrow", "a"),
      card("o3", "later", "b"),
      card("L3", "live", "a"),
      card("o4", "week", "c"),
      card("o5", "week", "c"),
    ];
    const mixed = mixForYou(cards);
    expect(mixed).toHaveLength(cards.length);
    expect([...ids(mixed)].sort()).toEqual([...ids(cards)].sort());
    expect(mixed[2].lane).toBe("live");
    expect(mixed[5].lane).toBe("live");
  });
});
