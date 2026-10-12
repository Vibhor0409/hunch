// Tier 3: the market's own rules, in two or three plain sentences. Pure: no I/O.
// Spec: docs/CONTEXT_DEV.md, "Always-on context". Free and always available, so
// the card back is never empty.
//
// Fields used, as seen in docs/samples/events-production.json and events.json:
// - contract.description: a rich text document, { nodeType: "document",
//   content: [{ nodeType: "text", value }] }. The value is markdown: its first
//   sentence says what resolves Yes, a later one names the source ("Outcome
//   verified from the Federal Reserve.", "Source Agencies, in order, are ..."),
//   and it ends with a "[full rules](https://...)" link.
// - event.title, contract.label, event.contracts (to spot a description shared
//   word for word by every option of an event, which then cannot be about one
//   option: STRIPEIPO gives all its date options the same text).
// - event.sourceDetails.index: the price index of crypto and commodity markets.
// - event.termsLink and contract.termsAndConditionsUrl: public links to the
//   full terms, empty on some events.
// - the card's expiresAt (contract.expiryDate, else event.expiryDate).
// Nothing is read from `prices`: blind means blind (CLAUDE.md rule 5).
import type { GeminiContract, GeminiEvent } from "../gemini/client";
import type { CardPublic } from "../types";
import { MAX_LINE_LENGTH, clipAtWord, decodeEntities, mentionsOdds } from "./pick";

export const MARKET_SOURCE_TITLE = "Market rules on Gemini";
/** Longest "what resolves Yes" sentence. It is the card's one line, so the one-line limit applies. */
const MAX_RULE_LENGTH = MAX_LINE_LENGTH;
/** Longest source sentence; some rules list twenty outlets. */
const MAX_SOURCE_LENGTH = 130;
/** Past this marketSentences leaves the source sentence out, keeping the rule and the close time. */
const MAX_SENTENCES_LENGTH = 360;
/** Longest tier 3 text: one line. */
export const MAX_MARKET_TEXT_LENGTH = MAX_LINE_LENGTH;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The parts of a card this module reads. Prices are not among them. */
export type MarketCard = Pick<CardPublic, "question" | "category" | "expiresAt">;

export interface MarketContext {
  text: string;
  sourceTitle: string;
  sourceUrl: string | null;
  sourceDomain: null;
}

// ---------- Rich text to plain text ----------

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** The text of a rich text node: text nodes joined in place, block children on their own lines. */
export function richText(node: unknown): string {
  if (typeof node === "string") return node;
  if (!isRecord(node)) return "";
  if (typeof node.value === "string") return node.value;
  if (!Array.isArray(node.content)) return "";
  const inline = node.content.every((child) => isRecord(child) && typeof child.value === "string");
  return node.content.map(richText).join(inline ? "" : "\n");
}

