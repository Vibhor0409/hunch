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

Default rule: if the event has one contract, the question is `event.title`. If it has several, the question is `${event.title}: ${contract.label}`. Check real samples and adjust so every card reads as a yes/no question; record the final rule here.

## Settlement (resolve in this order)

1. **Filled paid swipes:** `getSettledPositions({ eventTicker })` returns `resolutionSide` per `instrumentSymbol`. `won = swipe.side === resolutionSide`, after confirming the values of `resolutionSide` from a sample.
2. **Everything else** (practice swipes, unfilled orders): `getEvent({ eventTicker })`. When `status` is `settled`, read the winning outcome from `contracts[].resolutionSide` (`yes` or `no`; the REST get-event schema lists it next to `settlementValue` and `resolvedAt`). **Confirm from `docs/samples/settled-event.json` before coding against it.** The Phase 2 gate requires the gemini-integrator to confirm and document it.
3. If neither gives a result within 30 minutes of expiry, leave the swipe unsettled. Never guess.

## Unknowns to answer in Phase 2 (write the answers here)

- [ ] Does the sandbox list active events with prices? How many per category? If not, read the feed from a second, unauthenticated client with `env: "production"`, and show only contracts whose `instrumentSymbol` also exists in the sandbox.
- [ ] Which field reports the winning outcome on a settled event or contract? Likely `contracts[].resolutionSide` (REST get-event schema, checked Oct 11). Confirm from the sample.
- [ ] What values does `resolutionSide` take? The REST schema says `yes` or `no`. Confirm from the sample.
- [x] Minimum order size: none on the prediction markets sandbox (confirmed by the Gemini team on Oct 11; spot pairs have their own minimums, which do not apply). Fractional quantities: expected to work; before the `--order` run, print `quantityIncrement` and `quantityMinimum` of the BTC 5-minute contract (an increment of `1` means whole contracts only), then confirm with the first `--order` smoke run (2-decimal quantity) and record the result here.
- [ ] Does `placeOrder` return fill details (filled quantity, average price) when status is `filled`?

## Accounts

Sandbox web app: https://exchange.sandbox.gemini.com (a separate demo account with $100k test USD). Sandbox REST host: api.sandbox.gemini.com.
