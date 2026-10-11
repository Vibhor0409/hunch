// Typed client for the six Hunch API routes. Real calls only, never fixtures.
// Base URL comes from EXPO_PUBLIC_API_URL. Every call times out after 10 seconds
// and every failure becomes an ApiError with a short message for the screen.

import type {
  Counters,
  LaneFilter,
  LeaderboardRow,
  PlayerStatus,
  Profile,
  Reveal,
  CardPublic,
  Side,
} from "@/lib/types";

const TIMEOUT_MS = 10_000;

export const OFFLINE_MESSAGE = "Can't reach Hunch. Pull to retry.";

export type ApiErrorCode =
  | "offline"
  | "timeout"
  | "name_taken"
  | "invalid_name"
  | "already_swiped"
  | "market_closed"
  | "gemini_unavailable"
  | "bad_response"
  | "unknown";

const MESSAGES: Record<ApiErrorCode, string> = {
  offline: OFFLINE_MESSAGE,
  timeout: OFFLINE_MESSAGE,
  name_taken: "That name is taken.",
  invalid_name: "Use 2 to 20 letters, digits or spaces.",
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
}

/** Turn any thrown value into a short message for the screen. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return MESSAGES.unknown;
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
  "already_swiped",
  "market_closed",
  "gemini_unavailable",
]);

async function request<T>(
  path: string,
  init: { method: "GET" | "POST"; body?: unknown } = { method: "GET" },
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

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
    clearTimeout(timer);
    if (err instanceof ApiError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new ApiError("timeout");
    }
    throw new ApiError("offline");
  }
  clearTimeout(timer);

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

export function getFeed(lane: LaneFilter, playerId: string): Promise<FeedResponse> {
  const query = new URLSearchParams({ lane, playerId }).toString();
  return request<FeedResponse>(`/api/feed?${query}`);
}

export interface SwipeRequest {
  playerId: string;
  eventTicker: string;
  instrumentSymbol: string;
  side: Side;
}

export function swipe(body: SwipeRequest): Promise<Reveal> {
  return request<Reveal>("/api/swipe", { method: "POST", body });
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

export function getLeaderboard(): Promise<LeaderboardResponse> {
  return request<LeaderboardResponse>("/api/leaderboard");
}

export function getProfile(playerId: string): Promise<Profile> {
  const query = new URLSearchParams({ playerId }).toString();
  return request<Profile>(`/api/profile?${query}`);
}
