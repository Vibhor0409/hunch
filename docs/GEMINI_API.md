# Gemini prediction markets: verified facts

Verified on 2026-10-11 from developer.gemini.com. When the live API disagrees with this file, the live API wins: save the raw sample under `docs/samples/` and update this file.

## SDK

- Package: `@gemini-markets/sdk` (0.1.1 on Oct 11). Requires Node 22.4 or newer. ESM-only (`import` only, no `require` entry); fine under Next.js, vitest and tsx.
- Server import (use only in server code):

```ts
import { createClient, HmacAuth } from "@gemini-markets/sdk/server";

const client = await createClient({
  env: "sandbox",
  auth: new HmacAuth({
    apiKey: process.env.GEMINI_API_KEY!,
    apiSecret: process.env.GEMINI_API_SECRET!,
    nonceMode: "time-based", // the sandbox rejects the default monotonic nonce with InvalidNonce (verified 3:47 PM)
  }),
  skipWsInit: true, // REST only; we do not use WebSockets
});
```

- The SDK signs requests with HMAC. Never pass `nonce` or `request` yourself.
- Methods take one flat params object, plus an optional second argument `{ signal, timeoutMs }`.
- GET calls retry automatically on 429, 502, 503 and 504. POST calls are never retried.
- Authenticated WebSockets exist (API key plus a signed payload, per the API docs; confirmed by the Gemini team). Hunch does not use them: settlement runs lazily over REST.
- `client.close()` releases resources. In route handlers, cache one client per server instance in a module-level promise.
- Docs: https://developer.gemini.com/tools/typescript-sdk/quickstart and https://developer.gemini.com/tools/typescript-sdk/reference/overview

## Public methods on `client.predictions` (no auth needed)

| Method | Endpoint | Params | Returns |
| --- | --- | --- | --- |
| `listEvents` | GET /v1/prediction-markets/events | `status: string[]`, `category: string[]`, `sport`, `limit` (max 500, default 50), `offset`, `search` | `{ data: Event[], pagination: { limit, offset, total } }` |
| `getEvent` | GET /v1/prediction-markets/events/{eventTicker} | `eventTicker` | `Event` |
| `getEventStrike` | GET /v1/prediction-markets/events/{eventTicker}/strike | `eventTicker` | `{ value, type, availableAt }` |
| `getCategories` | GET /v1/prediction-markets/categories | `status?` | `{ categories: string[] }` |
| `listUpcomingEvents` | GET /v1/prediction-markets/events/upcoming | `category`, `limit` | same shape as `listEvents` |
| `listNewlyListedEvents` | GET /v1/prediction-markets/events/newly-listed | `category`, `limit` | same shape |
| `listRecentlySettledEvents` | GET /v1/prediction-markets/events/recently-settled | `category`, `limit` | same shape |

## Event and contract shape (from the docs; confirm with a sample)

- **Event:** `id, title, slug, ticker, description, type ('binary' | 'categorical'), category, subcategory, series, tags, status ('approved' | 'active' | 'closed' | 'under_review' | 'settled' | 'invalid'), createdAt, effectiveDate, expiryDate, resolvedAt, liquidity, volume, contracts[]`
- **Contract:** `id, label, ticker, instrumentSymbol, status, marketState ('open' | 'closed'), expiryDate, resolvedAt, resolutionSide ('yes' | 'no'), settlementValue (present only after settlement), quantityIncrement, quantityMinimum, priceIncrement, priceMinimum, prices: { buy: { yes, no }, sell: { yes, no }, bestBid, bestAsk, lastTradePrice }`. Prices are decimal strings from 0 to 1. The REST get-event schema confirms `bestBid`, `bestAsk` and `lastTradePrice` inside `prices`; the `buy` and `sell` sub-objects come from the SDK docs and must be confirmed from `docs/samples/events.json`. If `prices.buy` is absent, record the observed shape here before writing `feed.ts`.
- Implied probability of YES = `Number(prices.buy.yes)`; of NO = `Number(prices.buy.no)`.
- Orders use `instrumentSymbol` (example: `GEMI-BTC05M2606011000-UP`).
- BTC 5-minute events (tickers starting `BTC05M`) expire every 5 minutes. Always fetch the current one; never cache it past its expiry.

## Authenticated methods on `client.predictions`

