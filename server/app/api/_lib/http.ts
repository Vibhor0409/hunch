// JSON response helpers shared by every Hunch route handler.

/** Every API response is per-player and live, so nothing may cache it. */
const NO_STORE: HeadersInit = { "Cache-Control": "no-store" };

/** A JSON body with a status code. */
export function json<T>(body: T, status = 200): Response {
  return Response.json(body, { status, headers: NO_STORE });
}

/** The documented error shape: { error: "<code>" }. */
export function errorJson(code: string, status: number): Response {
  return Response.json({ error: code }, { status, headers: NO_STORE });
}

/**
 * The request body as a plain object, or null when it is missing, is not
 * JSON, or is not an object. Callers validate the fields themselves.
 */
export async function readJsonObject(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await req.json();
    if (body === null || typeof body !== "object" || Array.isArray(body)) return null;
    return body as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** A one-line description of an error for logs: name and message, no stack. */
export function describe(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

/**
 * Logs an unexpected error (name and message only, never a stack trace or a
 * secret) and returns the generic 500 body. Nothing about the error reaches
 * the client.
 */
export function internalError(route: string, error: unknown): Response {
  console.error(`[api/${route}] ${describe(error)}`);
  return errorJson("internal", 500);
}

/**
 * Runs a route body, turns any uncaught error into the 500 body, and logs the
 * elapsed time and status of every response as "[api/<route>] ms= <n> status= <code>".
 */
export async function handle(route: string, body: () => Promise<Response>): Promise<Response> {
  const started = Date.now();
  let response: Response;
  try {
    response = await body();
  } catch (error) {
    response = internalError(route, error);
  }
  console.log(`[api/${route}] ms=`, Date.now() - started, "status=", response.status);
  return response;
}