/** Markdown and HTML removed, entities decoded, whitespace collapsed. Link text stays, addresses go. */
export function plainText(raw: string): string {
  return decodeEntities(
    raw
      .replace(/!?\[([^\]]*)\]\(\s*<?[^)]*>?\s*\)/g, "$1") // [text](url) and [text](<url>)
      .replace(/<https?:\/\/[^>\s]*>/gi, " ") // <https://...> autolinks
      .replace(/<\/?[a-z][^>]*>/gi, " "), // HTML tags
  )
    .replace(/<\/?[a-z][^>]*>/gi, " ") // tags that were written as entities
    .replace(/https?:\/\/\S+/gi, " ") // bare addresses
    .replace(/\*\*|__|`/g, "")
    .replace(/\s*\u2014\s*/g, ", ") // long dashes read as commas (CLAUDE.md rule 14)
    .replace(/^\s*(?:#{1,6}|[-*•>])\s+/gm, "")
    .replace(/\s+/g, " ") // \s covers the no-break spaces the rules carry
    .replace(/\s+([.,;:!?])(?=\s|$)/g, "$1")
    .trim();
}

/**
 * Sentence breaks for rules text. Unlike news text (pick.ts splitSentences),
 * rules end sentences with "Yes.", "No.", "ET." and acronyms, so a break is
 * refused only after a single letter ("U.S.", "p.m.") or a common abbreviation.
 */
const RULE_BREAK =
  /(?<=[.!?]["'”’)\]]?)(?<!(?:^|[\s.(])[A-Za-z]\.["'”’)\]]?)(?<!\b(?:Mr|Mrs|Ms|Dr|Jr|Sr|St|vs|Inc|Ltd|Co|Corp|Sen|Rep|Gov|Gen|Mt|Ft|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.["'”’)\]]?)\s+(?=["'“‘(\[]?[A-Z0-9])/;

/** The sentences of a contract's rules, without the "View the full rules" pointer to a link. */
export function ruleSentences(contract: GeminiContract | null): string[] {
  const description: unknown = contract?.description;
  return plainText(richText(description))
    .split(RULE_BREAK)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !/^(?:view|read|see) the full\b/i.test(s));
}

// ---------- Sentences ----------

const SOURCE_SENTENCE = /^(?:outcomes? (?:should be |is |are |will be )?verified\b|source agenc(?:y|ies)\b|the resolution source\b|sources? (?:from|include)\b)/i;
/** A feed identifier such as "KK_RFR_XAUUSDC" or "LS-LRRR-XRPUSD", not a sport name. */
const INDEX_ID = /^[A-Z0-9]+(?:[_-][A-Z0-9]+)+$/;

function closed(sentence: string): string {
  const trimmed = sentence.trim();
  return /[.!?]["'”’)\]]?$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

/** The sentence within `max` characters: asides in brackets go first, then a cut at a word. */
function fit(sentence: string, max: number): string {
  if (sentence.length <= max) return sentence;
  const lean = sentence.replace(/\s*\([^()]*\)/g, "").replace(/\s+([.,;:!?])/g, "$1").trim();
  return lean.length <= max ? lean : clipAtWord(lean, max);
}

function clean(value: string | null | undefined): string {
  return plainText(value ?? "").replace(/\?+$/, "").trim();
}

/** True when another option of the event carries the same description under a different label. */
function sharesDescription(event: GeminiEvent, contract: GeminiContract): boolean {
  const own = richText(contract.description as unknown).trim();
  if (!own) return false;
  return (event.contracts ?? []).some(
    (other) => other !== contract && other.instrumentSymbol !== contract.instrumentSymbol && (other.label ?? "") !== (contract.label ?? "") && richText(other.description as unknown).trim() === own,
  );
}

/** What resolves Yes, from the contract's own rules when they are about this option. */
function ruleFromDescription(event: GeminiEvent, contract: GeminiContract, sentences: readonly string[]): string | null {
  if (sharesDescription(event, contract)) return null;
  const resolving = sentences.filter((s) => /\bresolv/i.test(s) && !SOURCE_SENTENCE.test(s) && !mentionsOdds(s));
  const rule = resolving.find((s) => /\byes\b/i.test(s)) ?? resolving[0];
  return rule ? fit(closed(rule), MAX_RULE_LENGTH) : null;
}

/** What resolves Yes, written from the title and the option label. */
function ruleFromLabel(event: GeminiEvent | null, contract: GeminiContract | null, card: MarketCard): string | null {
  const title = clean(event?.title);
  const label = clean(contract?.label);
  const question = plainText(card.question);
  const candidates = [
    title && label && !/^(?:yes|up|down)$/i.test(label) ? `This market resolves YES if the outcome of "${title}" is "${label}".` : null,
    question ? `This market resolves YES if the answer to "${question}" is yes, and NO otherwise.` : null,
    question ? `This market resolves YES if the answer to "${question}" is yes.` : null,
  ];
  for (const candidate of candidates) {
    if (candidate && candidate.length <= MAX_RULE_LENGTH && !mentionsOdds(candidate)) return candidate;
  }
  return null;
}

/** The last resort: no question text, so it is safe for any market. */
function ruleFromCategory(card: MarketCard): string {
  const category = plainText(card.category);
  const named = category && category.toLowerCase() !== "other" && !mentionsOdds(category) && /^[\p{L}\p{N} &/-]{1,40}$/u.test(category);
  return named ? `This is a yes or no market in ${category}.` : "This is a yes or no market.";
}

/** The reference source: the rules' own sentence, else the event's price index. */
function sourceSentence(event: GeminiEvent | null, sentences: readonly string[]): string | null {
  const named = sentences.find((s) => SOURCE_SENTENCE.test(s) && !mentionsOdds(s));
  if (named) return fit(closed(named), MAX_SOURCE_LENGTH);
  const index = (event?.sourceDetails?.index ?? "").trim();
  return INDEX_ID.test(index) ? `The outcome is checked against the ${index} index.` : null;
}

const NEW_YORK = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "long",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

/** "October 12, 2026 at 5:00 PM ET" for an instant, in America/New_York. Null when unparseable. */
export function newYorkTime(iso: string): string | null {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return null;
  const parts: Record<string, string> = {};
  for (const part of NEW_YORK.formatToParts(date)) parts[part.type] = part.value;
  return `${parts.month} ${parts.day}, ${parts.year} at ${parts.hour}:${parts.minute} ${parts.dayPeriod} ET`;
}

/** When the market closes: the New York time, plus "in N days" from two days out. */
export function closeSentence(expiresAt: string, now: Date): string | null {
  const when = newYorkTime(expiresAt);
  if (!when) return null;
  const remaining = new Date(expiresAt).getTime() - now.getTime();
  if (remaining <= 0) return `It closed on ${when}.`;
  const days = Math.floor(remaining / DAY_MS);
  return days >= 2 ? `It closes on ${when}, in ${days} days.` : `It closes on ${when}.`;
}

// ---------- Link ----------

/**
 * A public link to the full terms, when the event data carries one: an https
 * address without access parameters (some links are storage addresses with a
 * token in the query; those are not passed on). No address is ever built here.
 */
function termsUrl(event: GeminiEvent | null, contract: GeminiContract | null): string | null {
  const eventLink = (event as unknown as Record<string, unknown> | null)?.termsLink; // seen in the samples, not in the SDK type
  for (const candidate of [eventLink, contract?.termsAndConditionsUrl]) {
    if (typeof candidate !== "string") continue;
    try {
      const url = new URL(candidate.trim());
      if (url.protocol !== "https:" || url.username || url.password) continue;
      if ([...url.searchParams.keys()].some((name) => /token|key|sig|secret|auth/i.test(name))) continue;
      return url.toString();
    } catch {
      continue;
    }
  }
  return null;
}

// ---------- Tier 3 ----------

/**
 * The market's rules as sentences, in order: what resolves Yes, the reference
 * source when the rules name one, and when it closes (New York time). Two or
 * three sentences; the first is never missing. With no event (the lookup
 * failed) or no contract they are built from the card alone. No prices, no
 * odds: nothing is read from `prices`, and any sentence the odds filter flags
 * is dropped.
 */
export function marketSentences(event: GeminiEvent | null, contract: GeminiContract | null, card: MarketCard, now: Date = new Date()): string[] {
  const sentences = ruleSentences(contract);
  const rule = (event && contract ? ruleFromDescription(event, contract, sentences) : null) ?? ruleFromLabel(event, contract, card) ?? ruleFromCategory(card);
  const source = sourceSentence(event, sentences);
  const close = closeSentence(card.expiresAt, now);

  const full = [rule, source, close].filter((s): s is string => s !== null);
  return full.join(" ").length <= MAX_SENTENCES_LENGTH ? full : [rule, close].filter((s): s is string => s !== null);
}

/**
 * The market's rules for a card back, as one line: the first of
 * marketSentences, which says what resolves Yes, in at most 180 characters.
 * Never empty.
 */
export function marketContext(event: GeminiEvent | null, contract: GeminiContract | null, card: MarketCard, now: Date = new Date()): MarketContext {
  const line = marketSentences(event, contract, card, now)[0] ?? ruleFromCategory(card);
  return { text: fit(line, MAX_LINE_LENGTH), sourceTitle: MARKET_SOURCE_TITLE, sourceUrl: termsUrl(event, contract), sourceDomain: null };
}