| Method | Endpoint | Params | Returns and notes |
| --- | --- | --- | --- |
| `placeOrder` | POST /v1/prediction-markets/order | `symbol`, `orderType: "limit"`, `side: "buy"`, `quantity` (string), `price` (string, 0 to 1), `outcome: "yes" or "no"`, `timeInForce: "immediate-or-cancel"`, `makerOrCancel: false` | `{ orderId (bigint), status: "open" or "filled" or "cancelled", symbol, ... }`. Throws `AcceptTermsRequired` or `ValidationError { field, rule, message }`. Never retried. |
| `getOrderHistory` | POST /v1/prediction-markets/orders/history | `status?`, `symbol?`, `from?`, `to?` (bigint epoch ms) | `{ orders: [...] }` |
| `getActiveOrders` | POST /v1/prediction-markets/orders/active | `symbol?`, `limit?` | `{ orders }` |
| `getPositions` | POST /v1/prediction-markets/positions | `eventTicker?`, `limit?`, `offset?`, `sort?` | `{ positions: [{ symbol, totalQuantity, avgPrice, outcome, ... }], total }` |
| `getSettledPositions` | POST /v1/prediction-markets/positions/settled | `eventTicker?`, `limit?`, `sort?` (e.g. `"-date"`), `withCashOuts?` | `{ positions: [{ instrumentSymbol, payout, resolutionSide, netProfit }], total }` |
| `getPredictionMarketsTermsStatus` | GET /v1/prediction-markets/terms/status | none | `{ hasAcceptedLatest, acceptedVersion, latestVersion }` |
| `acceptTerms` | POST /v1/prediction-markets/terms/accept | none | `{ success }` |

`orderId` is a bigint. Convert with `String(orderId)` before JSON responses or database writes.

## Card text

Final rule (Phase 2, from `docs/samples/events.json` and `btc05m-event.json`; implemented as `questionFor` in `server/lib/gemini/cards.ts`). Every card is a yes/no question built only from `event.title`, `contract.label` and `contract.strike`:

1. Strip a trailing `?` from the title so it is never doubled ("Gold price on October 16?" becomes "Gold price on October 16").
2. One contract labelled `Up` or `Down` with a `strike` of type `reference` and a numeric `value` (the crypto Up/Down series: BTC05M, BTC15M and the ETH, SOL, XRP equivalents): `${title}: ${label} from ${strike as USD}?`, for example "BTC price today at 6:15pm EDT: Up from $83,515.78?". The strike is the index price at the window start; before `strike.availableAt` the value is null and the rule falls through to 4. When the sandbox copy has no strike yet and the production copy of the same contract has one, that strike is used.
3. No label, or one contract labelled `Yes`, or one contract whose title already ends with `?` ("Will GameStop acquire eBay?", "Will Enes Kanter play in a WNBA game in the 2027 season?" with label "Enes Kanter"): `${title}?`. A trailing `?` on the label is stripped too ("SAVE Act becomes law?").
4. Everything else: `${title}: ${label}?`, for example "BTC price today at 7pm EDT: $83,100 or above?" (hourly price ladders), "Texas US Senate Winner: James Talarico?", "Denver vs Los Angeles C: Denver?", "Fed decision in October: Fed maintains rate?", "Highest temperature in Austin on October 11, 2026: 92°F to 93°F?".

Observed shapes: sandbox titles "BTC price today at 7pm EDT" (categorical ladder, labels "$83,100 or above", `abbreviatedName` ">$83,100"), "BTC price today at 6:15pm EDT" (binary, one contract labelled "Up"), "Gold price on October 16?" (categorical, 5 contracts). Production (survey of 3,154 informative open contracts on Oct 11): 3,076 belong to multi-contract events (team names, candidates, strike ladders, temperature bands, date buckets), 68 are single Up/Down, 3 single "Yes", 7 single with another label; every one of them reads as a question under the rule above. `contract.description` is a rich-text document object, not a string, and is not used.

## Settlement (resolve in this order)

1. **Filled paid swipes:** `getSettledPositions({ eventTicker })` returns `resolutionSide` per `instrumentSymbol`. `won = swipe.side === resolutionSide`, after confirming the values of `resolutionSide` from a sample.
2. **Everything else** (practice swipes, unfilled orders): `getEvent({ eventTicker })`. When `status` is `settled`, read the winning outcome from `contracts[].resolutionSide` (`yes` or `no`; the REST get-event schema lists it next to `settlementValue` and `resolvedAt`). **Confirm from `docs/samples/settled-event.json` before coding against it.** The Phase 2 gate requires the gemini-integrator to confirm and document it.
3. If neither gives a result within 30 minutes of expiry, leave the swipe unsettled. Never guess.

