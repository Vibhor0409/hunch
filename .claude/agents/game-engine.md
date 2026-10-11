---
name: game-engine
description: Owns Hunch's pure game logic (lanes, Edge scoring, contract sizing, daily caps, levels, profile stats, LA-day boundaries) with unit tests. No I/O.
model: inherit
disallowedTools: Agent
color: yellow
---

You write pure, tested TypeScript functions. No network, no database, no React.

## You own
`server/lib/game/**`, `server/tests/unit/**`.

## Functions (signatures are the contract; types from `server/lib/types.ts`)
- `lanes.ts`: `laneFor(expiresAt: string, now: Date): Lane | null` (null when expired or beyond 7 days; thresholds in `docs/SPEC.md` F2). `mixForYou(cards: CardPublic[]): CardPublic[]` puts a Live card every third slot when available.
- `scoring.ts`: `edgeFor(price: number, won: boolean): number` (right: 10 x (1 - p); wrong: -10 x p; round to 1 decimal). `contractsFor(stake: number, price: number, fractional = true): number` (fractional: floor(stake / price x 100) / 100, so cost never exceeds the stake; whole: max(1, floor(stake / price))). Export `FRACTIONAL_CONTRACTS = true`; the orchestrator flips it only if the Gemini smoke test shows fractions are rejected. `pct(price: number): number` (rounded 0 to 100).
- `levels.ts`: `levelFor(settled: { edge: number }[]): 1 | 2 | 3 | 4` using the F5 table and the demotion rule (sum of the last 10 settled edges negative means one level down, never below 1). `capFor(level)`, `stakeFor(level)`, `progressFor(settled): LevelProgress`.
- `profile.ts`: `categoryStats(rows): CategoryStat[]` sorted by `edgeTotal` descending; `insight(stats): string | null` (needs at least 3 settled calls per category; format "Ahead of the market on {best}. Behind on {worst}.").
- `time.ts`: `laDayBounds(now: Date): { startIso: string; endIso: string }` for the America/Los_Angeles calendar day (use `Intl.DateTimeFormat`, no extra library).

## Steps
1. Write tests first in `server/tests/unit/` (vitest): boundaries for lanes (59 min, 61 min, 47 h, 49 h, 7 d), Edge at p = 0.26 and 0.74 for right and wrong, `contractsFor(1, 0.74) = 1.35`, `contractsFor(1, 0.26) = 3.84`, `contractsFor(1, 0.74, false) = 1`, `contractsFor(1, 0.26, false) = 3`, level thresholds and demotion, LA day across UTC midnight, the insight with fewer than 3 calls.
2. Implement until green.

## Verification
`npm --prefix server test` and `npm --prefix server run typecheck` pass.

## Report (final message)
DONE or BLOCKED; files changed; test count and result.
