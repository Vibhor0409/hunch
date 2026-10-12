// Picks one safe context line from Context.dev search results. Pure: no I/O.
// Spec: docs/CONTEXT_DEV.md, "pickContext" and "Always-on context". Shapes
// follow docs/samples/context-search.json, where a highlight passage is several
// excerpts joined by "…" lines, with bracketed section headers, markdown tables
// and HTML entities mixed in, and a description is a short search snippet that
// often ends cut off with "...".
import { EXCLUDED_DOMAINS } from "./client";

/** Longest context line the card back shows (two to three lines). */
export const MAX_TEXT_LENGTH = 220;
/** The card back reads as one line: a single sentence of at most this many characters. */
export const MAX_LINE_LENGTH = 180;
/** A sentence shorter than this ("Mostly cloudy.", "Hot.") is a fragment and cannot be the line on its own. */
const MIN_LINE_WORDS = 4;
/** Excerpts shorter than this are headers, numbers or dates, not news. */
const MIN_CHUNK_LENGTH = 40;
/** Below this share of letters an excerpt is a price table, not prose. */
const MIN_LETTER_RATIO = 0.5;

/** The parts of a search result this module reads (a subset of client.ts SearchResult). */
export interface PickableResult {
  url: string;
  title?: string | null;
  description?: string | null;
  relevance?: string | null;
  highlights?: { highlights?: string[] | null } | null;
}