## Unknowns to answer in Phase 2 (write the answers here)

Answered on 2026-10-11 from live samples under `docs/samples/` (`events.json`, `btc05m-event.json`, `settled-event.json`, `settled-events.json`, `events-production.json`). The `--order` run is still pending; see the two items marked BLOCKED.

- [x] Does the sandbox list active events with prices? Partly. 94 to 102 active events (Crypto and Commodities only), about 300 open contracts, but only 33 to 38 quoted contracts across 5 to 10 events (hourly price ladders, 15-minute and some 5-minute Up contracts, one gold market). Unquoted contracts carry `prices: { buy: {}, sell: {} }` (empty objects, not null). Sandbox lanes alone: live 36, tomorrow 0, week 1. Production (unauthenticated, public) lists 952 to 966 active events in 9 categories with about 3,150 open contracts quoted inside the informative band: Sports 2,290, Politics 414, Crypto 225, Commodities 82, Economics 63, Culture 34, Business 22, Weather 17, Tech 7; by lane later 1,352, week 960, tomorrow 720, live 72 (50 beyond a year). 234 production contracts share an `instrumentSymbol` with an open sandbox contract. **Decision (feed v2, 4:30 PM): the feed is built from the production listing across all categories** (4 pages of 500 in parallel, 8 s budget; page 1 is 15 MB so the public clients set `maxResponseSizeBytes` to 64 MiB) **plus the sandbox listing** (read twice in parallel and merged). A card is `tradable` when the sandbox lists its instrument as open; tradable cards take sandbox quotes when the sandbox has informative ones, production quotes otherwise. Contracts with either side at or below 0.02 or at or above 0.98 are not dealt. Each category contributes at most 40 live and 40 other cards, balanced across lanes and events, and categories are interleaved one card at a time. Result: 322 cards across 190 events (Crypto 80, Sports 43, Commodities 40, Economics 40, Politics 40, Culture 34, Business 22, Weather 17, Tech 6; lanes live 43, tomorrow 54, week 42, later 183; 111 tradable, 34%). Served from memory under 60 s, else from the `feed_snapshot` table under 120 s (a build is kicked in the background past 60 s), else built live and saved: cold read from the snapshot 131 ms, live build 3.3 s. `getQuote` returns the dealt card when the feed is under 60 s old, else reads sandbox and production in parallel (3 s each; tradable only when the sandbox answers with the contract open). `resolveOutcome` reads both in parallel and settles from whichever reports a settled side (sandbox first when both do; a disagreement settles nothing). Orders always go to the sandbox with a 10 s deadline.
- [x] Which field reports the winning outcome on a settled event or contract? `contracts[].resolutionSide`, next to `contracts[].settlementValue` (the index price, for example "111.92613030166666"), `contracts[].resolvedAt`, `contract.status: "settled"`, `contract.marketState: "closed"` and `event.settlement.value`. Contracts can be `settled` while the event is still `under_review` (ETH2610112200 sample), and an `under_review` contract may already show a side; `resolveOutcome` accepts a side only when the contract or the event has status `settled`.
- [x] What values does `resolutionSide` take? `yes` and `no`, both observed (GEMI-SOL05M2610111835-UP `yes`; the BTC2610112200 ladder settled at 83436.95 with HI83200 to HI83400 `yes` and HI83500 to HI83900 `no`).
- [x] Minimum order size and fractional quantities: every sampled contract reports `quantityIncrement "0.01"`, `quantityMinimum "0.01"`, `priceIncrement "0.01"`, `priceMinimum "0.01"` and `quoteAssetPrecision 2`, so 2-decimal fractional quantities are on the instrument grid and `FRACTIONAL_CONTRACTS` stays on. Prices are 2-decimal strings ("0.23"). Live confirmation with a filled order is BLOCKED on the key (next item).
- [ ] Does `placeOrder` return fill details? BLOCKED, not yet confirmed live. The SDK's `OrderResponse` type declares `orderId` (bigint), `status` ("open" | "filled" | "cancelled"), `quantity`, `filledQuantity`, `remainingQuantity`, `price`, `avgExecutionPrice`, `createdAt`; `orders.ts` reads `filledQuantity` when present and otherwise uses the requested quantity for a filled order. The blocker: the key in `server/.env.local` is a production master key (`master-` prefix). The sandbox answers HTTP 400 `InvalidApiKey` to every authenticated call (terms status, positions, order history, active orders), and production answers HTTP 400 `MissingAccounts` to the same key, the master-key error for a payload without an `account` field. The prediction endpoints take no `account` field, so a master key cannot work on either environment. Needed from the human: an API key created at https://exchange.sandbox.gemini.com for the primary account (scope Primary, not Master) with Trading enabled, pasted into `server/.env.local`; then from `server/` run `npx tsx scripts/gemini-smoke.ts --order`. The script accepts the terms if `hasAcceptedLatest` is false, buys $1 of YES on the soonest quoted BTC event (the 5-minute series has no sandbox quotes, so this is the 15-minute one), retries once with quantity "1" if the fractional quantity is rejected, prints the full response and saves `docs/samples/order.json`.
- [x] Terms: `getPredictionMarketsTermsStatus()` returns `{ hasAcceptedLatest, acceptedVersion, latestVersion }` per the SDK type (live value unknown until the key above exists). The SDK exposes `acceptTerms()` (and `acceptPredictionMarketsTerms()`) and maps the server reasons `TERMS_NOT_ACCEPTED` and `AcceptTermsRequired` to its `AcceptTermsRequired` class, which `placeBuy` maps to receipt status `not_placed` with "Terms not accepted".

