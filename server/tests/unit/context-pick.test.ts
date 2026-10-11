import { describe, expect, it } from "vitest";
import sample from "../fixtures/context-search.json";
import { EXCLUDED_DOMAINS } from "../../lib/context/client";
import {
  MAX_TEXT_LENGTH,
  domainOf,
  mentionsOdds,
  pickContext,
  proseChunks,
  splitSentences,
  trimToSentences,
  type PickableResult,
} from "../../lib/context/pick";

function result(highlights: string[] | null, overrides: Partial<PickableResult> = {}): PickableResult {
  return {
    url: "https://www.example.com/story",
    title: "Example story",
    relevance: "medium",
    highlights: highlights === null ? { highlights: null } : { highlights },
    ...overrides,
  };
}

const RAIN = "Forecasters see a 40% chance of rain in Madrid on Sunday.";
const ODDS = "Kalshi traders give Spain 61% to win the final.";
const MATCH = "Spain beat France 2-1 on Tuesday night in Lyon.";

// Highlight passages copied verbatim from a real /web/search response
// (docs/samples/context-search.json as first saved on 2026-10-11). Excerpts are
// joined by "…" lines; headers sit in brackets; tables and entities appear as is.
const CME_PRICE_STRIP =
  "[Copper > Futures and Options]\n\n6.7040\n\n…\n\n+0.0120 (+0.18%)\n\n…\n\nLast Updated11 Oct 2026 05:37:58 PM CT.\n\n…\n\n[Copper > Explore this product in depth > Review contract highlights]\n\n- ##### Price Quotation\n\n…\n\n[Copper > Copper CVOL Index]\n\nLast Updated09 Oct 2026 03:44:45 PM CT";
const MARKETWATCH_TABLE =
  "[Copper Continuous Contract > $ 6.7040]\n\n6.6940 Day Range 6.7185\n\n…\n\n[Copper Continuous Contract > $ 6.7040 > No Recent Tickers]\n\n| | Last | Chg | Open | High | Low | Date/Time |\n| - | - | - | - | - | - | - |\n| Copper (NYM $/lbs) Front Month | $6.6470 | 0.0045 | $6.5345 | $6.6530 | $6.5340 | Oct 9, 2026 1:34 p.m. |";
const TRADING_ECONOMICS_PROSE =
  "[Copper Gains on Risk-On Mood]\n\nCopper futures rose toward $6.6 per pound, hovering near one-week highs amid a rally in risk assets, highlighted by gains in technology and artificial intelligence stocks.\n\n…\n\nCopper futures in the US rose past $6.61 per pound, not too far from the record high of $6.80 touched a month earlier, amid mounting threats to global supply and persistent speculative demand. The risk of import tariffs on unprocessed copper goods triggered a surge in buying to front-load deliveries. Consequently, prompt spreads on major Western exchanges surged.&#x20;";
const MINING_WITH_ODDS_WORD =
  "[Copper price firms on reduced likelihood of higher US ...]\n\nCopper $ 5.6358 / lb 2.72%\n\n…\n\n[Copper price firms on reduced likelihood of higher US interest rates]\n\nCopper rose for a second straight session on Monday as fading prospects of an increase to US interest rates and the growing likelihood of mine strikes in Chile outweighed pressure from a strong dollar.\n\n…\n\nOdds of an October US rate hike fell after weaker than expected US jobs data last week. Higher interest rates can dampen economic activity and weigh on demand for growth-dependent industrial metals such as copper.\n\n…\n\nThe cash LME copper contract was trading at a premium of nearly $73.50 a ton over the three-month forward, up from $53.50 on Friday, indicating tightening near-term supply.";

describe("mentionsOdds", () => {
  it("blocks the Kalshi traders sentence", () => {
    expect(mentionsOdds(ODDS)).toBe(true);
    expect(mentionsOdds("Traders give the plan a 30% shot.")).toBe(true);
  });

  it("blocks bettors, sportsbooks, implied probability and named markets", () => {
    expect(mentionsOdds("Bettors piled onto the favorite.")).toBe(true);
    expect(mentionsOdds("Sportsbooks moved the line overnight.")).toBe(true);
    expect(mentionsOdds("The implied probability rose to 70%.")).toBe(true);
    for (const name of ["Polymarket", "PredictIt", "Gemini", "DraftKings", "FanDuel", "BetMGM", "Caesars"]) {
      expect(mentionsOdds(`${name} listed the contract this morning.`)).toBe(true);
    }
    expect(mentionsOdds("The odds of a rate cut fell after the jobs report.")).toBe(true);
  });

  it("keeps ordinary facts with numbers", () => {
    expect(mentionsOdds(RAIN)).toBe(false);
    expect(mentionsOdds("The poll put support for the measure at 52%.")).toBe(false);
    expect(mentionsOdds("Copper rose 1.6% to $6.71 per pound on Friday.")).toBe(false);
  });
});

