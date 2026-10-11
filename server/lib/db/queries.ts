// Typed database queries for Hunch. Every function returns plain objects in
// camelCase with numeric columns already converted to JS numbers.
import type { SettledRow } from "../game";
import type { Counters, Lane, Mode, RecentCall, Side } from "../types";
import { getDb, type LeaderboardViewRow, type PlayerRow, type SwipeInsert, type SwipeRow } from "./client";
import { fail, INVALID_TEXT_REPRESENTATION, toNumber, toNumberOrNull, UNIQUE_VIOLATION } from "./shared";

// ---------- Shapes ----------

export interface Player {
  id: string;
  name: string;
  /** Play-money wallet balance in dollars (F8). */
  balance: number;
  /** The player's chosen amount per trade, 1 to 100 (F8). */
  stakePerTrade: number;
  createdAt: string;
}

export interface Swipe {
  id: string;
  playerId: string;
  eventTicker: string;
  instrumentSymbol: string;
  question: string;
  category: string;
  lane: Lane;
  side: Side;
  /** Price of the chosen side at swipe time, 0 to 1. */
  price: number;
  mode: Mode;
  stake: number;
  contracts: number;
  orderId: string | null;
  orderStatus: string | null;
  expiresAt: string;
  settled: boolean;
  won: boolean | null;
  /** One decimal, null until settled. */
  edge: number | null;
  payout: number | null;
  settledAt: string | null;
  createdAt: string;
}

/** A swipe after settlement: won, edge and payout are filled in. */
export interface SettledSwipe extends Swipe {
  settled: true;
  won: boolean;
  edge: number;
  payout: number;
  settledAt: string;
}

/** What the swipe route hands to insertSwipe. Server fills id, settled and created_at. */
export interface NewSwipe {
  playerId: string;
  eventTicker: string;
  instrumentSymbol: string;
  question: string;
  category: string;
  lane: Lane;
  side: Side;
  price: number;
  mode: Mode;
  /** Dollars staked; 0 for practice. */
  stake: number;
  /** Contracts bought; 0 for practice. */
  contracts: number;
  orderId?: string | null;
  orderStatus?: string | null;
  expiresAt: string;
}

export interface Settlement {
  won: boolean;
  /** From edgeFor(price, won); stored with one decimal. */
  edge: number;
  payout: number;
}

/**
 * One row of the leaderboard view. The API layer turns these into
 * LeaderboardRow (lib/types.ts) by adding rank (array index + 1) and level
 * (levelFor over that player's settled swipes; see settledSwipesByPlayers).
 */
export interface LeaderboardEntry {
  playerId: string;
  name: string;
  edgeTotal: number;
  settledCalls: number;
  totalCalls: number;
}

export type CreatePlayerResult = { ok: true; player: Player } | { ok: false; error: "name_taken" };
export type InsertSwipeResult = { ok: true; swipe: Swipe } | { ok: false; error: "already_swiped" };

// ---------- Helpers (numeric conversion and errors live in ./shared) ----------

function toPlayer(row: PlayerRow): Player {
  return {
    id: row.id,
    name: row.name,
    balance: toNumber(row.balance),
    stakePerTrade: toNumber(row.stake_per_trade),
    createdAt: row.created_at,
  };
}

function toSwipe(row: SwipeRow): Swipe {
  return {
    id: row.id,
    playerId: row.player_id,
    eventTicker: row.event_ticker,
    instrumentSymbol: row.instrument_symbol,
    question: row.question,
    category: row.category,
    lane: row.lane,
    side: row.side,
    price: toNumber(row.price),
    mode: row.mode,
    stake: toNumber(row.stake),
    contracts: toNumber(row.contracts),
    orderId: row.order_id,
    orderStatus: row.order_status,
    expiresAt: row.expires_at,
    settled: row.settled,
    won: row.won,
    edge: toNumberOrNull(row.edge),
    payout: toNumberOrNull(row.payout),
    settledAt: row.settled_at,
    createdAt: row.created_at,
  };
}

function toSettledSwipe(row: SwipeRow): SettledSwipe {
  return {
    ...toSwipe(row),
    settled: true,
    won: row.won === true,
    edge: toNumber(row.edge),
    payout: toNumber(row.payout),
    settledAt: row.settled_at ?? row.created_at,
  };
}