Sandbox behaviour observed in Phase 2 (all handled in `server/lib/gemini/`):

- `feed_snapshot` is not yet in the `Database` type of `server/lib/db/client.ts`; `lib/gemini/snapshot.ts` widens the client to the untyped `SupabaseClient` for that table only. Adding the table to the type is the data-architect's call.
- The "later" lane (7 to 365 days) is assigned by `lib/gemini/cards.ts` (`laneOf`) when `laneFor` returns null; once `lib/game/lanes.ts` returns "later" itself the fallback is inert. The feed route re-applies `laneFor` per card, so "later" cards reach the app only after that change lands.
- The sandbox answers from replicas that disagree. The same `listEvents({ status: ["active"], limit: 500 })` returned 94 events with 37 quoted contracts on one call and 61 to 73 events with 1 quoted contract on the next; `listRecentlySettledEvents` returned 0 events (total 0) and 20 (total 1000) for the same request a second apart. `feed.ts` issues three parallel listings and merges them by ticker, keeping the quoted copy of each contract.
- `getEvent` returned 404 "Event not found" for 5-minute tickers the listing had just returned as active (BTC05M2610112215; BTC05M2610112230 three attempts in a row) and for a settled one (SOL05M2610111835), while 15-minute, hourly and gold tickers always resolved; one sandbox getEvent also ran into its 3 s deadline. Since feed v2 every quote and settlement lookup reads production in parallel with the sandbox, so a sandbox miss costs tradability for that call, never the answer. `findActiveEvent` (a fresh two-page listing scan) remains for `lib/context`. `listRecentlySettledEvents({ limit: 500 })` works (1.7 MB, about 1 s, roughly the last 7 hours, most recent first; `offset` exists) but is no longer used.
- Two public calls exceeded the SDK's 30 s default deadline; `lib/gemini` deadlines are 8 s for listing pages, 3 s for getEvent, 10 s for placeOrder.
- `getEventStrike` answered 404 "Strike not found" for a 5-minute event before its window started, and `{ type: "reference", availableAt }` with no `value` yet at the window start (`docs/samples/btc05m-strike.json`); the same data is on `contracts[].strike`, which the card text uses once `value` is present.
- Events listed as `active` include ones already expired (`laneFor` drops them) and ones whose window has not started (unquoted, so not cards). Event statuses seen: `active`, `approved` (contracts `post_only`), `under_review`, `settled`. `status: ["closed"]` and `["invalid"]` are rejected with 400 `ValidationError`. The `category: ["Crypto"]` filter returned 10 events while the unfiltered listing had 76 Crypto events, so the feed never filters by category server-side.
- A production listing page of 500 events is 10 to 15 MB (Sports events embed a nested `events` array of sub-events); four pages in parallel take about 5.4 s on a laptop, and the SDK's default 16 MiB response cap is raised to 64 MiB on the public clients.
- The SDK is ESM-only with an `import`-only exports map, and `tsx` runs the scripts as CommonJS, so `lib/gemini/client.ts` loads the SDK with a dynamic `import()` (`getSdk()`); Next.js bundles it normally.

## Accounts

Sandbox web app: https://exchange.sandbox.gemini.com (a separate demo account with $100k test USD). Sandbox REST host: api.sandbox.gemini.com.
