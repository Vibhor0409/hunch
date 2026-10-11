import { listWalletTx, STARTING_BALANCE } from "@/lib/db/wallet";
import type { Wallet } from "@/lib/types";

/** Every player starts with this much play money (SPEC F8); defined once in lib/db/wallet.ts. */
export { STARTING_BALANCE };
/** Transactions shown on the Wallet screen, newest first. */
export const WALLET_TX_LIMIT = 50;

/** Rounds dollars to cents and normalizes negative zero. */
export function round2(value: number): number {
  const rounded = Math.round(value * 100) / 100;
  return rounded === 0 ? 0 : rounded;
}

/** The Wallet payload for a player whose balance and amount per trade are already known. */
export async function walletFor(playerId: string, balance: number, stakePerTrade: number): Promise<Wallet> {
  const transactions = await listWalletTx(playerId, WALLET_TX_LIMIT);
  return { balance, stakePerTrade, startingBalance: STARTING_BALANCE, transactions };
}
