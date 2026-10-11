// Picks one safe context line from Context.dev search results. Pure: no I/O.
// Spec: docs/CONTEXT_DEV.md, "pickContext". Shapes follow docs/samples/context-search.json,
// where a highlight passage is several excerpts joined by "…" lines, with
// bracketed section headers, markdown tables and HTML entities mixed in.
import { EXCLUDED_DOMAINS } from "./client";

/** Longest context line the card back shows (two to three lines). */
export const MAX_TEXT_LENGTH = 220;
/** Excerpts shorter than this are headers, numbers or dates, not news. */
const MIN_CHUNK_LENGTH = 40;
/** Below this share of letters an excerpt is a price table, not prose. */
const MIN_LETTER_RATIO = 0.5;

/** The parts of a search result this module reads (a subset of client.ts SearchResult). */
export interface PickableResult {
  url: string;
  title?: string | null;
  relevance?: string | null;
  highlights?: { highlights?: string[] | null } | null;
}

export interface PickedContext {
  text: string;
  sourceTitle: string | null;
  sourceUrl: string;
  sourceDomain: string;
}

/**
 * Odds filter (CLAUDE.md rule 5: blind means blind). A sentence that mentions
 * odds, bettors, sportsbooks, implied probability, "traders give", betting
 * words, or a prediction market or sportsbook by name is dropped. Plain facts
 * with numbers ("a 40% chance of rain", a poll result) pass.
 */
const ODDS_PATTERN =
  /\b(?:odds|bettors?|betting|bets?|wagers?|wagered|wagering|sportsbooks?|bookmakers?|bookies?|moneyline|point spreads?|implied probabilit(?:y|ies)|traders give|prediction markets?|kalshi|polymarket|predictit|gemini|draftkings|fanduel|betmgm|caesars)\b/i;

export function mentionsOdds(sentence: string): boolean {
  return ODDS_PATTERN.test(sentence);
}

// ---------- Cleaning ----------

function decodeEntities(text: string): string {
  const fromCodePoint = (code: number): string => (code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : " ");
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => fromCodePoint(Number(dec)))
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

