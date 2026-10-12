import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { expiresAtOf, questionFor } from "../../lib/gemini/cards";
import type { GeminiContract, GeminiEvent } from "../../lib/gemini/client";
import {
  MARKET_SOURCE_TITLE,
  MAX_MARKET_TEXT_LENGTH,
  closeSentence,
  marketContext,
  newYorkTime,
  plainText,
  richText,
  ruleSentences,
  type MarketCard,
} from "../../lib/context/market";
import { mentionsOdds } from "../../lib/context/pick";

// Events trimmed from docs/samples/events-production.json and events.json (2026-10-11).
// Descriptions are verbatim. Prices are made up and distinctive, so a test can
// prove that nothing from `prices` reaches the text.
const PRICES = { buy: { yes: "0.3712", no: "0.6288" }, sell: { yes: "0.3688", no: "0.6312" }, bestBid: "0.3688", bestAsk: "0.3712", lastTradePrice: "0.3701" };

function doc(value: string): unknown {
  return { data: {}, content: [{ data: {}, marks: [], value, nodeType: "text" }], nodeType: "document" };
}

function contract(fields: Record<string, unknown>): GeminiContract {
  return { marketState: "open", status: "active", prices: PRICES, ...fields } as unknown as GeminiContract;
}

function event(fields: Record<string, unknown>, contracts: GeminiContract[]): GeminiEvent {
  return { status: "active", ...fields, contracts } as unknown as GeminiEvent;
}

function cardOf(e: GeminiEvent, c: GeminiContract): MarketCard {
  return { question: questionFor(e, c), category: e.category ?? "Other", expiresAt: expiresAtOf(e, c)! };
}

const NOW = new Date("2026-10-11T23:55:00.000Z");

const XRP_TERMS = "https://assets.gemini.com/predictions/terms_and_conditions/xrp_68683757-6484-4a53-8a7f-7d9afc5b1747.pdf";
const xrpLadder = event(
  {
    ticker: "XRP2610122100",
    title: "XRP price on October 12",
    description: "Interval XRP price prediction event expiring on October 12, 2026 at 5pm ET",
    category: "Crypto",
    series: "XRP1H",
    source: "LS-LRRR-XRPUSD",
    sourceDetails: { agency: "lukka", index: "LS-LRRR-XRPUSD" },
    termsLink: XRP_TERMS,
    expiryDate: "2026-10-12T21:00:00.000Z",
  },
  ["1.36", "1.38"].map((strike) =>
    contract({
      instrumentSymbol: `GEMI-XRP2610122100-HI1D${strike.slice(2)}`,
      label: `$${strike} or above`,
      strike: { type: "above", value: strike },
      expiryDate: "2026-10-12T21:00:00.000Z",
      termsAndConditionsUrl: XRP_TERMS,
      description: doc(
        `If the price of XRP is $${strike} or above on October 12, 2026 at 5pm ET, this market will resolve to Yes. Otherwise, it will resolve to No. If no eligible trade occurs during the contract window, this contract will resolve based on the most recent traded price prior. Outcome verified against the LS-LRRR-XRPUSD index. View the [full rules](${XRP_TERMS}).`,
      ),
    }),
  ),
);

const nflGame = event(
  {
    ticker: "NFL-2610112005-DEN-LAC-M",
    title: "Denver vs Los Angeles C",
    description: "Denver vs Los Angeles C",
    category: "Sports",
    sourceDetails: { agency: "statscore-rest-api", index: "Am. football" },
    termsLink: "https://assets.gemini.com/predictions/terms_and_conditions/Terms_and_Conditions_NFL_Win-Loss_Class.pdf",
    expiryDate: "2026-10-13T08:05:00.000Z",
  },
  [
    ["Denver", "Los Angeles C"],
    ["Los Angeles C", "Denver"],
  ].map(([team, other]) =>
    contract({
      instrumentSymbol: `GEMI-NFL-2610112005-DEN-LAC-M-${team === "Denver" ? "DEN" : "LAC"}`,
      label: team,
      expiryDate: "2026-10-13T08:05:00.000Z",
      description: doc(
        `This market resolves to Yes if ${team} wins the Pro Football game\n between ${team} and ${other} scheduled for October 11, 2026 at 4:05 PM ET. If the game ends in a draw/tie, the market will resolve according to 50/50 draw resolution rules. Otherwise, it resolves to No. The Underlying is the official result of the specified sporting event. Source Agencies, in order, are the league governing the event, ESPN, Fox Sports, and the broadcast partner of the event\n. If the Expiration Value cannot be determined on the Expiration Date (including because the event is cancelled or a team forfeits, withdraws, or is disqualified), the Exchange may determine payouts pursuant to the Market Outcome Review.`,
      ),
    }),
  ),
);