describe("pickContext odds filter", () => {
  it("drops the odds sentence and keeps the rest", () => {
    const picked = pickContext([result([`${ODDS} ${MATCH}`])]);
    expect(picked?.text).toBe(MATCH);
  });

  it("keeps a 40% chance of rain", () => {
    const picked = pickContext([result([RAIN])]);
    expect(picked?.text).toBe(RAIN);
  });

  it("returns null when only odds sentences remain", () => {
    expect(pickContext([result([ODDS])])).toBeNull();
    expect(pickContext([result([`${ODDS} Polymarket agrees at 60%.`])])).toBeNull();
  });
});

describe("pickContext selection", () => {
  it("skips low relevance results", () => {
    expect(pickContext([result([RAIN], { relevance: "low" })])).toBeNull();
    const picked = pickContext([result([RAIN], { relevance: "low" }), result([MATCH], { url: "https://news.example.org/a" })]);
    expect(picked?.text).toBe(MATCH);
    expect(picked?.sourceDomain).toBe("news.example.org");
  });

  it("skips results without highlights", () => {
    expect(pickContext([result(null), result([]), { url: "https://x.example.com/", relevance: "high" }])).toBeNull();
    const picked = pickContext([result(null), result([RAIN])]);
    expect(picked?.text).toBe(RAIN);
  });

  it("prefers a high relevance result over an earlier medium one", () => {
    const picked = pickContext([result([MATCH]), result([RAIN], { relevance: "high", url: "https://weather.example.com/" })]);
    expect(picked?.text).toBe(RAIN);
    expect(picked?.sourceDomain).toBe("weather.example.com");
  });

  it("keeps API order among equal relevance", () => {
    const picked = pickContext([result([MATCH]), result([RAIN])]);
    expect(picked?.text).toBe(MATCH);
  });

  it("falls through to the next result when the best one is all odds", () => {
    const picked = pickContext([result([ODDS], { relevance: "high" }), result([RAIN])]);
    expect(picked?.text).toBe(RAIN);
  });

  it("skips excluded odds domains and bad URLs", () => {
    expect(pickContext([result([RAIN], { url: "https://www.kalshi.com/markets/x" })])).toBeNull();
    expect(pickContext([result([RAIN], { url: "not a url" })])).toBeNull();
  });

  it("returns the source title, url and domain", () => {
    const picked = pickContext([result([RAIN], { title: "  Rain  ahead ", url: "https://www.example.com/story" })]);
    expect(picked).toEqual({ text: RAIN, sourceTitle: "Rain ahead", sourceUrl: "https://www.example.com/story", sourceDomain: "example.com" });
  });

  it("returns null for no results", () => {
    expect(pickContext([])).toBeNull();
  });
});

describe("trimToSentences", () => {
  const s1 = "The central bank held its main rate at 4.5% on Thursday, as most economists had expected."; // 90
  const s2 = "Officials said inflation is cooling but still above target, and they gave no date for a cut."; // 93
  const s3 = "Markets reacted calmly, with the index ending the day little changed after a quiet session."; // 92

  it("keeps whole sentences within 220 characters", () => {
    const text = trimToSentences([s1, s2, s3]);
    expect(text).toBe(`${s1} ${s2}`);
    expect(text!.length).toBeLessThanOrEqual(MAX_TEXT_LENGTH);
    expect(text!.endsWith(".")).toBe(true);
  });

  it("drops a trailing fragment without terminal punctuation and a lowercase lead-in", () => {
    expect(trimToSentences(["and the vote was close.", s1, "The committee will meet again on"])).toBe(s1);
  });

  it("moves on when the first sentence is too long and a later one fits", () => {
    const long = `${"Word ".repeat(50).trim()}.`;
    expect(long.length).toBeGreaterThan(MAX_TEXT_LENGTH);
    expect(trimToSentences([long, s2])).toBe(s2);
  });

  it("clips a single over-long sentence at a word boundary", () => {
    const long = `${"Alpha beta gamma ".repeat(20).trim()}.`;
    const text = trimToSentences([long]);
    expect(text).not.toBeNull();
    expect(text!.length).toBeLessThanOrEqual(MAX_TEXT_LENGTH);
    expect(text!.endsWith("...")).toBe(true);
    expect(/(?:Alpha|beta|gamma)\.\.\.$/.test(text!)).toBe(true);
  });

  it("returns null when nothing is eligible", () => {
    expect(trimToSentences([])).toBeNull();
    expect(trimToSentences(["no punctuation here", ODDS])).toBeNull();
  });
});

