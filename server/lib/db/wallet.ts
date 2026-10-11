// Play-money wallet queries (SPEC F8). Balances live on players; every
// movement is a wallet_tx row. adjust_balance is a SQL function so the
// balance update is atomic even when two swipes land at once.
import type { WalletTx } from "../types";
import { getDb, type WalletTxKind, type WalletTxRow } from "./client";
import { fail, INVALID_TEXT_REPRESENTATION, roundCents, toNumber } from "./shared";

/** Every player starts here, and "Reset wallet" returns here. */
export const STARTING_BALANCE = 1000;

export interface WalletBalance {
  balance: number;
  stakePerTrade: number;
}

export interface WalletTxInput {
  kind: WalletTxKind;
  /** The swipe behind a stake or payout; omit for a reset. */
  swipeId?: string | null;
  /** Short label for the Wallet screen, for example the question. */
  note?: string | null;
}

function toWalletBalance(row: { balance: number | string; stake_per_trade: number | string }): WalletBalance {
  return { balance: toNumber(row.balance), stakePerTrade: toNumber(row.stake_per_trade) };
}

function toWalletTx(row: WalletTxRow): WalletTx {
  return {
    id: row.id,
    kind: row.kind,
    amount: toNumber(row.amount),
    balanceAfter: toNumber(row.balance_after),
    note: row.note,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

/** Balance and amount per trade for a player, or null when missing (a malformed uuid also reads as null). */
export async function getWallet(playerId: string): Promise<WalletBalance | null> {
  const { data, error } = await getDb().from("players").select("balance, stake_per_trade").eq("id", playerId).maybeSingle();
  if (error) {
    if (error.code === INVALID_TEXT_REPRESENTATION) return null;
    fail("getWallet", error);
  }
  return data ? toWalletBalance(data) : null;
}

/**
 * Saves the player's amount per trade (the route validates 1 to 100; the
 * value is rounded to cents here) and returns the wallet. Throws when the
 * player does not exist.
 */
export async function setStakePerTrade(playerId: string, amount: number): Promise<WalletBalance> {
  const { data, error } = await getDb()
    .from("players")
    .update({ stake_per_trade: roundCents(amount) })
    .eq("id", playerId)
    .select("balance, stake_per_trade")
    .single();
  if (error) fail("setStakePerTrade", error);
  return toWalletBalance(data);
}

/**
 * Moves the balance by `delta` (negative for a stake, positive for a payout
 * or reset) through the atomic adjust_balance function, records the
 * wallet_tx row with balance_after, and returns the new balance. The delta is
 * rounded to cents first so the stored amount matches the balance change
 * exactly. Throws when the player does not exist.
 */
export async function adjustBalance(playerId: string, delta: number, tx: WalletTxInput): Promise<number> {
  const db = getDb();
  const amount = roundCents(delta);
  const { data, error } = await db.rpc("adjust_balance", { p_player: playerId, p_delta: amount });
  if (error) fail("adjustBalance.rpc", error);
  if (data === null || data === undefined) throw new Error(`adjustBalance: player ${playerId} not found`);
  const balanceAfter = toNumber(data);

  const inserted = await db.from("wallet_tx").insert({
    player_id: playerId,
    swipe_id: tx.swipeId ?? null,
    kind: tx.kind,
    amount,
    balance_after: balanceAfter,
    note: tx.note ?? null,
  });
  if (inserted.error) fail("adjustBalance.tx", inserted.error);
  return balanceAfter;
}

/** Puts the balance back to STARTING_BALANCE with one "reset" transaction and returns the new balance. */
export async function resetWallet(playerId: string): Promise<number> {
  const wallet = await getWallet(playerId);
  if (!wallet) throw new Error(`resetWallet: player ${playerId} not found`);
  const delta = roundCents(STARTING_BALANCE - wallet.balance);
  return adjustBalance(playerId, delta, { kind: "reset", note: "Wallet reset to $1,000" });
}

/** The player's last n wallet transactions, newest first, in the shared WalletTx shape. */
export async function listWalletTx(playerId: string, n = 50): Promise<WalletTx[]> {
  const { data, error } = await getDb()
    .from("wallet_tx")
    .select()
    .eq("player_id", playerId)
    .order("created_at", { ascending: false })
    .limit(n);
  if (error) fail("listWalletTx", error);
  return data.map(toWalletTx);
}