const STRIPE_RULES =
  "If Stripe publicly announces an IPO (including announcing that it has filed\u2014confidentially or publicly\u2014a registration statement with the U.S. SEC for an initial public offering, or otherwise publicly announcing plans to pursue an IPO of Stripe or its controlling parent entity) before Sep 1, 2026, this market resolves to Yes. Otherwise, it resolves to No.  \n\nRead the full [terms and conditions](<https://cdn.builder.io/o/assets%2Fabc%2Fdef?alt=media&token=00000000-0000-0000-0000-000000000000&apiKey=abc>).";
const stripeIpo = event(
  { ticker: "STRIPEIPO", title: "When will Stripe announce an IPO?", description: "When will Stripe announce an IPO?", category: "Business", sourceDetails: null, termsLink: "", expiryDate: "2027-06-01T03:59:59.000Z" },
  [
    ["NOV26", "Before Nov 1, 2026", "2026-11-01T03:59:59.000Z"],
    ["DEC26", "Before Dec 1, 2026", "2026-12-01T04:59:59.000Z"],
  ].map(([suffix, label, expiryDate]) =>
    contract({ instrumentSymbol: `GEMI-STRIPEIPO-${suffix}`, label, expiryDate, termsAndConditionsUrl: "", description: doc(STRIPE_RULES) }),
  ),
);

const bestAi = event(
  { ticker: "BESTAI26", title: "Best AI at the end of 2026?", description: "Best AI at the end of 2026?", category: "Tech", sourceDetails: null, termsLink: "", expiryDate: "2027-01-01T04:59:00.000Z" },
  [
    ["CLAUDE", "Claude", "Anthropic"],
    ["GEMINI", "Gemini", "Google"],
  ].map(([suffix, label, maker]) =>
    contract({
      instrumentSymbol: `GEMI-BESTAI26-${suffix}`,
      label,
      expiryDate: "2027-01-01T04:59:00.000Z",
      termsAndConditionsUrl: "",
      description: doc(
        `If ${maker} has the top-ranked LLM on Dec 31, 2026, then the market resolves to Yes. Otherwise, it resolves to No. Outcome verified from LM Arena Leaderboard (Remove Style Controls).\n\nIf two models are tied under Rank (UB), then the model with the highest Arena Score will win.\n\nThis event is mutually exclusive.\n\nRead the full [terms & conditions](<https://cdn.builder.io/o/assets%2Fabc?alt=media&token=1&apiKey=abc>)`,
      ),
    }),
  ),
);

const solUpDown = event(
  {
    ticker: "SOL05M2610112350",
    title: "SOL price today at 7:50pm EDT",
    description: "Interval SOL price prediction event expiring on October 11, 2026 at 7:50pm ET",
    category: "Crypto",
    series: "SOL05M",
    sourceDetails: { agency: "lukka", index: "LS-LRRR-SOLNUSD" },
    termsLink: "https://assets.gemini.com/predictions/terms_and_conditions/sol_9cceb1a1-4177-4011.pdf",
    expiryDate: "2026-10-11T23:50:00.000Z",
  },
  [
    contract({
      instrumentSymbol: "GEMI-SOL05M2610112350-UP",
      label: "Up",
      strike: { type: "reference", value: "111.15", availableAt: "2026-10-11T23:45:00.000Z" },
      expiryDate: "2026-10-11T23:50:00.000Z",
      description: doc(
        "If the price of Solana (SOL) is greater than or equal to the price specified in the title on October 11, 2026 at 7:50pm ET, this market will resolve to Yes. Otherwise, it will resolve to No. If no eligible trade occurs during the contract window, this contract will resolve based on the most recent traded price prior. Outcome verified against the LS-LRRR-SOLNUSD index. View the [full rules](https://assets.gemini.com/predictions/terms_and_conditions/sol_9cceb1a1-4177-4011.pdf).",
      ),
    }),
  ],
);