function toSettledRow(row: Pick<SwipeRow, "category" | "won" | "price" | "edge">): SettledRow {
  return {
    category: row.category,
    won: row.won === true,
    price: toNumber(row.price),
    edge: toNumber(row.edge),
  };
}

function toLeaderboardEntry(row: LeaderboardViewRow): LeaderboardEntry {
  return {
    playerId: row.player_id,
    name: row.name,
    edgeTotal: toNumber(row.edge_total),
    settledCalls: toNumber(row.settled_calls),
    totalCalls: toNumber(row.total_calls),
  };
}

function toRow(input: NewSwipe): SwipeInsert {
  return {
    player_id: input.playerId,
    event_ticker: input.eventTicker,
    instrument_symbol: input.instrumentSymbol,
    question: input.question,
    category: input.category,
    lane: input.lane,
    side: input.side,
    price: input.price,
    mode: input.mode,
    stake: input.stake,
    contracts: input.contracts,
    order_id: input.orderId ?? null,
    order_status: input.orderStatus ?? null,
    expires_at: input.expiresAt,
  };
}

/** Maps a swipe to the Recent calls shape the Me tab shows (lib/types.ts). */
export function toRecentCall(swipe: Swipe): RecentCall {
  return {
    instrumentSymbol: swipe.instrumentSymbol,
    question: swipe.question,
    side: swipe.side,
    mode: swipe.mode,
    price: swipe.price,
    contracts: swipe.contracts,
    orderId: swipe.orderId,
    result: !swipe.settled ? "pending" : swipe.won ? "won" : "lost",
    payout: swipe.payout,
    edge: swipe.edge,
    settledAt: swipe.settledAt,
  };
}

// ---------- Players ----------

/**
 * Creates a player. Names are unique ignoring case (players_name_lower_idx);
 * a clash returns name_taken instead of throwing.
 */
export async function createPlayer(name: string): Promise<CreatePlayerResult> {
  const { data, error } = await getDb().from("players").insert({ name }).select().single();
  if (error) {
    if (error.code === UNIQUE_VIOLATION) return { ok: false, error: "name_taken" };
    fail("createPlayer", error);
  }
  return { ok: true, player: toPlayer(data) };
}

/** A player by id, or null when missing (a malformed uuid also reads as null). */
export async function getPlayer(id: string): Promise<Player | null> {
  const { data, error } = await getDb().from("players").select().eq("id", id).maybeSingle();
  if (error) {
    if (error.code === INVALID_TEXT_REPRESENTATION) return null;
    fail("getPlayer", error);
  }
  return data ? toPlayer(data) : null;
}

// ---------- Swipes ----------

/** Instrument symbols this player has already swiped (any mode, settled or not). */
export async function swipedSymbols(playerId: string): Promise<Set<string>> {
  const { data, error } = await getDb().from("swipes").select("instrument_symbol").eq("player_id", playerId);
  if (error) fail("swipedSymbols", error);
  return new Set(data.map((row) => row.instrument_symbol));
}

/**
 * Paid swipes created at or after startIso and before endIso (half-open, as
 * laDayBounds returns). Exact count, no rows transferred.
 */
export async function paidCountBetween(playerId: string, startIso: string, endIso: string): Promise<number> {
  const { count, error } = await getDb()
    .from("swipes")
    .select("id", { count: "exact", head: true })
    .eq("player_id", playerId)
    .eq("mode", "paid")
    .gte("created_at", startIso)
    .lt("created_at", endIso);
  if (error) fail("paidCountBetween", error);
  return count ?? 0;
}

/**
 * Inserts one swipe and returns it. A second swipe by the same player on the
 * same instrument hits unique (player_id, instrument_symbol) and returns
 * already_swiped instead of throwing.
 */
export async function insertSwipe(row: NewSwipe): Promise<InsertSwipeResult> {
  const { data, error } = await getDb().from("swipes").insert(toRow(row)).select().single();
  if (error) {
    if (error.code === UNIQUE_VIOLATION) return { ok: false, error: "already_swiped" };
    fail("insertSwipe", error);
  }
  return { ok: true, swipe: toSwipe(data) };
}

/**
 * Unsettled swipes whose market has expired (expires_at before now), oldest
 * expiry first, at most `limit` rows. Uses swipes_unsettled_idx.
 */
export async function unsettledExpired(limit: number, now: Date = new Date()): Promise<Swipe[]> {
  const { data, error } = await getDb()
    .from("swipes")
    .select()
    .eq("settled", false)
    .lt("expires_at", now.toISOString())
    .order("expires_at", { ascending: true })
    .limit(limit);
  if (error) fail("unsettledExpired", error);
  return data.map(toSwipe);
}