/** True for an excerpt that reads as prose rather than a header, list, table or price strip. */
function isProse(chunk: string): boolean {
  if (chunk.length < MIN_CHUNK_LENGTH) return false;
  if (/^[[#\-*|>•]/.test(chunk)) return false; // markdown header, list item, table row, quote
  if (/\[\[|\]\]|\|/.test(chunk)) return false; // template placeholders and table cells
  const letters = (chunk.match(/\p{L}/gu) ?? []).length;
  return letters / chunk.length >= MIN_LETTER_RATIO;
}

/**
 * The prose excerpts of one highlight passage. Excerpts are split on blank
 * lines (the "…" separators sit on their own line), a leading "[Section]"
 * header is removed, entities are decoded, emphasis marks dropped and
 * whitespace collapsed.
 */
export function proseChunks(passage: string): string[] {
  return passage
    .split(/\n\s*\n/)
    .map((chunk) =>
      decodeEntities(chunk)
        .replace(/^\s*\[[^\]\n]*\]\s*/, "")
        .replace(/\*\*|__/g, "")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter(isProse);
}

// ---------- Sentences ----------

/**
 * Splits after . ! or ? (plus a closing quote or bracket) when a capital
 * letter or digit follows, except after initials ("U.S.") and common
 * abbreviations ("Dr.", "Oct.", "a.m."). Good enough for news excerpts.
 */
const SENTENCE_BREAK =
  /(?<=[.!?]["'”’)\]]?)(?<![A-Z]\.["'”’)\]]?)(?<!\b(?:Mr|Mrs|Ms|Dr|Jr|Sr|St|No|vs|Inc|Ltd|Co|Corp|Sen|Rep|Gov|Gen|Mt|Ft|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec|a\.m|p\.m)\.["'”’)\]]?)\s+(?=["'“‘(\[]?[A-Z0-9])/;

const COMPLETE_SENTENCE = /[.!?]["'”’)\]]?$/;

export function splitSentences(text: string): string[] {
  return text
    .split(SENTENCE_BREAK)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** A whole sentence: ends with terminal punctuation and does not start mid-sentence (lowercase). */
function isWholeSentence(sentence: string): boolean {
  return COMPLETE_SENTENCE.test(sentence) && !/^\p{Ll}/u.test(sentence);
}

/** The sentence cut at a word boundary with "..." so the result is at most `max` characters. */
function clipAtWord(sentence: string, max: number): string {
  const room = max - 3;
  const cut = sentence.lastIndexOf(" ", room);
  const head = (cut > room / 2 ? sentence.slice(0, cut) : sentence.slice(0, room)).replace(/[\s,;:]+$/, "");
  return `${head}...`;
}

/**
 * Whole sentences, in order, within `max` characters, after the odds filter
 * and with fragments removed. When the first eligible sentence alone is too
 * long, later sentences are tried; when no whole sentence fits, the first
 * eligible sentence is clipped at a word boundary with "...". Null when no
 * sentence is eligible.
 */
export function trimToSentences(sentences: readonly string[], max: number = MAX_TEXT_LENGTH): string | null {
  const eligible = sentences.filter((s) => isWholeSentence(s) && !mentionsOdds(s));
  for (let start = 0; start < eligible.length; start++) {
    let text = "";
    for (let i = start; i < eligible.length; i++) {
      const next = text ? `${text} ${eligible[i]}` : eligible[i];
      if (next.length > max) break;
      text = next;
    }
    if (text) return text;
  }
  const first = eligible[0];
  return first ? clipAtWord(first, max) : null;
}

// ---------- Sources ----------

/** The host of a URL without a leading "www.", or null when the URL does not parse. */
export function domainOf(url: string): string | null {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    return host.length > 0 ? host : null;
  } catch {
    return null;
  }
}

function isExcludedDomain(domain: string): boolean {
  return EXCLUDED_DOMAINS.some((excluded) => domain === excluded || domain.endsWith(`.${excluded}`));
}

function cleanTitle(title: string | null | undefined): string | null {
  const cleaned = (title ?? "").replace(/\s+/g, " ").trim();
  return cleaned.length > 0 ? cleaned : null;
}

const RELEVANCE_RANK: Record<string, number> = { high: 0, medium: 1 };

function rankOf(relevance: string | null | undefined): number {
  return RELEVANCE_RANK[relevance ?? ""] ?? 2;
}

/**
 * One context line and its source, or null.
 * 1. Results with relevance "low", without highlights, with an unparseable
 *    URL or from an excluded odds site are skipped.
 * 2. The remaining results are visited best first (high, then medium, then
 *    unrated; ties keep the API order). Within a result, each highlight
 *    passage's prose excerpts are tried in order.
 * 3. The first excerpt that still has text after trimToSentences (whole
 *    sentences, at most 220 characters, odds sentences dropped) wins.
 * 4. Null when nothing remains.
 */
export function pickContext(results: readonly PickableResult[]): PickedContext | null {
  const candidates = results
    .map((result, index) => ({ result, index }))
    .filter(({ result }) => result.relevance !== "low" && (result.highlights?.highlights?.length ?? 0) > 0)
    .sort((a, b) => rankOf(a.result.relevance) - rankOf(b.result.relevance) || a.index - b.index);

  for (const { result } of candidates) {
    const domain = domainOf(result.url);
    if (!domain || isExcludedDomain(domain)) continue;
    for (const passage of result.highlights?.highlights ?? []) {
      for (const chunk of proseChunks(passage)) {
        const text = trimToSentences(splitSentences(chunk));
        if (text) return { text, sourceTitle: cleanTitle(result.title), sourceUrl: result.url, sourceDomain: domain };
      }
    }
  }
  return null;
}
