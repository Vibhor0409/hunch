# Hunch architecture

## Stack (fixed; do not substitute)

**App (`mobile/`)**
- Expo (latest SDK supported by Expo Go), Expo Router with typed routes, TypeScript strict.
- `react-native-reanimated` and `react-native-gesture-handler` for the swipe deck and the reveal; `expo-haptics`; `@react-native-async-storage/async-storage`; `react-native-safe-area-context`; `expo-linear-gradient` and `react-native-svg` for visuals. Install every package with `npx expo install` so versions match Expo Go.
- Talks only to the API at `process.env.EXPO_PUBLIC_API_URL`.
- Shipped to phones with EAS Update and opened in Expo Go.

**API (`server/`)**
- Next.js App Router used only for route handlers (no pages; `app/route.ts` returns the plain-text "Hunch API" health response), TypeScript strict, deployed to Vercel on the Node 22 runtime. Every route sets `export const runtime = "nodejs"` and `export const dynamic = "force-dynamic"`; feed, swipe and settle also set `export const maxDuration = 30` because Gemini calls can take several seconds on a cold instance.
- `@gemini-markets/sdk` (server entry) for every Gemini call; `@supabase/supabase-js` with the service role key. Do not use the `server-only` package: scripts import these modules under `tsx`, outside Next.js.
- `vitest` for unit and API tests; `tsx` for scripts.

**Database:** Supabase Postgres, schema in `supabase/schema.sql`. Row level security on with no policies, so only the server's service role can read or write.

## Folder layout and ownership

| Path | Owner agent | Contents |
| --- | --- | --- |
| `server/package.json`, `server/` configs, `server/lib/types.ts`, `mobile/package.json`, `mobile/app.json`, `mobile/` configs, `mobile/lib/types.ts`, `docs/PROGRESS.md` | orchestrator | Scaffolds and shared contracts |
| `server/lib/gemini/**`, `server/scripts/gemini-*.ts`, `docs/samples/**`, answers in `docs/GEMINI_API.md` | gemini-integrator | SDK client, feed, quotes, orders, settlement lookups |
| `supabase/schema.sql`, `server/lib/db/**` | data-architect | Schema, typed queries |
| `server/lib/game/**`, `server/tests/unit/**` | game-engine | Lanes, Edge, caps, levels, profile stats (pure functions) |
| `server/app/api/**`, `server/app/route.ts` | api-builder | Route handlers and the `/` health response |
| `mobile/app/**`, `mobile/components/**`, `mobile/lib/api.ts`, `mobile/lib/storage.ts`, `mobile/lib/theme.ts`, `mobile/assets/**` | ui-designer | Screens, components, API client, theme, icon and splash |
| `server/tests/api/**`, `mobile/.maestro/**` | qa-verifier | API tests and app flows (no source edits) |
| `server/vercel.json`, `mobile/eas.json`, `README.md`, `scripts/release.sh` | release-engineer | Deploy, EAS Update, QR, README |
| `video/**` | video-producer | Simulator capture, voiceover, Remotion render |
| `docs/SKILLS_SELECTED.md`, the `skills:` lines in `.claude/agents/*.md` | skill-scout | Phase 0 only |

`server/lib/types.ts` and `mobile/lib/types.ts` are copies of `contracts/types.ts`. Only the orchestrator changes them, and always both at once.

## Server modules

- `lib/gemini/client.ts`: `getGemini()` returns a cached authenticated sandbox client (module-level promise). `getPublicGemini(env)` returns an unauthenticated client for the feed fallback.
- `lib/gemini/feed.ts`: `fetchActiveCards(): Promise<CardQuote[]>`. Lists active events (paginate up to 500), flattens open contracts with a buy price, assigns lanes with `lib/game/lanes.ts`, builds the question text. Cached 60 seconds per instance.
- `lib/gemini/quote.ts`: `getQuote(eventTicker, instrumentSymbol): Promise<CardQuote | null>` re-reads one contract via `getEvent` (no cache).
- `lib/gemini/orders.ts`: `placeBuy({ symbol, side, price, quantity }): Promise<OrderReceipt>`. Reports `AcceptTermsRequired` instead of accepting automatically.
- `lib/gemini/settlement.ts`: `resolveOutcome(eventTicker, instrumentSymbol): Promise<Side | null>`, following `docs/GEMINI_API.md`.
- `lib/db/client.ts` (Supabase client with the service role key) and `lib/db/queries.ts` (typed functions; see the data-architect agent).
- `lib/game/`: `lanes.ts`, `scoring.ts`, `levels.ts`, `profile.ts`, `time.ts` (see the game-engine agent).

`CardQuote` (server only) = `CardPublic` plus `yesPrice` and `noPrice`. It never leaves the server.

## App modules

- `lib/api.ts`: typed fetch wrappers for the six routes, a 10-second timeout, and errors mapped to short messages.
- `lib/storage.ts`: get and set `hunch.playerId`.
- `lib/theme.ts`: colors, type scale, spacing, radii and motion constants; every screen uses it.
- Routes: `app/join.tsx`; `app/(tabs)/_layout.tsx` with `index.tsx` (Deck), `leaderboard.tsx`, `me.tsx`; `app/_layout.tsx` redirects to Join when no player id is stored and triggers `POST /api/settle` on launch and on foreground (`AppState`).

## API contracts (types in `contracts/types.ts`)

| Route | Request | Response |
| --- | --- | --- |
| `POST /api/join` | `{ name }` | 200 `{ playerId, name }`; 409 `{ error: "name_taken" }`; 400 `{ error: "invalid_name" }` |
| `GET /api/feed?lane=foryou|live|tomorrow|week&playerId=` | | 200 `{ cards: CardPublic[], status: PlayerStatus }` (max 20 cards, already-swiped contracts removed) |
| `POST /api/swipe` | `{ playerId, eventTicker, instrumentSymbol, side }` | 200 `Reveal`; 409 `{ error: "already_swiped" }`; 410 `{ error: "market_closed" }`; 502 `{ error: "gemini_unavailable" }` |
| `POST /api/settle` | none | 200 `{ settled: number }` |
| `GET /api/leaderboard` | | 200 `{ rows: LeaderboardRow[], counters: Counters }` |
| `GET /api/profile?playerId=` | | 200 `Profile` (with `recent`) |

CORS is not needed for the native app, but keep responses JSON with correct status codes.

## Swipe flow (server)

1. Validate the body; load the player; reject a repeat swipe (unique player and instrument).
2. `getQuote` for a fresh price; 410 if the market is closed, has no price, or the chosen side's price is at or below 0 or at or above 1 (the swipes table requires 0 < price < 1).
3. Count today's paid swipes (LA day); the level gives cap and stake. Under the cap means paid, otherwise practice.
4. Paid: `contractsFor(stake, price)` then `placeBuy`. Status `filled` stays paid; anything else becomes practice with the receipt kept.
5. Insert the swipe row; return the `Reveal`.

## Settlement flow (server)

1. Select unsettled swipes with `expires_at` before now (limit 200).
2. Group by `event_ticker`; call `resolveOutcome` once per instrument.
3. For each swipe with an outcome: `won`, `edge = edgeFor(price, won)`, `payout = won && mode === "paid" ? contracts : 0`; update the row.
