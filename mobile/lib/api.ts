// Typed client for the Hunch API routes. Real calls only, never fixtures.
// Base URL comes from EXPO_PUBLIC_API_URL. Reads time out after 10 seconds, card
// context after 12, the swipe after 20, and every failure becomes an ApiError with
// a short message.
// Callers can pass an AbortSignal to cancel a request they no longer need.

import type {
  CardContext,
  Counters,
  LaneFilter,
  LeaderboardRow,
  PlayerStatus,
  Profile,
  Reveal,
  CardPublic,
  Side,
  Wallet,
} from "@/lib/types";

const READ_TIMEOUT_MS = 10_000;
const SWIPE_TIMEOUT_MS = 20_000;
const CONTEXT_TIMEOUT_MS = 15_000; // uncached lookups measured at 7 to 11 seconds

export const OFFLINE_MESSAGE = "Can't reach Hunch right now.";

export type ApiErrorCode =
  | "offline"
  | "timeout"
  | "aborted"
  | "name_taken"
  | "invalid_name"
  | "invalid_lane"
  | "invalid_stake"
  | "already_swiped"
  | "market_closed"
  | "gemini_unavailable"
  | "bad_response"
  | "unknown";

const MESSAGES: Record<ApiErrorCode, string> = {
  offline: OFFLINE_MESSAGE,
  timeout: "That took too long. Try again.",
  aborted: "Cancelled.",
  name_taken: "That name is taken.",
  invalid_name: "Use 2 to 20 letters, digits or spaces.",
  invalid_lane: "This lane isn't open yet.",
  invalid_stake: "Pick an amount from $1 to $100.",
  already_swiped: "You already called this one.",
  market_closed: "This market just closed.",
  gemini_unavailable: "Gemini didn't answer. Try again.",
  bad_response: "Hunch sent something unexpected. Try again.",
  unknown: "Something went wrong. Try again.",
};

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number | null;

  constructor(code: ApiErrorCode, status: number | null = null) {
    super(MESSAGES[code]);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }

  /** True when the device could not reach the server at all. */
  get isOffline(): boolean {
    return this.code === "offline" || this.code === "timeout";
  }

  /** True when the caller cancelled the request on purpose. */
  get isAborted(): boolean {
    return this.code === "aborted";
  }
}

/** Turn any thrown value into a short message for the screen. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return MESSAGES.unknown;
}

/** True when the error came from the caller cancelling, so screens can ignore it. */
export function isAbort(err: unknown): boolean {
  return err instanceof ApiError && err.isAborted;
}

function baseUrl(): string {
  const url = process.env.EXPO_PUBLIC_API_URL;
  if (!url) {
    throw new ApiError("offline");
  }
  return url.replace(/\/+$/, "");
}

const KNOWN_CODES: ReadonlySet<string> = new Set<ApiErrorCode>([
  "name_taken",
  "invalid_name",
  "invalid_lane",
  "invalid_stake",
  "already_swiped",
  "market_closed",
  "gemini_unavailable",
]);

interface RequestInit {
  method: "GET" | "POST";
  body?: unknown;
  timeoutMs?: number;
  signal?: AbortSignal;
}

async function request<T>(path: string, init: RequestInit = { method: "GET" }): Promise<T> {
  const controller = new AbortController();
  const timeoutMs = init.timeoutMs ?? READ_TIMEOUT_MS;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  // Forward the caller's cancellation into our controller.
  const outer = init.signal;
  const onOuterAbort = () => controller.abort();
  if (outer) {
    if (outer.aborted) {
      clearTimeout(timer);
      throw new ApiError("aborted");
    }
    outer.addEventListener("abort", onOuterAbort);
  }

  const cleanup = () => {
    clearTimeout(timer);
    outer?.removeEventListener("abort", onOuterAbort);
  };

  let response: Response;
  try {
    response = await fetch(`${baseUrl()}${path}`, {
      method: init.method,
      headers: {
        Accept: "application/json",
        ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: controller.signal,
    });
  } catch (err) {
    cleanup();
    if (err instanceof ApiError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      if (outer?.aborted && !timedOut) throw new ApiError("aborted");
      throw new ApiError("timeout");
    }
    throw new ApiError("offline");
  }
  cleanup();

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const code =
      payload && typeof payload === "object" && typeof (payload as { error?: unknown }).error === "string"
        ? (payload as { error: string }).error
        : "";
    if (KNOWN_CODES.has(code)) {
      throw new ApiError(code as ApiErrorCode, response.status);
    }
    if (response.status >= 502 && response.status <= 504) {
      throw new ApiError("offline", response.status);
    }
    throw new ApiError("unknown", response.status);
  }

  if (payload === null || typeof payload !== "object") {
    throw new ApiError("bad_response", response.status);
  }
  return payload as T;
}

// Routes

export interface JoinResponse {
  playerId: string;
  name: string;
}

export function join(name: string): Promise<JoinResponse> {
  return request<JoinResponse>("/api/join", { method: "POST", body: { name } });
}

export interface FeedResponse {
  cards: CardPublic[];
  status: PlayerStatus;
}

export function getFeed(lane: LaneFilter, playerId: string, signal?: AbortSignal): Promise<FeedResponse> {
  const query = new URLSearchParams({ lane, playerId }).toString();
  return request<FeedResponse>(`/api/feed?${query}`, { method: "GET", signal });
}

export interface SwipeRequest {
  playerId: string;
  eventTicker: string;
  instrumentSymbol: string;
  side: Side;
  /** The session toggle. "practice" asks for a practice swipe; left out, the server treats it as live. */
  mode?: "practice" | "live";
}

export function swipe(body: SwipeRequest): Promise<Reveal> {
  return request<Reveal>("/api/swipe", { method: "POST", body, timeoutMs: SWIPE_TIMEOUT_MS });
}

export interface SettleResponse {
  settled: number;
}

export function settle(): Promise<SettleResponse> {
  return request<SettleResponse>("/api/settle", { method: "POST" });
}

export interface LeaderboardResponse {
  rows: LeaderboardRow[];
  counters: Counters;
}

export function getLeaderboard(signal?: AbortSignal): Promise<LeaderboardResponse> {
  return request<LeaderboardResponse>("/api/leaderboard", { method: "GET", signal });
}

export function getProfile(playerId: string, signal?: AbortSignal): Promise<Profile> {
  const query = new URLSearchParams({ playerId }).toString();
  return request<Profile>(`/api/profile?${query}`, { method: "GET", signal });
}

// Play-money wallet (F8)

export function getWallet(playerId: string, signal?: AbortSignal): Promise<Wallet> {
  const query = new URLSearchParams({ playerId }).toString();
  return request<Wallet>(`/api/wallet?${query}`, { method: "GET", signal });
}

export function setStakePerTrade(playerId: string, stakePerTrade: number): Promise<PlayerStatus> {
  return request<PlayerStatus>("/api/settings", { method: "POST", body: { playerId, stakePerTrade } });
}

export function resetWallet(playerId: string): Promise<Wallet> {
  return request<Wallet>("/api/wallet/reset", { method: "POST", body: { playerId } });
}

/**
 * Context for a card back: live web context, or the market's own rules as a fallback.
 * The server filters odds out; the app only renders `text`.
 */
export function getContext(eventTicker: string, instrumentSymbol: string, playerId: string): Promise<CardContext> {
  const query = new URLSearchParams({ eventTicker, instrumentSymbol, playerId }).toString();
  return request<CardContext>(`/api/context?${query}`, { method: "GET", timeoutMs: CONTEXT_TIMEOUT_MS });
}
