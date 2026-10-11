# Hunch: project memory (read fully before any work)

## Mission

Build Hunch, a native iOS app (Expo / React Native) where people swipe on live Gemini prediction markets. They call each market blind (no odds shown), then see the market's odds. Each paid swipe places a real $1 order on Gemini's sandbox exchange. Points (Edge) reward being right when the market disagreed, and Edge unlocks higher daily limits.

Hunch is an app, not a website. There is no web UI. The only non-app piece is a headless API server, required because the Gemini API secret must never ship inside the app.

Context: B@BHacks 2.0 hackathon, Gemini Prediction API track. One human builder. Four core features must be live for real users (on iPhones through Expo Go) by 3:00 PM PT; submission closes at 5:00 PM PT. Judges score technical depth, creativity, functionality and real users, and they check for hard-coded functionality.

## Repository layout

- `mobile/`: the iOS app (Expo, Expo Router, TypeScript). Runs in Expo Go; published with EAS Update.
- `server/`: headless API (Next.js route handlers only) on Vercel. Holds the Gemini and Supabase keys.
- `supabase/`, `contracts/`, `docs/`, `video/`, `.claude/`.

## Source of truth, in priority order

1. `docs/SPEC.md`: what to build and the acceptance criteria.
2. `docs/GEMINI_API.md`: verified Gemini SDK facts and the open unknowns.
3. `docs/ARCHITECTURE.md`: stack, folders, API contracts, data flow, file ownership.
4. `contracts/types.ts` and `supabase/schema.sql`: shared contracts. Copy, do not redesign.
5. `docs/BUILD_PLAN.md`: phases, agents, gates. `docs/PROGRESS.md`: live state (create it in Phase 0).

If two sources conflict, stop and ask the human. Never resolve a conflict by guessing.

## Hard rules

1. **No invented APIs.** Use only the Gemini SDK methods and fields in `docs/GEMINI_API.md`. For anything not listed, call the real API, save the raw JSON under `docs/samples/`, record the observed shape, then code against it.
2. **Check library docs before use.** For Expo, Expo Router, React Native Reanimated, Gesture Handler, Next.js, Supabase, Maestro and ElevenLabs, query the Context7 MCP server whenever you are not certain of an API.
3. **Expo Go compatible only.** The app must run in Expo Go: use only libraries bundled with Expo Go (install with `npx expo install`). No custom native modules, no config plugins that need a development build.
4. **No hard-coded data** (markets, odds, users, results) in `mobile/` or `server/` source. Fixtures live only under test folders.
5. **Blind means blind.** The app never receives odds before a swipe. Card payloads contain no prices; odds return only in the swipe response.
6. **Secrets stay on the server.** Gemini and Supabase keys live in `server/.env.local` and Vercel env vars only. The app knows only `EXPO_PUBLIC_API_URL`. Never print, log or commit secrets.
7. **Brand.** The app is Hunch, with its own name, icon and visual identity. Credit Gemini only as plain text: "Powered by Gemini Prediction Markets" (the human chose this wording on Oct 11; "Built on" is also fine). Never use Gemini's logo or wordmark, never put "Gemini" in the app name, icon or bundle id, and never style Hunch to look like an official Gemini product. (Gemini's brand policy requires permission for logo use; if the human gets written permission at the Gemini table, the logo may appear only in a small "Built on" badge.)
8. **Humans handle accounts.** Do not create accounts, enter passwords or click through sign-ups. Ask the human. Calling the SDK's `acceptTerms()` for the sandbox account is allowed after the human confirms once.
9. **Strict file ownership** (table in `docs/ARCHITECTURE.md`). An agent edits only the files it owns and reports any other needed change to the orchestrator.
10. **Verify everything.** Every task ends with its verification command passing; log a one-line result in `docs/PROGRESS.md`.
11. **Time-box.** If a task is stuck for 15 minutes, stop, write the blocker and the fallback in `docs/PROGRESS.md`, and take the fallback.
12. **Fixed scope.** Build only what `docs/SPEC.md` lists.
13. **No untrusted installs.** Install skills, CLIs or packages only from the sources in `docs/SKILLS.md` and `START_HERE.md`, or with the human's approval.
14. **Copy style.** App text and docs are plain and short, with no em dashes.

## Commands

- Server: `npm --prefix server run dev | build | typecheck | test`; `npx --prefix server tsx server/scripts/gemini-smoke.ts`
- App: `cd mobile && npx expo start` (add `--tunnel` for phones on another network); `npm --prefix mobile run typecheck`; `cd mobile && npx expo-doctor`
- App flows: `maestro test mobile/.maestro/` (when Maestro is installed)

## Orchestration

The main session is the orchestrator. It follows `docs/BUILD_PLAN.md`: launches subagents from `.claude/agents/`, in parallel in a single message wherever the plan says so; checks every gate itself; and keeps `docs/PROGRESS.md` current. Subagents do not spawn further subagents.
