// Shared contracts for Hunch. Copied to lib/types.ts in Phase 1.
// Only the orchestrator may change this file.

export type Lane = "live" | "tomorrow" | "week";
export type LaneFilter = Lane | "foryou";
export type Side = "yes" | "no";
export type Mode = "paid" | "practice";

/** What the client sees before a swipe. Never includes prices. */
export interface CardPublic {
  eventTicker: string;
  instrumentSymbol: string;
  question: string;
  category: string;
  lane: Lane;
  expiresAt: string; // ISO 8601
}

/** Server-only: a card with its current prices. Never sent to the client. */
export interface CardQuote extends CardPublic {
  yesPrice: number; // 0 to 1, buy price of YES
  noPrice: number; // 0 to 1, buy price of NO
}

export interface PlayerStatus {
  playerId: string;
  name: string;
  level: 1 | 2 | 3 | 4;
  dailyCap: number;
  paidUsedToday: number;
  paidLeftToday: number;
  stake: number; // dollars per paid swipe
}

export interface OrderReceipt {
  orderId: string | null; // String(bigint) from Gemini
  status: "filled" | "open" | "cancelled" | "not_placed" | "error";
  symbol: string;
  price: number;
  contracts: number;
  message?: string; // e.g. "No fill at this price. Scored as practice."
}

export interface Reveal {
  side: Side;
  yesPct: number; // 0 to 100, rounded
  noPct: number;
  sidedWithPct: number; // market probability of the chosen side
  mode: Mode;
  stake: number;
  contracts: number;
  payoutIfRight: number; // contracts x $1 when paid, else 0
  receipt: OrderReceipt | null; // null for practice swipes that placed no order
  status: PlayerStatus;
}

export interface LeaderboardRow {
  rank: number;
  playerId: string;
  name: string;
  edgeTotal: number;
  settledCalls: number;
  level: 1 | 2 | 3 | 4;
}

export interface Counters {
  players: number;
  calls: number;
  geminiOrders: number;
}

export interface CategoryStat {
  category: string;
  settledCalls: number;
  hitRate: number; // 0 to 1
  avgImplied: number; // 0 to 1, average price of chosen side
  edgeTotal: number;
}

export interface LevelProgress {
  level: 1 | 2 | 3 | 4;
  nextLevel: 2 | 3 | 4 | null;
  settledCalls: number;
  callsNeeded: number | null;
  avgEdge: number;
  avgEdgeNeeded: number | null;
  rule: string; // "Lose your edge, lose the level."
}

export interface RecentCall {
  instrumentSymbol: string;
  question: string;
  side: Side;
  mode: Mode;
  price: number;
  contracts: number;
  orderId: string | null;
  result: "pending" | "won" | "lost";
  payout: number | null;
  edge: number | null;
  settledAt: string | null;
}

export interface Profile {
  status: PlayerStatus;
  edgeTotal: number;
  progress: LevelProgress;
  categories: CategoryStat[];
  insight: string | null;
  recent: RecentCall[]; // last 10 swipes, newest first
}

/** Live context for a card back (Context.dev add-on). Never includes odds. */
export interface CardContext {
  available: boolean;
  text: string | null;
  sourceTitle: string | null;
  sourceUrl: string | null;
  sourceDomain: string | null;
  cached: boolean;
}