/** Looser rules for the broad tier (tier 2). The strict tier passes none. */
export interface PickOptions {
  /** A result's description stands in when its highlights are missing or hold no usable sentence. */
  allowDescription?: boolean;
  /** Results rated "low" are tried after every other result, as a last resort. */
  allowLowRelevance?: boolean;
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

export function decodeEntities(text: string): string {
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

/** A snippet sentence shorter than this is a title or a list entry ("Star Wars: Zero Company."), not a statement. */
const MIN_SNIPPET_WORDS = 6;

/** Small words every statement leans on. A tag list ("Stripe payments private commerce finance stock offers IPO.") has none. */
const FUNCTION_WORD =
  /\b(?:the|a|an|is|are|was|were|be|been|has|have|had|will|would|can|could|should|may|might|to|of|in|on|for|with|by|at|from|that|this|as|after|before|its|their|his|her)\b/gi;

/**
 * True for a statement: enough words, mostly letters (a price strip is mostly
 * digits), and at least two different function words.
 */
function isProseSentence(sentence: string): boolean {
  const letters = (sentence.match(/\p{L}/gu) ?? []).length;
  if (letters / sentence.length < MIN_LETTER_RATIO || sentence.split(/\s+/).length < MIN_SNIPPET_WORDS) return false;
  const functionWords = new Set((sentence.match(FUNCTION_WORD) ?? []).map((word) => word.toLowerCase()));
  return functionWords.size >= 2;
}

/**
 * The prose pieces of a result description (a search snippet). Pieces are
 * split on "..." and "…" (the snippet's own cut marks), so a piece that was
 * cut off has no closing punctuation and is dropped by trimToSentences.
 */
export function snippetChunks(description: string): string[] {
  return decodeEntities(description)
    .replace(/\*\*|__/g, "")
    .split(/\s*(?:\.{3,}|…)\s*/)
    .map((piece) => piece.replace(/\s+/g, " ").trim())
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
export function clipAtWord(sentence: string, max: number): string {
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

/**
 * The one-line rule: the first qualifying sentence, alone. A sentence
 * qualifies when it is whole, passes the odds filter and has at least four
 * words. Over-long sentences are handled as trimToSentences does: a later
 * sentence that fits is taken, and when none fits the first is clipped at a
 * word boundary with "...". Null when no sentence qualifies.
 */
export function oneSentence(sentences: readonly string[], max: number = MAX_LINE_LENGTH): string | null {
  const eligible = sentences.filter((s) => isWholeSentence(s) && !mentionsOdds(s) && s.split(/\s+/).length >= MIN_LINE_WORDS);
  const first = eligible[0];
  if (!first) return null;
  return eligible.find((s) => s.length <= max) ?? clipAtWord(first, max);
}

/**
 * A stored or picked text as one line: its first qualifying sentence. Text
 * stored before the one-line rule held up to three sentences, so this runs on
 * every web answer. Text without a qualifying sentence is kept, clipped when
 * too long. A line that already follows the rule comes back unchanged.
 */
export function oneLine(text: string, max: number = MAX_LINE_LENGTH): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return oneSentence(splitSentences(clean), max) ?? (clean.length <= max ? clean : clipAtWord(clean, max));
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

/**
 * Sites whose search snippet is a post or a comment rather than reporting. A
 * description from one of them never stands in for a highlight.
 */
const POST_DOMAINS: readonly string[] = [
  "reddit.com",
  "facebook.com",
  "instagram.com",
  "threads.net",
  "x.com",
  "twitter.com",
  "tiktok.com",
  "youtube.com",
  "linkedin.com",
  "pinterest.com",
  "quora.com",
];

function isPostDomain(domain: string): boolean {
  return POST_DOMAINS.some((site) => domain === site || domain.endsWith(`.${site}`));
}

function cleanTitle(title: string | null | undefined): string | null {
  const cleaned = (title ?? "").replace(/\s+/g, " ").trim();
  return cleaned.length > 0 ? cleaned : null;
}

const RELEVANCE_RANK: Record<string, number> = { high: 0, medium: 1 };

function rankOf(relevance: string | null | undefined): number {
  return RELEVANCE_RANK[relevance ?? ""] ?? 2;
}

interface Candidate {
  result: PickableResult;
  domain: string;
}

/** The first highlight excerpt of a result that still has text after the trim and the odds filter. */
function fromHighlights(result: PickableResult): string | null {
  for (const passage of result.highlights?.highlights ?? []) {
    for (const chunk of proseChunks(passage)) {
      const text = oneSentence(splitSentences(chunk));
      if (text) return text;
    }
  }
  return null;
}

/** The same for a result's description: whole, statement-like sentences only, and not from a site of posts. */
function fromDescription(result: PickableResult, domain: string): string | null {
  if (isPostDomain(domain)) return null;
  for (const chunk of snippetChunks(result.description ?? "")) {
    // A snippet runs prose into price strips ("... by MarketWatch. $6.6 $6.7"), so it also breaks before a currency sign.
    const sentences = splitSentences(chunk).flatMap((sentence) => sentence.split(/(?<=[.!?])\s+(?=[$€£])/));
    const text = oneSentence(sentences.filter(isProseSentence));
    if (text) return text;
  }
  return null;
}

function firstPick(candidates: readonly Candidate[], textOf: (result: PickableResult, domain: string) => string | null): PickedContext | null {
  for (const { result, domain } of candidates) {
    const text = textOf(result, domain);
    if (text) return { text, sourceTitle: cleanTitle(result.title), sourceUrl: result.url, sourceDomain: domain };
  }
  return null;
}

/**
 * One context line and its source, or null.
 * 1. Results with an unparseable URL or from an excluded odds site are
 *    skipped, always.
 * 2. Results rated "low" are skipped, and the rest are visited best first
 *    (high, then medium, then unrated; ties keep the API order). Within a
 *    result, each highlight passage's prose excerpts are tried in order.
 * 3. The first excerpt that still has a line after oneSentence (one whole
 *    sentence, at most 180 characters, odds sentences dropped) wins.
 * 4. With `allowDescription`, when no highlight gave a line, the results'
 *    descriptions are tried in the same order and under the same trim. Only
 *    statements count (no titles, tag lists or price strips), and sites of
 *    posts and comments are passed over.
 * 5. With `allowLowRelevance`, when nothing above gave a line, steps 2 to 4
 *    run again over the results rated "low".
 * 6. Null when nothing remains.
 */
export function pickContext(results: readonly PickableResult[], options: PickOptions = {}): PickedContext | null {
  const usable: (Candidate & { index: number })[] = [];
  results.forEach((result, index) => {
    const domain = domainOf(result.url);
    if (domain && !isExcludedDomain(domain)) usable.push({ result, domain, index });
  });
  usable.sort((a, b) => rankOf(a.result.relevance) - rankOf(b.result.relevance) || a.index - b.index);

  const groups = [usable.filter(({ result }) => result.relevance !== "low")];
  if (options.allowLowRelevance) groups.push(usable.filter(({ result }) => result.relevance === "low"));

  for (const group of groups) {
    const picked = firstPick(group, fromHighlights) ?? (options.allowDescription ? firstPick(group, fromDescription) : null);
    if (picked) return picked;
  }
  return null;
}
