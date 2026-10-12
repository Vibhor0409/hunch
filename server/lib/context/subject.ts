// The subject of a market, for the broad web search (tier 2). Pure: no I/O.
// Spec: docs/CONTEXT_DEV.md, "Always-on context": the event title without clock
// times, strikes or the option label. Card questions are built by questionFor
// in lib/gemini/cards.ts as "<title>?", "<title>: <label>?" or
// "<title>: Up from $83,515.78?".

/** Clock times such as "at 7:50pm EDT", "at 5pm ET" or "8 PM". */
const CLOCK_TIME =
  /(?:\bat\s+)?\b\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)(?=[\s,.?:;)]|$)(?:\s*\(?(?:E[SD]?T|C[SD]?T|M[SD]?T|P[SD]?T|UTC|GMT)\b\)?)?/gi;

const MONEY = String.raw`\$\s?\d[\d,]*(?:\.\d+)?[kmb]?`;
/** Strike fragments such as "Up from $111.15", "$6.7 or above" or "above $83,100". */
const STRIKES: readonly RegExp[] = [
  new RegExp(String.raw`\b(?:up|down)\s+from\s+${MONEY}`, "gi"),
  new RegExp(String.raw`\b(?:above|below|over|under|at least|at most|more than|less than)\s+${MONEY}`, "gi"),
  new RegExp(String.raw`${MONEY}\s+or\s+(?:above|below|more|less|higher|lower)\b`, "gi"),
  new RegExp(String.raw`${MONEY}\s+to\s+${MONEY}`, "gi"),
  new RegExp(MONEY, "gi"),
];

/** Bare crypto tickers and the names people search for (names as Gemini's contract descriptions give them). */
const CRYPTO_NAMES: Readonly<Record<string, string>> = {
  BTC: "Bitcoin",
  ETH: "Ethereum",
  SOL: "Solana",
  XRP: "XRP",
  ZEC: "Zcash",
  HYPE: "Hyperliquid",
};
const CRYPTO_TICKER = new RegExp(String.raw`\b(?:${Object.keys(CRYPTO_NAMES).join("|")})\b`, "g");

function withoutTimesAndStrikes(text: string): string {
  let out = text.replace(CLOCK_TIME, " ");
  for (const strike of STRIKES) out = out.replace(strike, " ");
  return out;
}

/** Collapses whitespace and removes question marks, loose punctuation and a dangling "at", "from" or "to". */
function tidy(text: string): string {
  let out = text.replace(/\?/g, " ").replace(/\s+/g, " ").trim();
  let before: string;
  do {
    before = out;
    out = out
      .replace(/^[\s:;,\-–.]+|[\s:;,\-–.]+$/g, "")
      .replace(/\s+(?:at|from|to|by|or)$/i, "")
      .trim();
  } while (out !== before);
  return out.replace(/\s+([:;,])/g, "$1");
}

function expandCrypto(subject: string): string {
  if (!/\bprice\b/i.test(subject)) return subject;
  return subject.replace(CRYPTO_TICKER, (ticker) => CRYPTO_NAMES[ticker] ?? ticker);
}

/**
 * What a market is about, as a search phrase.
 * - With an event title: the title without clock times and strikes.
 * - Without one: the question without clock times, then without the option
 *   label (the part after the last ":"), then without strikes.
 * - In a price market, bare crypto tickers become names (BTC to Bitcoin).
 * Falls back to the tidied question when the cleaning leaves nothing.
 */
export function subjectFor(question: string, eventTitle?: string | null): string {
  const title = tidy(withoutTimesAndStrikes(eventTitle ?? ""));
  if (title) return expandCrypto(title);

  // Clock times go first: "7:50pm" holds a colon that is not the label separator.
  const timeless = question.replace(CLOCK_TIME, " ");
  const cut = timeless.lastIndexOf(":");
  const head = cut > 0 ? timeless.slice(0, cut) : timeless;
  const subject = tidy(withoutTimesAndStrikes(head));
  return expandCrypto(subject || tidy(question));
}
