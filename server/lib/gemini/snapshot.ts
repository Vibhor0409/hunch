// The feed_snapshot table: the latest built card list, so a cold API instance
// answers from one database read instead of a multi-second Gemini build.
// Schema (supabase/schema.sql): key text primary key, payload jsonb, fetched_at timestamptz.
// Both functions swallow every failure (missing env, network, RLS) and report
// it through their return value: a snapshot is an accelerator, never a dependency.
import type { SupabaseClient } from "@supabase/supabase-js";
import { getDb } from "../db/client";

const TABLE = "feed_snapshot";

export interface Snapshot<T> {
  payload: T;
  /** When the payload was built (ISO 8601). */
  fetchedAt: string;
}

/**
 * feed_snapshot is not in lib/db/client.ts's Database type yet, so the typed
 * client is widened to the untyped one for this table only.
 */
function table() {
  return (getDb() as unknown as SupabaseClient).from(TABLE);
}

/** The stored snapshot for `key`, or null when there is none or the read failed. */
export async function loadSnapshot<T>(key: string): Promise<Snapshot<T> | null> {
  try {
    const { data, error } = await table().select("payload, fetched_at").eq("key", key).maybeSingle();
    if (error || !data || typeof data.fetched_at !== "string") return null;
    return { payload: data.payload as T, fetchedAt: data.fetched_at };
  } catch {
    return null;
  }
}

/** Upserts `payload` under `key` with fetched_at = now. True when the write succeeded. */
export async function saveSnapshot(key: string, payload: unknown): Promise<boolean> {
  try {
    const { error } = await table().upsert({ key, payload, fetched_at: new Date().toISOString() }, { onConflict: "key" });
    return !error;
  } catch {
    return false;
  }
}