/**
 * Marks a swipe settled with its result, setting settled_at to now. Only an
 * unsettled row is touched, so a repeated settlement run cannot double count:
 * returns null when the swipe is missing or was already settled.
 */
export async function settleSwipe(id: string, result: Settlement): Promise<SettledSwipe | null> {
  const { data, error } = await getDb()
    .from("swipes")
    .update({
      settled: true,
      won: result.won,
      edge: result.edge,
      payout: result.payout,
      settled_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("settled", false)
    .select()
    .maybeSingle();
  if (error) fail("settleSwipe", error);
  return data ? toSettledSwipe(data) : null;
}

/**
 * Every settled swipe for a player, oldest settlement first, in the four
 * columns levelFor, progressFor and categoryStats need.
 */
export async function settledSwipes(playerId: string): Promise<SettledRow[]> {
  const { data, error } = await getDb()
    .from("swipes")
    .select("category, won, price, edge")
    .eq("player_id", playerId)
    .eq("settled", true)
    .order("settled_at", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) fail("settledSwipes", error);
  return data.map(toSettledRow);
}

/**
 * Settled swipes for many players in one query, grouped by player id
 * (oldest first within each player). Lets the leaderboard compute levels
 * without one query per row. Players with no settled swipes are absent.
 */
export async function settledSwipesByPlayers(playerIds: readonly string[]): Promise<Map<string, SettledRow[]>> {
  const grouped = new Map<string, SettledRow[]>();
  if (playerIds.length === 0) return grouped;
  const { data, error } = await getDb()
    .from("swipes")
    .select("player_id, category, won, price, edge")
    .in("player_id", [...playerIds])
    .eq("settled", true)
    .order("settled_at", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) fail("settledSwipesByPlayers", error);
  for (const row of data) {
    const list = grouped.get(row.player_id);
    const settled = toSettledRow(row);
    if (list) list.push(settled);
    else grouped.set(row.player_id, [settled]);
  }
  return grouped;
}

/** The last n settled swipes for a player as full rows, oldest first. */
export async function lastSettled(playerId: string, n: number): Promise<SettledSwipe[]> {
  const { data, error } = await getDb()
    .from("swipes")
    .select()
    .eq("player_id", playerId)
    .eq("settled", true)
    .order("settled_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(n);
  if (error) fail("lastSettled", error);
  return data.map(toSettledSwipe).reverse();
}

/** The last n swipes for a player (any mode, settled or not), newest first. Uses swipes_player_idx. */
export async function recentSwipes(playerId: string, n: number): Promise<Swipe[]> {
  const { data, error } = await getDb()
    .from("swipes")
    .select()
    .eq("player_id", playerId)
    .order("created_at", { ascending: false })
    .limit(n);
  if (error) fail("recentSwipes", error);
  return data.map(toSwipe);
}

// ---------- Leaderboard and counters ----------

/**
 * Top rows of the leaderboard view: Edge total descending, then settled
 * calls descending, then name. Raw entries; see LeaderboardEntry for how the
 * API layer adds rank and level.
 */
export async function leaderboardRows(limit: number): Promise<LeaderboardEntry[]> {
  const { data, error } = await getDb()
    .from("leaderboard")
    .select()
    .order("edge_total", { ascending: false })
    .order("settled_calls", { ascending: false })
    .order("name", { ascending: true })
    .limit(limit);
  if (error) fail("leaderboardRows", error);
  return data.map(toLeaderboardEntry);
}

/** Players, swipes (calls) and swipes that placed a Gemini order (non-null order_id). Exact counts. */
export async function counters(): Promise<Counters> {
  const db = getDb();
  const [players, calls, orders] = await Promise.all([
    db.from("players").select("id", { count: "exact", head: true }),
    db.from("swipes").select("id", { count: "exact", head: true }),
    db.from("swipes").select("id", { count: "exact", head: true }).not("order_id", "is", null),
  ]);
  if (players.error) fail("counters.players", players.error);
  if (calls.error) fail("counters.calls", calls.error);
  if (orders.error) fail("counters.geminiOrders", orders.error);
  return {
    players: players.count ?? 0,
    calls: calls.count ?? 0,
    geminiOrders: orders.count ?? 0,
  };
}
