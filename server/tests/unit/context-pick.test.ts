import { describe, expect, it } from "vitest";
import sample from "../fixtures/context-search.json";
import { EXCLUDED_DOMAINS } from "../../lib/context/client";
import {
  MAX_LINE_LENGTH,
  MAX_TEXT_LENGTH,
  domainOf,
  mentionsOdds,
  oneLine,
  oneSentence,
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

describe("pickContext with allowDescription (broad tier)", () => {
  const SNIPPET = "The central bank held its main rate at 4.5% on Thursday. Officials gave no date for a cut and said ...";

  it("ignores descriptions by default", () => {
    expect(pickContext([result(null, { description: SNIPPET })])).toBeNull();
  });

  it("lets a description stand in when highlights are null or empty", () => {
    for (const highlights of [null, []]) {
      const picked = pickContext([result(highlights, { description: SNIPPET, title: "Rates on hold" })], { allowDescription: true });
      expect(picked).toEqual({
        text: "The central bank held its main rate at 4.5% on Thursday.",
        sourceTitle: "Rates on hold",
        sourceUrl: "https://www.example.com/story",
        sourceDomain: "example.com",
      });
    }
    expect(pickContext([{ url: "https://x.example.com/", relevance: "high", description: SNIPPET }], { allowDescription: true })?.sourceDomain).toBe("x.example.com");
  });

  it("drops the piece a snippet cut off and keeps only whole sentences", () => {
    const cutOff = "On the Multi Commodity Exchange, copper contracts for October delivery went up by Rs 3.80 in a business turnover ...";
    expect(pickContext([result(null, { description: cutOff })], { allowDescription: true })).toBeNull();
    const midCut = "… and the vote was close. The committee will meet again on Friday to settle the matter. Members said …";
    expect(pickContext([result(null, { description: midCut })], { allowDescription: true })?.text).toBe(
      "The committee will meet again on Friday to settle the matter.",
    );
  });

  it("skips number strips inside a description", () => {
    const description = "A complete Copper Continuous Contract futures overview by MarketWatch. $6.6 $6.7 $6.8 $6.9. Visit a quote page and your recently viewed tickers will be ...";
    expect(pickContext([result(null, { description })], { allowDescription: true })?.text).toBe(
      "A complete Copper Continuous Contract futures overview by MarketWatch.",
    );
  });

  it("skips titles and list entries inside a description", () => {
    // From a real response for "The Game Awards: 2026 Game of the Year news".
    const list = "Gears of War: E-Day. Star Wars: Zero Company. Pragmata. Saros. Onimusha: Way of the Sword. All these games are ...";
    expect(pickContext([result(null, { description: list })], { allowDescription: true })).toBeNull();
    const mixed = "Game Awards December 10th 2026. The Game Awards will stream for free on December 10 across every major platform.";
    expect(pickContext([result(null, { description: mixed })], { allowDescription: true })?.text).toBe(
      "The Game Awards will stream for free on December 10 across every major platform.",
    );
  });

  it("skips tag lists inside a description", () => {
    // From a real response for "When will Stripe announce an IPO ... latest news".
    const tags = "When the company first announced FIUSD last year Mike Lyons was the company's ... Stripe payments private commerce finance stock offers IPO Oct. 1, 2026.";
    expect(pickContext([result(null, { description: tags })], { allowDescription: true })).toBeNull();
  });

  it("does not take a description from a site of posts and comments, but still takes its highlights", () => {
    const opinion = "GTA VI will come out right when the Game Awards 2026 will come out, so it is the winner for sure.";
    for (const url of ["https://www.reddit.com/r/TheGameAwards/comments/1", "https://www.instagram.com/p/abc/", "https://m.facebook.com/x/posts/1"]) {
      expect(pickContext([result(null, { description: opinion, url })], { allowDescription: true, allowLowRelevance: true })).toBeNull();
      expect(pickContext([result([RAIN], { description: opinion, url })], { allowDescription: true })?.text).toBe(RAIN);
    }
    expect(pickContext([result(null, { description: opinion, url: "https://www.polygon.com/goty" })], { allowDescription: true })?.text).toBe(opinion);
  });

  it("prefers any highlight over any description among results of usable relevance", () => {
    const picked = pickContext([result(null, { description: SNIPPET, relevance: "high" }), result([MATCH], { url: "https://news.example.org/a" })], {
      allowDescription: true,
    });
    expect(picked?.text).toBe(MATCH);
    expect(picked?.sourceDomain).toBe("news.example.org");
  });

  it("falls back to a description when the highlights hold no usable sentence", () => {
    const picked = pickContext([result([CME_PRICE_STRIP], { description: SNIPPET })], { allowDescription: true });
    expect(picked?.text).toBe("The central bank held its main rate at 4.5% on Thursday.");
  });

  it("keeps the odds filter, the excluded domains and the 220 character trim", () => {
    const options = { allowDescription: true, allowLowRelevance: true };
    expect(pickContext([result(null, { description: ODDS })], options)).toBeNull();
    expect(pickContext([result(null, { description: `${ODDS} ${MATCH}` })], options)?.text).toBe(MATCH);
    expect(pickContext([result(null, { description: RAIN, url: "https://www.polymarket.com/event/x" })], options)).toBeNull();
    expect(pickContext([result([RAIN], { relevance: "low", url: "https://sportsbook.draftkings.com/x" })], options)).toBeNull();
    const long = `The council said that ${"the plan for the old harbor ".repeat(10)}is on hold. The mayor said that ${"the vote on the new bridge ".repeat(10)}is next.`;
    expect(long.length).toBeGreaterThan(2 * MAX_TEXT_LENGTH);
    const picked = pickContext([result(null, { description: long })], options);
    expect(picked).not.toBeNull();
    expect(picked!.text.length).toBeLessThanOrEqual(MAX_TEXT_LENGTH);
    expect(mentionsOdds(picked!.text)).toBe(false);
  });
});

describe("pickContext with allowLowRelevance (broad tier)", () => {
  it("accepts a low relevance result when nothing else gives a line", () => {
    const picked = pickContext([result([RAIN], { relevance: "low" })], { allowLowRelevance: true });
    expect(picked?.text).toBe(RAIN);
  });

  it("uses low relevance only as a last resort, after medium and high", () => {
    const options = { allowLowRelevance: true };
    const picked = pickContext([result([RAIN], { relevance: "low" }), result([MATCH], { url: "https://news.example.org/a" })], options);
    expect(picked?.text).toBe(MATCH);
    const unrated = pickContext([result([RAIN], { relevance: "low" }), result([MATCH], { relevance: null })], options);
    expect(unrated?.text).toBe(MATCH);
  });

  it("prefers a medium description over a low highlight", () => {
    const picked = pickContext([result([RAIN], { relevance: "low" }), result(null, { description: MATCH, url: "https://news.example.org/a" })], {
      allowDescription: true,
      allowLowRelevance: true,
    });
    expect(picked?.text).toBe(MATCH);
  });

  it("tries low highlights, then low descriptions", () => {
    const options = { allowDescription: true, allowLowRelevance: true };
    const lows = [result(null, { relevance: "low", description: MATCH }), result([RAIN], { relevance: "low", url: "https://weather.example.com/" })];
    expect(pickContext(lows, options)?.text).toBe(RAIN);
    expect(pickContext([lows[0]!], options)?.text).toBe(MATCH);
    expect(pickContext([lows[0]!], { allowLowRelevance: true })).toBeNull();
  });

  it("still returns null when every low result is odds talk", () => {
    expect(pickContext([result([ODDS], { relevance: "low", description: ODDS })], { allowDescription: true, allowLowRelevance: true })).toBeNull();
  });
});

describe("pickContext on the saved sample with the broad options", () => {
  it("returns a safe line from one of the sample's results", () => {
    const picked = pickContext(sample.results, { allowDescription: true, allowLowRelevance: true });
    expect(picked).not.toBeNull();
    expect(picked!.text.length).toBeLessThanOrEqual(MAX_TEXT_LENGTH);
    expect(mentionsOdds(picked!.text)).toBe(false);
    expect(sample.results.map((r) => r.url)).toContain(picked!.sourceUrl);
    expect(EXCLUDED_DOMAINS).not.toContain(picked!.sourceDomain);
  });
});

describe("the one-line rule", () => {
  const s1 = "The central bank held its main rate at 4.5% on Thursday, as most economists had expected."; // 90
  const s2 = "Officials said inflation is cooling but still above target, and they gave no date for a cut."; // 93
  const long = `The council said that ${"the plan for the old harbor ".repeat(8)}is on hold.`;

  it("keeps the first qualifying sentence alone, though two would fit", () => {
    expect(MAX_LINE_LENGTH).toBe(180);
    expect(`${s1} ${s2}`.length).toBeLessThanOrEqual(MAX_TEXT_LENGTH);
    expect(oneSentence([s1, s2])).toBe(s1);
    expect(pickContext([result([`${s1} ${s2}`])])?.text).toBe(s1);
    expect(pickContext([result(null, { description: `${s1} ${s2}` })], { allowDescription: true })?.text).toBe(s1);
  });

  it("does not let a fragment, an odds sentence or a cut-off piece be the line", () => {
    expect(oneSentence(["Mostly cloudy.", "Hot.", "High 91F.", s1])).toBe(s1);
    expect(oneSentence([ODDS, s2])).toBe(s2);
    expect(oneSentence(["and the vote was close.", "The committee will meet again on", s1])).toBe(s1);
    expect(oneSentence(["Mostly cloudy.", "Hot."])).toBeNull();
    expect(oneSentence([ODDS])).toBeNull();
    expect(oneSentence([])).toBeNull();
    expect(pickContext([result(["Mostly cloudy. Hot. High 91F."]), result([RAIN], { url: "https://weather.example.com/" })])?.text).toBe(RAIN);
  });

  it("handles a sentence over the limit as before: a later one that fits, else a clip at a word", () => {
    expect(long.length).toBeGreaterThan(MAX_LINE_LENGTH);
    expect(oneSentence([long, s2])).toBe(s2);
    const clipped = oneSentence([long]);
    expect(clipped).not.toBeNull();
    expect(clipped!.length).toBeLessThanOrEqual(MAX_LINE_LENGTH);
    expect(clipped!.startsWith("The council said that the plan for the old harbor")).toBe(true);
    expect(clipped!.endsWith("...")).toBe(true);
    expect(pickContext([result([long])])?.text).toBe(clipped);
  });

  it("gives every pick one sentence of at most 180 characters", () => {
    const between = `${"The harbor plan is on hold for the year and ".repeat(4)}the vote is next.`; // over 180, under 220
    expect(between.length).toBeGreaterThan(MAX_LINE_LENGTH);
    expect(between.length).toBeLessThanOrEqual(MAX_TEXT_LENGTH);
    for (const passage of [`${s1} ${s2}`, `${long} ${s2}`, long, between, TRADING_ECONOMICS_PROSE, MINING_WITH_ODDS_WORD]) {
      const text = pickContext([result([passage])])?.text;
      expect(text).toBeDefined();
      expect(text!.length).toBeLessThanOrEqual(MAX_LINE_LENGTH);
      expect(splitSentences(text!)).toHaveLength(1);
      expect(mentionsOdds(text!)).toBe(false);
    }
  });
});

describe("oneLine on stored text", () => {
  it("reduces a line stored before the rule to its first qualifying sentence", () => {
    expect(oneLine(`${MATCH} ${RAIN}`)).toBe(MATCH);
    // A real stored line. The two fragments go; "91F." stays with what follows, because the
    // splitter reads a capital letter before a period as an initial.
    expect(oneLine("Mostly cloudy. Hot. High 91F. Winds SSE at 5 to 10 mph.")).toBe("High 91F. Winds SSE at 5 to 10 mph.");
    expect(oneLine(`  ${MATCH}\n${RAIN}  `)).toBe(MATCH);
  });

  it("leaves a line that already follows the rule unchanged", () => {
    for (const line of [MATCH, RAIN, oneSentence([`The council said that ${"the plan for the old harbor ".repeat(8)}is on hold.`])!]) {
      expect(oneLine(line)).toBe(line);
      expect(oneLine(oneLine(line))).toBe(line);
    }
  });

  it("re-clips a stored line that was clipped at the old 220 characters", () => {
    const stored = trimToSentences([`The council said that ${"the plan for the old harbor ".repeat(10)}is on hold.`])!;
    expect(stored.length).toBeGreaterThan(MAX_LINE_LENGTH);
    expect(stored.length).toBeLessThanOrEqual(MAX_TEXT_LENGTH);
    const line = oneLine(stored);
    expect(line.length).toBeLessThanOrEqual(MAX_LINE_LENGTH);
    expect(line.endsWith("...")).toBe(true);
    expect(oneLine(line)).toBe(line);
  });

  it("keeps text that has no qualifying sentence rather than returning nothing", () => {
    expect(oneLine("Mostly cloudy. Hot.")).toBe("Mostly cloudy. Hot.");
    expect(oneLine("no punctuation here")).toBe("no punctuation here");
    const run = "word ".repeat(60).trim();
    expect(oneLine(run).length).toBeLessThanOrEqual(MAX_LINE_LENGTH);
    expect(oneLine("")).toBe("");
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
