// Shared contracts for Hunch. Copied to lib/types.ts in Phase 1.
// Only the orchestrator may change this file.

export type Lane = "live" | "tomorrow" | "week" | "later"; // later = expires beyond 7 days (elections, seasons)
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
  tradable: boolean; // true when the instrument exists on the Gemini sandbox, so a paid swipe can place an order
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
  stake: number; // dollars per paid swipe (the player's setting)
  balance: number; // play-money wallet balance in dollars
  stakePerTrade: number; // the player's chosen amount per trade, 1 to 100
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
  cost: number; // dollars debited from the wallet (contracts x price), 0 for practice
  balanceAfter: number; // wallet balance after this swipe
  tradeId?: string; // Hunch's own id for this stored call, for example "HN-3F9A21C7"; shown on wallet trades that have no exchange order
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
  kind: "web" | "market"; // web = live context from Context.dev; market = the market's own rules from Gemini (always available)
  text: string | null;
  sourceTitle: string | null;
  sourceUrl: string | null;
  sourceDomain: string | null;
  cached: boolean;
}

/** Play-money wallet (F8). Every paid swipe debits the cost; settlement credits the payout. */
export interface WalletTx {
  id: string;
  kind: "stake" | "payout" | "reset";
  amount: number; // negative for a stake, positive for a payout or reset
  balanceAfter: number;
  note: string | null; // short label, for example the question
  createdAt: string; // ISO 8601
}

export interface Wallet {
  balance: number;
  stakePerTrade: number;
  startingBalance: number; // 1000
  transactions: WalletTx[]; // newest first, up to 50
}
