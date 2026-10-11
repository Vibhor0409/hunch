// Gemini SDK clients for Hunch (server only).
// One authenticated sandbox client places orders. Public reads (feed, quotes,
// settlement) use unauthenticated clients for the sandbox and for production,
// so they keep working even when the trading key is missing or rejected. The
// SDK is ESM-only and the scripts run under tsx as CommonJS, so the package is
// loaded with a dynamic import.

type Sdk = typeof import("@gemini-markets/sdk/server");

export type GeminiClient = Awaited<ReturnType<Sdk["createClient"]>>;
export type GeminiEnv = "sandbox" | "production";

type EventsPage = Awaited<ReturnType<GeminiClient["predictions"]["listEvents"]>>;
/** An event as returned by listEvents and getEvent (shape confirmed in docs/samples). */
export type GeminiEvent = NonNullable<EventsPage["data"]>[number];
export type GeminiContract = NonNullable<GeminiEvent["contracts"]>[number];

/** Deadline for the parallel listing pages that build the feed: the whole build budget. */
export const LIST_TIMEOUT_MS = 8_000;
/** Deadline for one getEvent on the quote and settlement paths. */
export const EVENT_TIMEOUT_MS = 3_000;
/** Deadline for placeOrder. The SDK never retries POSTs. */
export const ORDER_TIMEOUT_MS = 10_000;
/** The API maximum page size for event listings. */
export const PAGE_LIMIT = 500;
/**
 * A production page of 500 events runs to 15 MB (Sports events embed their
 * sub-events); the SDK default cap is 16 MiB, so public clients get more room.
 */
const MAX_RESPONSE_BYTES = 64 * 1024 * 1024;

let sdkPromise: Promise<Sdk> | null = null;

/** The SDK module (error classes, createClient, HmacAuth), loaded once. */
export function getSdk(): Promise<Sdk> {
  sdkPromise ??= import("@gemini-markets/sdk/server");
  return sdkPromise;
}

let authedPromise: Promise<GeminiClient> | null = null;

/**
 * The authenticated sandbox client, cached per server instance in a
 * module-level promise. A failed creation is forgotten so the next call retries.
 */
export function getGemini(): Promise<GeminiClient> {
  if (!authedPromise) {
    const promise = createAuthenticated();
    authedPromise = promise;
    promise.catch(() => {
      if (authedPromise === promise) authedPromise = null;
    });
  }
  return authedPromise;
}

async function createAuthenticated(): Promise<GeminiClient> {
  const apiKey = process.env.GEMINI_API_KEY;
  const apiSecret = process.env.GEMINI_API_SECRET;
  if (!apiKey || !apiSecret) throw new Error("GEMINI_API_KEY and GEMINI_API_SECRET are not set");
  const sdk = await getSdk();
  return sdk.createClient({
    env: "sandbox",
    auth: new sdk.HmacAuth({ apiKey, apiSecret }),
    skipWsInit: true,
  });
}

const publicPromises = new Map<GeminiEnv, Promise<GeminiClient>>();

/** An unauthenticated client for public endpoints, cached per environment. */
export function getPublicGemini(env: GeminiEnv): Promise<GeminiClient> {
  let promise = publicPromises.get(env);
  if (!promise) {
    promise = getSdk().then((sdk) => sdk.createClient({ env, skipWsInit: true, maxResponseSizeBytes: MAX_RESPONSE_BYTES }));
    publicPromises.set(env, promise);
    promise.catch(() => {
      if (publicPromises.get(env) === promise) publicPromises.delete(env);
    });
  }
  return promise;
}

/** One getEvent with a deadline: the event, null on 404, any other error propagates. */
export async function getEventOrNull(client: GeminiClient, eventTicker: string, timeoutMs = EVENT_TIMEOUT_MS): Promise<GeminiEvent | null> {
  const sdk = await getSdk();
  try {
    return await client.predictions.getEvent({ eventTicker }, { timeoutMs });
  } catch (error) {
    if (error instanceof sdk.NotFoundError) return null;
    throw error;
  }
}

/**
 * Active events from up to `pages` listing pages of PAGE_LIMIT, requested in
 * parallel under one deadline. A page that fails or times out is skipped (the
 * next build fills it in); throws only when every page failed.
 */
export async function listActiveEvents(client: GeminiClient, pages: number, timeoutMs = LIST_TIMEOUT_MS): Promise<GeminiEvent[]> {
  const results = await Promise.allSettled(
    Array.from({ length: pages }, (_, index) =>
      client.predictions.listEvents({ status: ["active"], limit: PAGE_LIMIT, offset: index * PAGE_LIMIT }, { timeoutMs }),
    ),
  );
  const events: GeminiEvent[] = [];
  let failures = 0;
  let firstError: unknown;
  for (const result of results) {
    if (result.status === "fulfilled") events.push(...(result.value.data ?? []));
    else {
      failures++;
      firstError ??= result.reason;
    }
  }
  if (failures === results.length) throw firstError instanceof Error ? firstError : new Error("listEvents failed");
  return events;
}

/**
 * The active event with this ticker from a fresh listing (two pages), or null.
 * Fallback for a getEvent 404 on the sandbox, which in Phase 2 missed tickers
 * it had just listed as active. Used by lib/context.
 */
export async function findActiveEvent(client: GeminiClient, eventTicker: string): Promise<GeminiEvent | null> {
  const events = await listActiveEvents(client, 2);
  return events.find((event) => event.ticker === eventTicker) ?? null;
}
