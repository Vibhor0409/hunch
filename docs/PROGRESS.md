# Hunch build progress

Orchestrated from a Claude Code session started outside the project folder on 2026-10-11, so the kit's agents run as general-purpose subagents fed with their agent files, web docs replace the Context7 MCP, and the Supabase schema goes in through the SQL editor.

Capture route: iPhone (no simulator, no Maestro on this Mac).
Local API address for the app: http://10.43.243.182:3000

## Phases

| Phase | Target (PT) | Gate | Result | Time |
| --- | --- | --- | --- | --- |
| 0 preflight and skills | 1:50 to 2:00 | SKILLS_SELECTED.md, tool check, MCP status | passed (see below) | 2:14 PM |
| 1 foundation | 2:00 to 2:15 | typechecks, build, expo-doctor, db probe | passed (db probe passed 3:08 PM) | 2:19 PM |
| 2 parallel build | 2:15 to 2:45 | smoke script with samples, unknowns answered, tests | started 2:19 PM: game-engine, ui-designer, video-producer; gemini-integrator and data-architect wait for keys | |
| 3 integration and launch | 2:45 to 3:05 | API tests on production, phone scan, real order id | | |
| 4 levels and profile | 3:05 to 3:45 | tests on production, Me tab real stats | | |
| 5 video and submission | 3:45 to 4:45 | video under 1:55, README, public repo | | |

Build started 2:12 PM, about 22 minutes behind the 1:50 PM start the targets assume. Shift every target by 22 minutes; the 5:00 PM deadline is fixed.

## Phase 0 record (2:12 PM)

- node v25.2.1 (OK, needs 22.4+)
- gh 2.102.0 installed, not logged in
- vercel: logged out; eas-cli: not logged in
- xcrun simctl: unavailable (command line tools only); maestro: not installed
- MCP: context7 and supabase are not loaded in this session (started outside the project); using web docs and the SQL editor fallback
- env files: none yet (server/.env.local, mobile/.env, video/.env)

## Blockers and human checkpoints

- [x] Gemini sandbox API key and secret -> server/.env.local (3:04 PM) and Vercel production env
- [x] Supabase provisioned through Vercel Marketplace (resource hunch-db, free plan, sfo1) and connected to Vercel project hunch-api; keys merged into server/.env.local (3:08 PM)
- [x] schema.sql applied over the Postgres connection (3:08 PM): tables players, swipes; view leaderboard
- [x] gh, vercel and eas logins done (2:25 PM)
- [ ] Expo Go installed on the iPhone

## Log
- 2:12 PM Phase 0 checks run; scaffolds started (server, mobile).
- 2:19 PM Phase 1: server (Next 16.4, route.ts health, vitest, tsx, dotenv, SDK 0.1.1, supabase-js) and mobile (Expo SDK 57, Expo Router, template examples removed, app/ components/ lib/ at root, app.json set to Hunch) scaffolded. Gate 1: server typecheck PASS, server build PASS, mobile typecheck PASS, expo-doctor 21/21 PASS. DB probe pending Supabase keys. Note: two parallel shell commands collided on cwd once; all commands now use absolute paths.
- 2:19 PM Phase 2 started for the three agents that need no credentials.
- 2:31 PM game-engine DONE: lib/game (lanes, scoring, levels, profile, time), 92 unit tests pass, typecheck pass (verified by orchestrator). vitest config renamed to .mts with @ alias.
- 2:38 PM ui-designer DONE: theme, Hunch mark and icons, Join, tabs, Deck with gestures and reveal sheet, Leaderboard, Me (P0). Orchestrator verified: typecheck PASS, expo-doctor 21/21, expo export ios PASS (3.8 MB bundle), no em dashes, no mock data. app.json adaptiveIcon color set to #0B0B0F.
- 2:40 PM video-producer DONE: video/ package (Remotion 4.0.534), script.json (7 scenes, 115 s), SHOTLIST.md for the iPhone route, voiceover.ts (ElevenLabs REST), remotion composition HunchDemo. Orchestrator verified: typecheck PASS, compositions lists HunchDemo 115.00 s. Phase 5 note: swap remotion HunchMark to match mobile/assets/images/mark.svg.
- 2:48 PM data-architect DONE (code): lib/db client, queries, index; scripts/db-probe.ts. Typecheck PASS (orchestrator verified). Probe not yet run: Supabase keys missing. Schema unchanged.
- 2:57 PM api-builder DONE (code, early start): six routes plus app/api/_lib helpers. Typecheck shows only the four missing @/lib/gemini imports (orchestrator verified). Full verification waits for gemini modules and keys.
- 3:08 PM Gate 1 complete: DB PROBE PASSED (create, duplicate, insert, settle, leaderboard, counters, cascade delete). Vercel project hunch-api linked; production env has GEMINI_* and all SUPABASE_*/POSTGRES_* vars.