function expectPlain(text: string): void {
  expect(text.trim()).toBe(text);
  expect(text.length).toBeGreaterThan(0);
  expect(text.length).toBeLessThanOrEqual(MAX_MARKET_TEXT_LENGTH);
  expect(text).not.toMatch(/<[a-z/][^>]*>|\]\(|\*\*|https?:\/\/|&[a-z#0-9]+;|\n|\u00a0|\s{2,}/i);
  expect(text).not.toContain("\u2014");
  expect(mentionsOdds(text)).toBe(false);
  // Nothing from `prices`.
  expect(text).not.toMatch(/0\.3712|0\.6288|0\.3688|0\.6312|0\.3701|37\.12|62\.88|\b37%|\b63%/);
}

function sentenceCount(text: string): number {
  return text.split(/(?<=[.!?]["”]?)\s+(?=[A-Z])/).length;
}

describe("marketContext from real events", () => {
  it("says what resolves Yes, names the source and gives the close time (crypto ladder)", () => {
    const c = xrpLadder.contracts![0]!;
    const ctx = marketContext(xrpLadder, c, cardOf(xrpLadder, c), NOW);
    expect(ctx.text).toBe(
      "If the price of XRP is $1.36 or above on October 12, 2026 at 5pm ET, this market will resolve to Yes. Outcome verified against the LS-LRRR-XRPUSD index. It closes on October 12, 2026 at 5:00 PM ET.",
    );
    expect(ctx).toMatchObject({ sourceTitle: "Market rules on Gemini", sourceDomain: null, sourceUrl: XRP_TERMS });
    expect(MARKET_SOURCE_TITLE).toBe("Market rules on Gemini");
    expectPlain(ctx.text);
  });

  it("splits rules that end sentences with ET, Yes and No (sports game)", () => {
    const c = nflGame.contracts![0]!;
    const ctx = marketContext(nflGame, c, cardOf(nflGame, c), NOW);
    expect(ctx.text).toBe(
      "This market resolves to Yes if Denver wins the Pro Football game between Denver and Los Angeles C scheduled for October 11, 2026 at 4:05 PM ET. Source Agencies, in order, are the league governing the event, ESPN, Fox Sports, and the broadcast partner of the event. It closes on October 13, 2026 at 4:05 AM ET.",
    );
    // The draw rule ("50/50") reads like odds; it is never picked.
    expect(ctx.text).not.toContain("50/50");
    expectPlain(ctx.text);
    expect(sentenceCount(ctx.text)).toBe(3);
  });

  it("writes long dashes in the rules as commas", () => {
    const c = contract({ instrumentSymbol: "GEMI-STRIPEIPO-ONLY", label: "Yes", expiryDate: "2026-11-01T03:59:59.000Z", description: doc(STRIPE_RULES) });
    const e = event({ ticker: "STRIPEIPO", title: "Will Stripe announce an IPO?", category: "Business" }, [c]);
    const ctx = marketContext(e, c, cardOf(e, c), NOW);
    // Too long with its aside in brackets, so the aside goes.
    expect(ctx.text).toBe("If Stripe publicly announces an IPO before Sep 1, 2026, this market resolves to Yes. It closes on October 31, 2026 at 11:59 PM ET, in 20 days.");
    expect(plainText("it has filed\u2014confidentially or publicly\u2014a statement")).toBe("it has filed, confidentially or publicly, a statement");
    expectPlain(ctx.text);
  });

  it("writes the rule from the label when every option shares one description (Stripe IPO)", () => {
    const c = stripeIpo.contracts![0]!;
    const card = cardOf(stripeIpo, c);
    expect(card.question).toBe("When will Stripe announce an IPO: Before Nov 1, 2026?");
    const ctx = marketContext(stripeIpo, c, card, NOW);
    expect(ctx.text).toBe(
      'This market resolves YES if the outcome of "When will Stripe announce an IPO" is "Before Nov 1, 2026". It closes on October 31, 2026 at 11:59 PM ET, in 20 days.',
    );
    // The shared text names another option's date; it must not be shown for this one.
    expect(ctx.text).not.toContain("Sep 1, 2026");
    expect(ctx.sourceUrl).toBeNull();
    expectPlain(ctx.text);
    expect(sentenceCount(ctx.text)).toBe(2);
  });

  it("strips markdown links and keeps the leaderboard source (Best AI)", () => {
    const c = bestAi.contracts![0]!;
    const ctx = marketContext(bestAi, c, cardOf(bestAi, c), NOW);
    expect(ctx.text).toBe(
      "If Anthropic has the top-ranked LLM on Dec 31, 2026, then the market resolves to Yes. Outcome verified from LM Arena Leaderboard (Remove Style Controls). It closes on December 31, 2026 at 11:59 PM ET, in 81 days.",
    );
    expect(ctx.sourceUrl).toBeNull();
    expectPlain(ctx.text);
  });

  it("keeps the text free of blocked names even when the option is called Gemini", () => {
    const c = bestAi.contracts![1]!;
    const card = cardOf(bestAi, c);
    expect(card.question).toBe("Best AI at the end of 2026: Gemini?");
    const ctx = marketContext(bestAi, c, card, NOW);
    expect(ctx.text).toMatch(/^If Google has the top-ranked LLM/);
    expectPlain(ctx.text);
  });

  it("handles the crypto Up or Down rule and a market that just closed", () => {
    const c = solUpDown.contracts![0]!;
    const card = cardOf(solUpDown, c);
    expect(card.question).toBe("SOL price today at 7:50pm EDT: Up from $111.15?");
    const open = marketContext(solUpDown, c, card, new Date("2026-10-11T23:46:00.000Z"));
    expect(open.text).toBe(
      "If the price of Solana (SOL) is greater than or equal to the price specified in the title on October 11, 2026 at 7:50pm ET, this market will resolve to Yes. Outcome verified against the LS-LRRR-SOLNUSD index. It closes on October 11, 2026 at 7:50 PM ET.",
    );
    expectPlain(open.text);
    expect(marketContext(solUpDown, c, card, NOW).text).toMatch(/It closed on October 11, 2026 at 7:50 PM ET\.$/);
  });

  it("never reads prices: the text is the same whatever the quotes are", () => {
    for (const e of [xrpLadder, nflGame, stripeIpo, bestAi, solUpDown]) {
      for (const c of e.contracts ?? []) {
        const card = cardOf(e, c);
        const quoted = marketContext(e, c, card, NOW);
        const unquoted = marketContext(e, { ...c, prices: { buy: {}, sell: {} } } as GeminiContract, card, NOW);
        expect(unquoted).toEqual(quoted);
        expectPlain(quoted.text);
        expect(sentenceCount(quoted.text)).toBeGreaterThanOrEqual(2);
        expect(sentenceCount(quoted.text)).toBeLessThanOrEqual(3);
      }
    }
  });
});

describe("marketContext without the event", () => {
  const card: MarketCard = { question: "SOL price today at 7:50pm EDT: Up from $111.15?", category: "Crypto", expiresAt: "2026-10-11T23:50:00.000Z" };

  it("builds two sentences from the card alone", () => {
    const ctx = marketContext(null, null, card, new Date("2026-10-11T23:46:00.000Z"));
    expect(ctx).toEqual({
      text: 'This market resolves YES if the answer to "SOL price today at 7:50pm EDT: Up from $111.15?" is yes, and NO otherwise. It closes on October 11, 2026 at 7:50 PM ET.',
      sourceTitle: "Market rules on Gemini",
      sourceUrl: null,
      sourceDomain: null,
    });
    expectPlain(ctx.text);
  });

  it("uses the event when only the contract is missing", () => {
    const ctx = marketContext(xrpLadder, null, { question: "XRP price on October 12: $1.40 or above?", category: "Crypto", expiresAt: "2026-10-12T21:00:00.000Z" }, NOW);
    expect(ctx.text).toBe(
      'This market resolves YES if the answer to "XRP price on October 12: $1.40 or above?" is yes, and NO otherwise. The outcome is checked against the LS-LRRR-XRPUSD index. It closes on October 12, 2026 at 5:00 PM ET.',
    );
    expect(ctx.sourceUrl).toBe(XRP_TERMS);
  });

  it("drops the question when it carries a blocked name, and is still not empty", () => {
    const ctx = marketContext(null, null, { question: "Best AI at the end of 2026: Gemini?", category: "Tech", expiresAt: "2027-01-01T04:59:00.000Z" }, NOW);
    expect(ctx.text).toBe("This is a yes or no market in Tech. It closes on December 31, 2026 at 11:59 PM ET, in 81 days.");
    expectPlain(ctx.text);
  });

  it("is never empty, even with nothing usable on the card", () => {
    const ctx = marketContext(null, null, { question: "", category: "", expiresAt: "not a date" }, NOW);
    expect(ctx.text).toBe("This is a yes or no market.");
    const odd = marketContext(null, null, { question: "Kalshi odds?", category: "Betting odds", expiresAt: "2026-10-12T21:00:00.000Z" }, NOW);
    expect(odd.text).toBe("This is a yes or no market. It closes on October 12, 2026 at 5:00 PM ET.");
  });

  it("strips HTML and markdown from a description and from the card", () => {
    const e = event({ ticker: "X", title: "<b>Will it rain</b> in **Austin**?", category: "Weather", termsLink: "" }, [
      contract({
        instrumentSymbol: "GEMI-X-YES",
        label: "Yes",
        expiryDate: "2026-10-12T21:00:00.000Z",
        description: doc(
          "<p>This market resolves to <strong>Yes</strong> if the [National Weather Service](https://www.weather.gov/) records rain in **Austin** on October&nbsp;12, 2026.</p><p>Outcome verified from the <a href=\"https://www.weather.gov/\">National Weather Service</a>.</p>",
        ),
      }),
    ]);
    const c = e.contracts![0]!;
    const ctx = marketContext(e, c, { question: "Will it rain in Austin?", category: "Weather", expiresAt: "2026-10-12T21:00:00.000Z" }, NOW);
    expect(ctx.text).toBe(
      "This market resolves to Yes if the National Weather Service records rain in Austin on October 12, 2026. Outcome verified from the National Weather Service. It closes on October 12, 2026 at 5:00 PM ET.",
    );
    expectPlain(ctx.text);
  });
});

describe("market source link", () => {
  const card: MarketCard = { question: "Q?", category: "Crypto", expiresAt: "2026-10-12T21:00:00.000Z" };
  const withLinks = (termsLink: unknown, termsAndConditionsUrl: unknown) => {
    const c = contract({ instrumentSymbol: "GEMI-X-YES", label: "Yes", termsAndConditionsUrl, description: doc("If it happens, this market resolves to Yes.") });
    return marketContext(event({ ticker: "X", title: "Q?", termsLink }, [c]), c, card, NOW).sourceUrl;
  };

  it("passes on the event's public terms link, else the contract's", () => {
    expect(withLinks(XRP_TERMS, "")).toBe(XRP_TERMS);
    expect(withLinks("", XRP_TERMS)).toBe(XRP_TERMS);
    expect(withLinks(undefined, XRP_TERMS)).toBe(XRP_TERMS);
  });

  it("is null without one, and never invents an address", () => {
    expect(withLinks("", "")).toBeNull();
    expect(withLinks(undefined, undefined)).toBeNull();
    expect(withLinks("not a url", 42)).toBeNull();
    expect(withLinks("http://assets.gemini.com/terms.pdf", "")).toBeNull();
  });

  it("does not pass on a storage address that carries a token", () => {
    expect(withLinks("https://cdn.builder.io/o/assets%2Fabc?alt=media&token=1&apiKey=abc", "")).toBeNull();
  });
});

describe("helpers", () => {
  it("reads rich text documents, nested or flat", () => {
    expect(richText(doc("One. Two."))).toBe("One. Two.");
    expect(
      richText({ nodeType: "document", content: [{ nodeType: "paragraph", content: [{ nodeType: "text", value: "A " }, { nodeType: "text", value: "B." }] }, { nodeType: "paragraph", content: [{ nodeType: "text", value: "C." }] }] }),
    ).toBe("A B.\nC.");
    expect(richText("plain")).toBe("plain");
    expect(richText(null)).toBe("");
    expect(richText({})).toBe("");
  });

  it("turns markdown and HTML into plain text", () => {
    expect(plainText("View the [full rules](https://a.example/x.pdf).")).toBe("View the full rules.");
    expect(plainText("Read the [terms & conditions](<https://a.example/o?x=1&y=2>)")).toBe("Read the terms & conditions");
    expect(plainText("Outcome verified from\u00a0Google Finance.\n\n- **Bold** point")).toBe("Outcome verified from Google Finance. Bold point");
    expect(plainText("the event\n. Next")).toBe("the event. Next");
    expect(plainText("above 3.5 and .5 more")).toBe("above 3.5 and .5 more");
  });

  it("splits rules into sentences and drops the pointer to the full rules", () => {
    expect(ruleSentences(xrpLadder.contracts![0]!)).toEqual([
      "If the price of XRP is $1.36 or above on October 12, 2026 at 5pm ET, this market will resolve to Yes.",
      "Otherwise, it will resolve to No.",
      "If no eligible trade occurs during the contract window, this contract will resolve based on the most recent traded price prior.",
      "Outcome verified against the LS-LRRR-XRPUSD index.",
    ]);
    expect(ruleSentences(null)).toEqual([]);
    const usSec = contract({ description: doc("Filed with the U.S. SEC at 3:05 p.m. CT on Jan. 5. It resolves to No. Done.") });
    expect(ruleSentences(usSec)).toEqual(["Filed with the U.S. SEC at 3:05 p.m. CT on Jan. 5.", "It resolves to No.", "Done."]);
  });

  it("formats the close time in America/New_York, across the clock change", () => {
    expect(newYorkTime("2026-10-12T21:00:00.000Z")).toBe("October 12, 2026 at 5:00 PM ET");
    expect(newYorkTime("2027-01-01T04:59:59.000Z")).toBe("December 31, 2026 at 11:59 PM ET");
    expect(newYorkTime("2026-10-12T04:05:00.000Z")).toBe("October 12, 2026 at 12:05 AM ET");
    expect(newYorkTime("nope")).toBeNull();
  });

  it("adds the days left from two days out", () => {
    expect(closeSentence("2026-10-12T21:00:00.000Z", NOW)).toBe("It closes on October 12, 2026 at 5:00 PM ET.");
    expect(closeSentence("2026-10-13T23:54:00.000Z", NOW)).toBe("It closes on October 13, 2026 at 7:54 PM ET.");
    expect(closeSentence("2026-10-13T23:56:00.000Z", NOW)).toBe("It closes on October 13, 2026 at 7:56 PM ET, in 2 days.");
    expect(closeSentence("2026-10-11T23:50:00.000Z", NOW)).toBe("It closed on October 11, 2026 at 7:50 PM ET.");
    expect(closeSentence("nope", NOW)).toBeNull();
  });
});

describe("marketContext over the saved Gemini samples", () => {
  // The sample files are rewritten by the Gemini smoke scripts, so only invariants are checked.
  const samples = ["events-production.json", "events.json"]
    .map((name) => fileURLToPath(new URL(`../../../docs/samples/${name}`, import.meta.url)))
    .filter((path) => existsSync(path));

  it.skipIf(samples.length === 0)("gives every contract a plain, odds-free text of two or three sentences", () => {
    let seen = 0;
    for (const path of samples) {
      const events = (JSON.parse(readFileSync(path, "utf8")) as { data?: GeminiEvent[] }).data ?? [];
      for (const e of events) {
        for (const c of e.contracts ?? []) {
          const expiresAt = expiresAtOf(e, c);
          if (!expiresAt) continue;
          const ctx = marketContext(e, c, { question: questionFor(e, c), category: e.category ?? "Other", expiresAt }, NOW);
          seen++;
          expect(ctx.text.length).toBeGreaterThan(40);
          expect(ctx.text.length).toBeLessThanOrEqual(MAX_MARKET_TEXT_LENGTH);
          expect(mentionsOdds(ctx.text)).toBe(false);
          expect(ctx.text).not.toMatch(/<[a-z/][^>]*>|\]\(|\*\*|https?:\/\/|\n/i);
          expect(ctx.text).toMatch(/It close[sd] on [A-Z][a-z]+ \d{1,2}, \d{4} at \d{1,2}:\d{2} [AP]M ET(?:, in \d+ days)?\.$/);
          expect(ctx.sourceTitle).toBe("Market rules on Gemini");
          expect(ctx.sourceDomain).toBeNull();
          expect(ctx.sourceUrl === null || (/^https:\/\//.test(ctx.sourceUrl) && !/token=|apiKey=/i.test(ctx.sourceUrl))).toBe(true);
        }
      }
    }
    expect(seen).toBeGreaterThan(0);
  });
});
