# Build plan: phases, agents, gates

The orchestrator (main session) runs these phases in order. A phase starts only when the previous gate passes. "In parallel" means one message with several Agent calls. After every phase, update `docs/PROGRESS.md` with: phase, gate result, time, blockers.

Clock targets are Pacific time and assume a 1:50 PM start. If the build starts later, shift every target by the same amount and apply the cut order against the fixed 5:00 PM deadline. If a phase overruns by more than 10 minutes, cut scope in this order: F6, then F5, then lane polish. Never cut F1 to F4. If Gate 3 passes after 3:20 PM, run Phase 4 and Phase 5 in parallel and cut F6 first.

## Agents

| Agent | Niche | Phases |
| --- | --- | --- |
| skill-scout | Finds and assigns the best skills (user library, marketplace, GitHub) | 0 |
| gemini-integrator | Gemini SDK: feed, quotes, orders, settlement lookups, samples | 2 |
| data-architect | Supabase schema and typed queries | 1, 2 |
| game-engine | Pure logic: lanes, Edge, caps, levels, profile stats, unit tests | 2, 4 |
| ui-designer | The iOS app: screens, gestures, haptics, reveal, brand | 2, 3, 4 |
| api-builder | Server route handlers composing gemini, db and game | 3, 4 |
| qa-verifier | Typechecks, unit and API tests, app flows, hard-coding and secret audits | 3, 4, 5 |
| release-engineer | Vercel deploy of the API, EAS Update of the app, Expo Go QR, README | 3, 4, 5 |
| video-producer | Simulator capture, ElevenLabs voiceover, Remotion render | 2 (code), 5 (run) |

## Phase 0: preflight and skills (target 1:50 to 2:00 PM)

Orchestrator, sequentially:
1. Create `docs/PROGRESS.md` with this phase list.
2. Check: `node -v` (22.4 or newer), `gh auth status` (gh was installed with Homebrew during the review; if missing, `brew install gh`), `npx vercel whoami`, `npx eas-cli whoami`, `xcode-select -p` and `xcrun simctl list devices available` (record whether a simulator exists), `maestro --version` (record whether installed). Expected on this Mac: command line tools only, no simulator, no Maestro. Record "capture route: iPhone" in `docs/PROGRESS.md`. Anything missing that the build needs now: ask the human once with the full list, then continue with independent work.
3. Check the MCP servers context7 and supabase respond.

Then launch **skill-scout** (time-box 8 minutes).

**Gate 0:** `docs/SKILLS_SELECTED.md` exists; tool check recorded; MCP status recorded.

## Phase 1: foundation (target 2:00 to 2:15 PM)

Orchestrator does this itself (it touches shared files):
1. API: `npx create-next-app@latest server --ts --eslint --app --no-src-dir --no-tailwind --import-alias "@/*" --use-npm --yes`. Delete `server/app/page.tsx` and the default styles; add `server/app/route.ts` that returns `new Response("Hunch API")` (a page component cannot return plain text, and `page.tsx` and `route.ts` cannot share a path). In `server/`: `npm i @gemini-markets/sdk @supabase/supabase-js` and `npm i -D vitest tsx dotenv`. Scripts: `typecheck` (`tsc --noEmit`), `test` (`vitest run`). `"engines": { "node": ">=22.4" }`. `vitest.config.ts` includes `tests/**/*.test.ts`.
2. App: `npx create-expo-app@latest mobile --template default --yes`. Remove the template's example screens and components (keep the Expo Router structure). In `mobile/`: `npx expo install react-native-reanimated react-native-gesture-handler expo-haptics @react-native-async-storage/async-storage react-native-safe-area-context expo-linear-gradient react-native-svg`. Add script `typecheck` (`tsc --noEmit`). In `app.json`: name "Hunch", slug "hunch", `ios.bundleIdentifier` "com.hunch.app", portrait, dark user interface style.
3. Copy `contracts/types.ts` to `server/lib/types.ts` and `mobile/lib/types.ts`.
4. Ask the human to create `server/.env.local` from `.env.example` if it does not exist (print which keys are set or missing, never values). Create `mobile/.env` with `EXPO_PUBLIC_API_URL=http://<this machine's LAN IP>:3000` for local testing.
5. Launch **data-architect** to apply `supabase/schema.sql` and write `server/lib/db/client.ts`.
6. Commit: "Phase 1 foundation".

