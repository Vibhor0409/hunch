// Supabase client for the Hunch API. Service role key, server only.
// No "server-only" import: scripts run this module under tsx, outside Next.js.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Lane, Mode, Side } from "../types";

/** JSON as Postgres jsonb holds it (same shape the Supabase codegen uses). */
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

/** players table, as supabase/schema.sql defines it (wallet columns added by the F8 migration). */
export type PlayerRow = {
  id: string;
  name: string;
  /** Play-money balance in dollars, numeric(12,2), default 1000. */
  balance: number;
  /** The player's amount per trade, numeric(8,2), 1 to 100, default 1. */
  stake_per_trade: number;
  created_at: string;
};

export type PlayerInsert = {
  id?: string;
  name: string;
  balance?: number;
  stake_per_trade?: number;
  created_at?: string;
};

export type PlayerUpdate = Partial<PlayerInsert>;

/**
 * swipes table, as supabase/schema.sql defines it. PostgREST serializes the
 * numeric columns (price, stake, contracts, edge, payout) as JSON numbers;
 * queries.ts still passes every one through a single toNumber() helper so a
 * string on the wire can never leak into game math.
 */
export type SwipeRow = {
  id: string;
  player_id: string;
  event_ticker: string;
  instrument_symbol: string;
  question: string;
  category: string;
  lane: Lane;
  side: Side;
  price: number;
  mode: Mode;
  stake: number;
  contracts: number;
  order_id: string | null;
  order_status: string | null;
  expires_at: string;
  settled: boolean;
  won: boolean | null;
  edge: number | null;
  payout: number | null;
  settled_at: string | null;
  created_at: string;
};

export type SwipeInsert = {
  id?: string;
  player_id: string;
  event_ticker: string;
  instrument_symbol: string;
  question: string;
  category: string;
  lane: Lane;
  side: Side;
  price: number;
  mode: Mode;
  stake?: number;
  contracts?: number;
  order_id?: string | null;
  order_status?: string | null;
  expires_at: string;
  settled?: boolean;
  won?: boolean | null;
  edge?: number | null;
  payout?: number | null;
  settled_at?: string | null;
  created_at?: string;
};

export type SwipeUpdate = Partial<SwipeInsert>;

/** leaderboard view: one row per player, settled Edge summed. */
export type LeaderboardViewRow = {
  player_id: string;
  name: string;
  edge_total: number;
  settled_calls: number;
  total_calls: number;
};

export type WalletTxKind = "stake" | "payout" | "reset";

/** wallet_tx table (F8): one row per balance movement. */
export type WalletTxRow = {
  id: string;
  player_id: string;
  /** The swipe that caused the movement; null for a reset or after the swipe is deleted. */
  swipe_id: string | null;
  kind: WalletTxKind;
  /** Negative for a stake, positive for a payout or reset. numeric(12,2). */
  amount: number;
  balance_after: number;
  note: string | null;
  created_at: string;
};

export type WalletTxInsert = {
  id?: string;
  player_id: string;
  swipe_id?: string | null;
  kind: WalletTxKind;
  amount: number;
  balance_after: number;
  note?: string | null;
  created_at?: string;
};

export type WalletTxUpdate = Partial<WalletTxInsert>;

/** feed_snapshot table: the latest built card list per key (see lib/gemini/snapshot.ts). */
export type FeedSnapshotRow = {
  key: string;
  payload: Json;
  fetched_at: string;
};

export type FeedSnapshotInsert = {
  key: string;
  payload: Json;
  fetched_at?: string;
};

export type FeedSnapshotUpdate = Partial<FeedSnapshotInsert>;

/** Hand-written to match supabase/schema.sql (no codegen). Keep in step with it. */
export type Database = {
  public: {
    Tables: {
      players: {
        Row: PlayerRow;
        Insert: PlayerInsert;
        Update: PlayerUpdate;
        Relationships: [];
      };
      swipes: {
        Row: SwipeRow;
        Insert: SwipeInsert;
        Update: SwipeUpdate;
        Relationships: [
          {
            foreignKeyName: "swipes_player_id_fkey";
            columns: ["player_id"];
            isOneToOne: false;
            referencedRelation: "players";
            referencedColumns: ["id"];
          },
        ];
      };
      wallet_tx: {
        Row: WalletTxRow;
        Insert: WalletTxInsert;
        Update: WalletTxUpdate;
        Relationships: [
          {
            foreignKeyName: "wallet_tx_player_id_fkey";
            columns: ["player_id"];
            isOneToOne: false;
            referencedRelation: "players";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "wallet_tx_swipe_id_fkey";
            columns: ["swipe_id"];
            isOneToOne: false;
            referencedRelation: "swipes";
            referencedColumns: ["id"];
          },
        ];
      };
      feed_snapshot: {
        Row: FeedSnapshotRow;
        Insert: FeedSnapshotInsert;
        Update: FeedSnapshotUpdate;
        Relationships: [];
      };
    };
    Views: {
      leaderboard: {
        Row: LeaderboardViewRow;
        Relationships: [];
      };
    };
    Functions: {
      /** update players set balance = balance + p_delta ... returning balance; null when the player is missing. */
      adjust_balance: {
        Args: { p_player: string; p_delta: number };
        Returns: number;
      };
    };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};

export type Db = SupabaseClient<Database>;

let cached: Db | null = null;

function requireEnv(name: "SUPABASE_URL" | "SUPABASE_SERVICE_ROLE_KEY"): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(`Missing environment variable ${name}. Set it in server/.env.local (or Vercel env vars).`);
  }
  return value.trim();
}

/**
 * The shared Supabase client, created on first use from SUPABASE_URL and
 * SUPABASE_SERVICE_ROLE_KEY. Throws naming the missing variable (never its
 * value) when one is unset. No session persistence: this is a server key.
 */
export function getDb(): Db {
  if (cached) return cached;
  const url = requireEnv("SUPABASE_URL");
  const key = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  cached = createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}
