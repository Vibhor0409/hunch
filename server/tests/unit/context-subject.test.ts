import { describe, expect, it } from "vitest";
import { broadQueryFor } from "../../lib/context/client";
import { subjectFor } from "../../lib/context/subject";

// The ten real card questions from the live production check on 2026-10-11
// (seven had no context, three had), with the subject each should search on.
const REAL: readonly (readonly [question: string, subject: string])[] = [
  ["Big Brother Season 28 winner: Rick Devens?", "Big Brother Season 28 winner"],
  ["SOL price today at 7:50pm EDT: Up from $111.15?", "Solana price today"],
  ["XRP price today at 7:50pm EDT: Up from $1.41?", "XRP price today"],
  ["When will Stripe announce an IPO: Before Nov 1, 2026?", "When will Stripe announce an IPO"],
  ["Highest temperature in Austin on October 11, 2026: 92°F to 93°F?", "Highest temperature in Austin on October 11, 2026"],
  ["Best AI at the end of 2026: Claude?", "Best AI at the end of 2026"],
  ["Santos Laguna vs Atlético San Luis: Atlético San Luis?", "Santos Laguna vs Atlético San Luis"],
  ["Copper price on October 12: $6.7 or above?", "Copper price on October 12"],
  ["Athletic vs Rayo: Rayo?", "Athletic vs Rayo"],
  ["Fed decision in October: Fed maintains rate?", "Fed decision in October"],
];

describe("subjectFor on the ten real questions", () => {
  it.each(REAL)("%s", (question, subject) => {
    expect(subjectFor(question)).toBe(subject);
  });

  it("never keeps a clock time, a strike, a question mark or the option label", () => {
    for (const [question] of REAL) {
      const subject = subjectFor(question);
      expect(subject.length).toBeGreaterThan(0);
      expect(subject).not.toMatch(/\d\s*(?:am|pm)\b|EDT|\$|\?|:$/i);
      expect(question.startsWith(subject) || /Solana/.test(subject)).toBe(true);
    }
  });
});

describe("subjectFor with an event title", () => {
  it("prefers the title over the question", () => {
    expect(subjectFor("Athletic vs Rayo: Rayo?", "Athletic vs Rayo")).toBe("Athletic vs Rayo");
    expect(subjectFor("anything: else?", "Fed decision in October?")).toBe("Fed decision in October");
  });

  it("keeps a colon that belongs to the title", () => {
    const title = "Dune: Part Three: Rotten Tomatoes Score";
    expect(subjectFor(`${title}: Above 70?`, title)).toBe(title);
    // Without the title only the last part, the option label, goes.
    expect(subjectFor(`${title}: Above 70?`)).toBe(title);
  });

  it("removes clock times from the title and names the coin in a price market", () => {
    expect(subjectFor("SOL price today at 7:50pm EDT: Up from $111.15?", "SOL price today at 7:50pm EDT")).toBe("Solana price today");
    expect(subjectFor("BTC price today at 8pm EDT: $83,300 or above?", "BTC price today at 8pm EDT")).toBe("Bitcoin price today");
    expect(subjectFor("ETH price on October 12: $2,440 or above?", "ETH price on October 12")).toBe("Ethereum price on October 12");
    expect(subjectFor("XRP price on October 12: $1.36 or above?", "XRP price on October 12")).toBe("XRP price on October 12");
  });

  it("falls back to the question when the title is empty", () => {
    expect(subjectFor("Copper price on October 12: $6.7 or above?", "")).toBe("Copper price on October 12");
    expect(subjectFor("Copper price on October 12: $6.7 or above?", null)).toBe("Copper price on October 12");
    expect(subjectFor("Copper price on October 12: $6.7 or above?", "  ?  ")).toBe("Copper price on October 12");
  });
});

describe("subjectFor cleaning", () => {
  it("does not mistake the colon inside a clock time for the label separator", () => {
    expect(subjectFor("BTC price today at 7:50pm EDT?")).toBe("Bitcoin price today");
    expect(subjectFor("ETH price today at 6:15 PM ET: Up from $2,531.14?")).toBe("Ethereum price today");
  });

  it("removes strike fragments wherever they sit", () => {
    expect(subjectFor("Gold price on October 16 $4,125 or above?")).toBe("Gold price on October 16");
    expect(subjectFor("Will silver close above $60.5 on Friday?")).toBe("Will silver close on Friday");
    expect(subjectFor("SOL price today Up from $111.15")).toBe("Solana price today");
  });

  it("leaves a question without a label as it is, minus the question mark", () => {
    expect(subjectFor("Will GameStop acquire eBay?")).toBe("Will GameStop acquire eBay");
  });

  it("expands tickers only in price markets and only as whole words", () => {
    expect(subjectFor("SOL Strategies earnings: Beat?")).toBe("SOL Strategies earnings");
    expect(subjectFor("ETHOS price today: Up?")).toBe("ETHOS price today");
    expect(subjectFor("Solana price today: Up?")).toBe("Solana price today");
  });

  it("never returns an empty subject for a non-empty question", () => {
    expect(subjectFor("$5 or above?")).not.toBe("");
    expect(subjectFor("7:50pm EDT?")).not.toBe("");
  });
});

describe("broadQueryFor", () => {
  it("appends news and stays within the 500 character limit", () => {
    expect(broadQueryFor("  Solana  price today ")).toBe("Solana price today news");
    const query = broadQueryFor("x".repeat(600));
    expect(query.length).toBeLessThanOrEqual(500);
    expect(query.endsWith(" news")).toBe(true);
  });
});