**Gate 1:** `npm --prefix server run typecheck`, `npm --prefix server run build`, `npm --prefix mobile run typecheck` and `cd mobile && npx expo-doctor` pass; a one-off script inserts and deletes a test player through `server/lib/db`.

## Phase 2: parallel build (target 2:15 to 2:45 PM)

Launch in parallel, in one message:
- **gemini-integrator:** smoke script and samples first, answer the unknowns in `docs/GEMINI_API.md`, then `server/lib/gemini/*`.
- **data-architect:** `server/lib/db/queries.ts`.
- **game-engine:** `server/lib/game/*` with unit tests.
- **ui-designer:** brand, theme and every P0 screen against the API contracts (real calls only; loading and error states while routes are missing).
- **video-producer:** writes `video/` code only: `script.json`, `voiceover.ts`, `remotion/` and `SHOTLIST.md`. Skip the Maestro flows and `capture.sh` unless Phase 0 recorded a simulator.

**Gate 2 (orchestrator checks each):**
- `npx --prefix server tsx server/scripts/gemini-smoke.ts` prints active events with prices, saves `docs/samples/events.json` and `docs/samples/settled-event.json`; with `--order` (after the human confirms terms once) it places one real sandbox order.
- The unknowns in `docs/GEMINI_API.md` are answered.
- `npm --prefix server test` passes; both typechecks pass.

## Phase 3: integration and launch (target 2:45 to 3:05 PM)

1. **api-builder:** all six routes.
2. In parallel: **ui-designer** wires remaining calls and checks the app in Expo Go or the simulator; **qa-verifier** runs the API tests against `npm --prefix server run dev` plus the audits.
3. **release-engineer:** deploy `server/` to Vercel production; set `EXPO_PUBLIC_API_URL` to the production URL; publish the app with EAS Update (app.json `runtimeVersion` must be the literal `exposdk:<expo major>.0.0`, or Expo Go will not load it); generate the Expo Go QR code; rerun the API tests against production. Time-box EAS Update to 10 minutes, then fall back to `npx expo start --tunnel`.

**Gate 3 (launch):** API tests pass on production; the human opens the app on their iPhone through the QR code, joins, swipes once, and sees a real Gemini order id. Tell the human: "Hunch is live. Show the QR at your table and post it in Discord."

## Phase 4: levels and profile (target 3:05 to 3:45 PM)

Parallel: **game-engine** (finalize levels and profile stats with tests), **api-builder** (profile, cap and stake from the level), **ui-designer** (Me tab level bar, category bars, insight). Then **qa-verifier** reruns everything and **release-engineer** deploys the API and publishes a new EAS Update.

**Gate 4:** tests pass on production; the Me tab shows real stats on the human's phone.

## Phase 5: video and submission assets (target 3:45 to 4:45 PM)

Human checkpoint: `ELEVENLABS_API_KEY` in `video/.env` and a voice choice. Then:
1. **video-producer** captures the app (the iPhone screen-recording route in `docs/VIDEO.md` on this Mac; the simulator route only if Phase 0 found one), generates the voiceover, renders `video/out/hunch-demo.mp4`, and reports its duration with `npx remotion ffprobe` (under 1:55).
2. In parallel, **release-engineer** writes `README.md`.
3. **qa-verifier** confirms every number in the video comes from the live app and that the repo contains no secrets.

**Gate 5:** video under 1:55 (checked with `npx remotion ffprobe video/out/hunch-demo.mp4`), README done, repo pushed public with `gh repo create hunch --public --source . --push` (ask the human first; if `gh` is unavailable, the human creates the repo on github.com and the release-engineer adds the remote and pushes).

Human: upload to YouTube and submit by 5:00 PM.
