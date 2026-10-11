// Gemini SDK clients for Hunch (server only).
// One authenticated sandbox client places orders. Public reads (feed, quotes,
// settlement) use unauthenticated clients so they keep working even when the
// trading key is missing or rejected. The SDK is ESM-only and the scripts run
// under tsx as CommonJS, so the package is loaded with a dynamic import.

type Sdk = typeof import("@gemini-markets/sdk/server");

export type GeminiClient = Awaited<ReturnType<Sdk["createClient"]>>;
export type GeminiEnv = "sandbox" | "production";

type EventsPage = Awaited<ReturnType<GeminiClient["predictions"]["listEvents"]>>;
/** An event as returned by listEvents and getEvent (shape confirmed in docs/samples). */
export type GeminiEvent = NonNullable<EventsPage["data"]>[number];
export type GeminiContract = NonNullable<GeminiEvent["contracts"]>[number];

/** Per-call deadline. The SDK default of 30 s would use a route's whole budget. */
export const REQUEST_TIMEOUT_MS = 10_000;

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
    promise = getSdk().then((sdk) => sdk.createClient({ env, skipWsInit: true }));
    publicPromises.set(env, promise);
    promise.catch(() => {
      if (publicPromises.get(env) === promise) publicPromises.delete(env);
    });
  }
  return promise;
}

/** The API maximum page size for event listings. */
export const PAGE_LIMIT = 500;
/** getEvent attempts before a 404 is believed (see getEventOrNull). */
const GET_EVENT_ATTEMPTS = 3;

/**
 * getEvent, or null when Gemini answers 404 on every attempt. The sandbox is
 * served by replicas that disagree: in Phase 2 samples a ticker listed as active
 * with five minutes left returned 404, and the same ticker 200 on the next call
 * (3 of 6 lookups of 5-minute BTC events missed). Other errors propagate.
 */
export async function getEventOrNull(client: GeminiClient, eventTicker: string): Promise<GeminiEvent | null> {
  const sdk = await getSdk();
  for (let attempt = 1; ; attempt++) {
    try {
      return await client.predictions.getEvent({ eventTicker }, { timeoutMs: REQUEST_TIMEOUT_MS });
    } catch (error) {
      if (!(error instanceof sdk.NotFoundError)) throw error;
      if (attempt >= GET_EVENT_ATTEMPTS) return null;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
}

/** One paginated listing of every active event. */
export async function listActiveEventsOnce(client: GeminiClient): Promise<GeminiEvent[]> {
  const events: GeminiEvent[] = [];
  for (let offset = 0; ; offset += PAGE_LIMIT) {
    const page = await client.predictions.listEvents(
      { status: ["active"], limit: PAGE_LIMIT, offset },
      { timeoutMs: REQUEST_TIMEOUT_MS },
    );
    const data = page.data ?? [];
    events.push(...data);
    const total = page.pagination?.total;
    if (data.length < PAGE_LIMIT || (typeof total === "number" && events.length >= total)) break;
  }
  return events;
}

/** The active event with this ticker from a fresh listing, or null. Fallback for a getEvent 404. */
export async function findActiveEvent(client: GeminiClient, eventTicker: string): Promise<GeminiEvent | null> {
  const events = await listActiveEventsOnce(client);
  return events.find((event) => event.ticker === eventTicker) ?? null;
}

/**
 * The event with this ticker among the events settled in the last 24 hours
 * (most recent first, one page of 500), or null. Fallback for a getEvent 404.
 */
export async function findRecentlySettledEvent(client: GeminiClient, eventTicker: string): Promise<GeminiEvent | null> {
  const page = await client.predictions.listRecentlySettledEvents({ limit: PAGE_LIMIT }, { timeoutMs: REQUEST_TIMEOUT_MS });
  return (page.data ?? []).find((event) => event.ticker === eventTicker) ?? null;
}