describe("splitSentences", () => {
  it("splits on sentence ends and keeps abbreviations together", () => {
    expect(splitSentences("The U.S. team won. Dr. Lee spoke on Oct. 9 at 10 a.m. in the hall. The crowd cheered!")).toEqual([
      "The U.S. team won.",
      "Dr. Lee spoke on Oct. 9 at 10 a.m. in the hall.",
      "The crowd cheered!",
    ]);
  });

  it("handles closing quotes", () => {
    expect(splitSentences('"We are ready," she said. The match starts at 9.')).toEqual(['"We are ready," she said.', "The match starts at 9."]);
  });
});

describe("proseChunks on real passages", () => {
  it("drops section headers, price strips and tables", () => {
    expect(proseChunks(CME_PRICE_STRIP)).toEqual([]);
    expect(proseChunks(MARKETWATCH_TABLE)).toEqual([]);
  });

  it("keeps prose paragraphs, strips the header and decodes entities", () => {
    const chunks = proseChunks(TRADING_ECONOMICS_PROSE);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toMatch(/^Copper futures rose toward \$6\.6 per pound/);
    expect(chunks[1]).not.toContain("&#x20;");
    expect(chunks[1]!.endsWith("surged.")).toBe(true);
  });
});

describe("pickContext on real passages", () => {
  it("picks the first prose excerpt of the best result and ignores price strips", () => {
    const picked = pickContext([
      result([CME_PRICE_STRIP], { url: "https://www.cmegroup.com/markets/metals/base/copper.html", title: "Copper Futures Overview" }),
      result([TRADING_ECONOMICS_PROSE], { url: "https://tradingeconomics.com/commodity/copper/news/589732", title: "Copper Gains on Risk-On Mood" }),
    ]);
    expect(picked).not.toBeNull();
    expect(picked!.sourceDomain).toBe("tradingeconomics.com");
    expect(picked!.sourceTitle).toBe("Copper Gains on Risk-On Mood");
    expect(picked!.text).toBe(
      "Copper futures rose toward $6.6 per pound, hovering near one-week highs amid a rally in risk assets, highlighted by gains in technology and artificial intelligence stocks.",
    );
    expect(picked!.text.length).toBeLessThanOrEqual(MAX_TEXT_LENGTH);
  });

  it("drops a sentence that uses the word odds but keeps the rest of the excerpt", () => {
    const chunks = proseChunks(MINING_WITH_ODDS_WORD);
    expect(chunks).toHaveLength(3);
    expect(trimToSentences(splitSentences(chunks[1]!))).toBe(
      "Higher interest rates can dampen economic activity and weigh on demand for growth-dependent industrial metals such as copper.",
    );
    const picked = pickContext([result([MINING_WITH_ODDS_WORD], { url: "https://www.mining.com/web/copper-price-firms/" })]);
    expect(picked!.text).toMatch(/^Copper rose for a second straight session on Monday/);
    expect(mentionsOdds(picked!.text)).toBe(false);
  });
});

describe("pickContext on the saved sample", () => {
  // docs/samples/context-search.json is rewritten by every full smoke run, so
  // only invariants are checked here; exact texts live in the fixtures above.
  it("returns null or a safe line from one of the sample's results", () => {
    const picked = pickContext(sample.results);
    if (picked === null) return;
    expect(picked.text.length).toBeGreaterThan(0);
    expect(picked.text.length).toBeLessThanOrEqual(MAX_TEXT_LENGTH);
    expect(mentionsOdds(picked.text)).toBe(false);
    expect(sample.results.map((r) => r.url)).toContain(picked.sourceUrl);
    expect(EXCLUDED_DOMAINS).not.toContain(picked.sourceDomain);
    expect(picked.text).not.toMatch(/[|]|\[\[|&#x/);
  });
});

describe("domainOf", () => {
  it("strips www and lowercases", () => {
    expect(domainOf("https://WWW.Example.com/a/b?c=d")).toBe("example.com");
    expect(domainOf("https://news.example.co.uk/x")).toBe("news.example.co.uk");
  });

  it("returns null for an unparseable URL", () => {
    expect(domainOf("nope")).toBeNull();
  });
});
