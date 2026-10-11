// Supabase client for the Hunch API. Service role key, server only.
// No "server-only" import: scripts run this module under tsx, outside Next.js.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Lane, Mode, Side } from "../types";

/** players table, as supabase/schema.sql defines it. */
export type PlayerRow = {
  id: string;
  name: string;
  created_at: string;
};

export type PlayerInsert = {
  id?: string;
  name: string;
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
    };
    Views: {
      leaderboard: {
        Row: LeaderboardViewRow;
        Relationships: [];
      };
    };
    Functions: { [_ in never]: never };
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
