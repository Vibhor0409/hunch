// Helpers shared by every query module: numeric conversion and error wrapping.
import type { PostgrestError } from "@supabase/supabase-js";

// Postgres error codes (https://www.postgresql.org/docs/current/errcodes-appendix.html)
export const UNIQUE_VIOLATION = "23505";
export const INVALID_TEXT_REPRESENTATION = "22P02"; // for example a malformed uuid

/**
 * The one place numeric columns become JS numbers. PostgREST sends Postgres
 * numeric and bigint as JSON numbers, but a string is accepted too so a
 * driver change can never leak strings into game math.
 */
export function toNumber(value: number | string | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function toNumberOrNull(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  return toNumber(value);
}

/**
 * Rounds to cents the way Postgres rounds numeric(.,2): half away from zero.
 * The epsilon absorbs binary noise so 1.005 becomes 1.01, not 1.00.
 */
export function roundCents(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const cents = Math.round((Math.abs(value) + Number.EPSILON) * 100);
  const rounded = (Math.sign(value) * cents) / 100;
  return rounded === 0 ? 0 : rounded;
}

/** A database failure with the Postgres or PostgREST error code attached. */
export class DbError extends Error {
  readonly code: string;
  constructor(context: string, error: PostgrestError) {
    super(`${context}: ${error.message} (code ${error.code || "none"})`);
    this.name = "DbError";
    this.code = error.code;
  }
}

export function fail(context: string, error: PostgrestError): never {
  throw new DbError(context, error);
}
