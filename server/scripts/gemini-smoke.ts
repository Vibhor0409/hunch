// Gemini sandbox smoke test for Hunch. Run from server/:
//   npx tsx scripts/gemini-smoke.ts           read-only: events, strike, settled events, terms status
//   npx tsx scripts/gemini-smoke.ts --order   also accepts terms if needed and places ONE $1 immediate-or-cancel buy
// Loads server/.env.local. Saves raw JSON under docs/samples/. Never prints keys.
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";

loadEnv({ path: fileURLToPath(new URL("../.env.local", import.meta.url)), quiet: true });

import { laneFor } from "../lib/game/lanes";

// The SDK is ESM-only and tsx runs this file as CommonJS, so it is loaded with a
// dynamic import (resolved with the "import" condition). Assigned once in main().
type Sdk = typeof import("@gemini-markets/sdk/server");
let sdk: Sdk;

type Client = Awaited<ReturnType<Sdk["createClient"]>>;
type EventsPage = Awaited<ReturnType<Client["predictions"]["listEvents"]>>;
type Event = NonNullable<EventsPage["data"]>[number];
type Contract = NonNullable<Event["contracts"]>[number];

const SAMPLES_DIR = fileURLToPath(new URL("../../docs/samples/", import.meta.url));
const PLACE_ORDER = process.argv.includes("--order");
const MIN_PRICED_EVENTS = 20;

function replacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}

function stringify(value: unknown): string {
  return JSON.stringify(value, replacer, 2);
}

async function save(name: string, value: unknown): Promise<void> {
  await writeFile(`${SAMPLES_DIR}${name}`, `${stringify(value)}\n`);
  console.log(`saved docs/samples/${name}`);
}

function describeError(error: unknown): string {
  if (error instanceof sdk.ValidationError) {
    return `${error.name}: field=${error.field} rule=${error.rule} ${error.message}`;
  }
  if (error instanceof sdk.ApiError) {
    return `${error.name} (http ${error.status}, reason=${error.reason ?? "none"}, code=${error.code}): ${error.message}`;
  }
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

function count<T>(items: readonly T[], keyOf: (item: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of items) {
    const key = keyOf(item);
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}

function hasBothBuyPrices(contract: Contract): boolean {
  const buy = contract.prices?.buy;
  return typeof buy?.yes === "string" && buy.yes !== "" && typeof buy?.no === "string" && buy.no !== "";
}

function expiresAtOf(event: Event, contract: Contract): string | null {
  return contract.expiryDate ?? event.expiryDate ?? null;
}

interface PricedContract {
  event: Event;
  contract: Contract;
  expiresAt: string;
}

/** Open contracts with a buy price on both sides, with the expiry each card would use. */
function pricedContracts(events: readonly Event[]): PricedContract[] {
  const out: PricedContract[] = [];
  for (const event of events) {
    for (const contract of event.contracts ?? []) {
      if (contract.marketState !== "open" || !hasBothBuyPrices(contract)) continue;
      const expiresAt = expiresAtOf(event, contract);
      if (!expiresAt) continue;
      out.push({ event, contract, expiresAt });
    }
  }
  return out;
}

/** Every active event from one paginated listing with the API maximum page size. */
async function listAllPages(client: Client): Promise<Event[]> {
  const all: Event[] = [];
  const limit = 500;
  for (let offset = 0; ; offset += limit) {
    const page = await client.predictions.listEvents({ status: ["active"], limit, offset }, { timeoutMs: 15_000 });
    const data = page.data ?? [];
    all.push(...data);
    const total = page.pagination?.total;
    if (data.length < limit || (typeof total === "number" && all.length >= total)) break;
  }
  return all;
}

/**
 * Three parallel listings merged by ticker, keeping quoted contract copies. The sandbox
 * answers from replicas that disagree (one lists about 90 events with 35 quoted
 * contracts, another about 65 with 1), so each listing's counts are printed too.
 */
async function listAllActiveEvents(client: Client, label: string): Promise<Event[]> {
  const listings = await Promise.all([listAllPages(client), listAllPages(client), listAllPages(client)]);
  const merged = new Map<string, Event>();
  listings.forEach((listing, i) => {
    const quoted = listing.flatMap((e) => e.contracts ?? []).filter(hasBothBuyPrices).length;
    console.log(`${label} listing ${i + 1}: ${listing.length} events, ${quoted} quoted contracts`);
    for (const event of listing) {
      if (!event.ticker) continue;
      const existing = merged.get(event.ticker);
      if (!existing) {
        merged.set(event.ticker, { ...event, contracts: [...(event.contracts ?? [])] });
        continue;
      }
      const contracts = existing.contracts ?? [];
      for (const contract of event.contracts ?? []) {
        const index = contracts.findIndex((c) => c.instrumentSymbol === contract.instrumentSymbol);
        if (index === -1) contracts.push(contract);
        else if (!hasBothBuyPrices(contracts[index]) && hasBothBuyPrices(contract)) contracts[index] = contract;
      }
      existing.contracts = contracts;
    }
  });
  return [...merged.values()];
}

function printContractGrid(contract: Contract): void {
  console.log(
    `  ${contract.instrumentSymbol ?? "?"} label="${contract.label ?? ""}" marketState=${contract.marketState ?? "?"} status=${contract.status ?? "?"}`,
  );
  console.log(
    `    quantityIncrement=${contract.quantityIncrement ?? "null"} quantityMinimum=${contract.quantityMinimum ?? "null"} priceIncrement=${contract.priceIncrement ?? "null"} priceMinimum=${contract.priceMinimum ?? "null"}`,
  );
  console.log(
    `    buy.yes=${contract.prices?.buy?.yes ?? "null"} buy.no=${contract.prices?.buy?.no ?? "null"} sell.yes=${contract.prices?.sell?.yes ?? "null"} sell.no=${contract.prices?.sell?.no ?? "null"} bestBid=${contract.prices?.bestBid ?? "null"} bestAsk=${contract.prices?.bestAsk ?? "null"} last=${contract.prices?.lastTradePrice ?? "null"} expiry=${contract.expiryDate ?? "null"}`,
  );
}

/**
 * getEvent with up to 3 attempts on 404. The sandbox returned 404 for tickers it had just
 * listed as active (a replica miss); the third attempt usually succeeds. Null when it does not.
 */
async function getEventRetrying(client: Client, eventTicker: string): Promise<Event | null> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await client.predictions.getEvent({ eventTicker }, { timeoutMs: 15_000 });
    } catch (error) {
      if (!(error instanceof sdk.NotFoundError)) throw error;
      console.log(`getEvent ${eventTicker} attempt ${attempt}: 404 Event not found`);
      if (attempt >= 3) return null;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
}

/** Rounds a price up to 2 decimals so an immediate-or-cancel buy sits at or above the ask. */
function ceil2(value: number): number {
  return Math.ceil(value * 100 - 1e-9) / 100;
}

async function main(): Promise<void> {
  const apiKey = process.env.GEMINI_API_KEY;
  const apiSecret = process.env.GEMINI_API_SECRET;
  if (!apiKey || !apiSecret) throw new Error("GEMINI_API_KEY or GEMINI_API_SECRET is missing in server/.env.local");
  await mkdir(SAMPLES_DIR, { recursive: true });
  sdk = await import("@gemini-markets/sdk/server");

  const client = await sdk.createClient({
    env: "sandbox",
    auth: new sdk.HmacAuth({ apiKey, apiSecret }),
    skipWsInit: true,
  });

  try {
    const now = new Date();
    console.log(`now ${now.toISOString()}`);

    // 1. Active events (first page of 200, saved raw) plus a full paginated read for the counts.
    console.log("\n== listEvents({ status: [\"active\"], limit: 200 })");
    const page = await client.predictions.listEvents({ status: ["active"], limit: 200 });
    await save("events.json", page);
    console.log(`page: ${page.data?.length ?? 0} events, pagination=${stringify(page.pagination)}`);

    const events = await listAllActiveEvents(client, "sandbox");
    console.log(`all active events (merged): ${events.length}`);
    console.log(`event.status values: ${stringify(count(events, (e) => e.status ?? "undefined"))}`);
    console.log(`event.type values: ${stringify(count(events, (e) => e.type ?? "undefined"))}`);
    console.log(`by category: ${stringify(count(events, (e) => e.category ?? "undefined"))}`);
    console.log(`contracts per event: ${stringify(count(events, (e) => String(e.contracts?.length ?? 0)))}`);

    const allContracts = events.flatMap((e) => e.contracts ?? []);
    console.log(`contracts: ${allContracts.length}`);
    console.log(`contract.marketState values: ${stringify(count(allContracts, (c) => String(c.marketState)))}`);
    console.log(`contract.status values: ${stringify(count(allContracts, (c) => String(c.status)))}`);
    console.log(`contracts with prices.buy.yes and prices.buy.no: ${allContracts.filter(hasBothBuyPrices).length}`);
    console.log(`contracts with prices.buy but no sell: ${allContracts.filter((c) => c.prices?.buy && !c.prices?.sell).length}`);

    const priced = pricedContracts(events);
    const pricedEvents = new Set(priced.map((p) => p.event.ticker));
    console.log(`open contracts with both buy prices: ${priced.length} across ${pricedEvents.size} events`);
    console.log(`by lane (open, priced): ${stringify(count(priced, (p) => laneFor(p.expiresAt, now) ?? "null"))}`);
    console.log(
      `by category (open, priced, in a lane): ${stringify(count(priced.filter((p) => laneFor(p.expiresAt, now) !== null), (p) => p.event.category ?? "undefined"))}`,
    );
    console.log(`contracts whose expiryDate is null (using event.expiryDate): ${priced.filter((p) => !p.contract.expiryDate).length}`);

    console.log("\n== sample titles and labels (for the card text rule)");
    const seenTitles = new Set<string>();
    let shown = 0;
    for (const p of priced) {
      const key = `${p.event.ticker}`;
      if (seenTitles.has(key)) continue;
      seenTitles.add(key);
      const n = p.event.contracts?.length ?? 0;
      console.log(`  [${p.event.type}/${n} contracts] ${p.event.ticker} title="${p.event.title}" label="${p.contract.label}" abbreviatedName="${p.contract.abbreviatedName ?? ""}"`);
      if (++shown >= 25) break;
    }

    // 2. BTC 5-minute event: getEvent and getEventStrike.
    console.log("\n== BTC 5-minute event");
    // At least 90 seconds left, so the event does not expire (and 404) between the listing and getEvent.
    const future = (e: Event) => (e.expiryDate ? new Date(e.expiryDate).getTime() > now.getTime() + 90_000 : false);
    const byExpiry = (a: Event, b: Event) => new Date(a.expiryDate ?? 0).getTime() - new Date(b.expiryDate ?? 0).getTime();
    const btc = events.filter((e) => e.ticker?.startsWith("BTC05M") && future(e)).sort(byExpiry);
    let target: Event | undefined = btc[0];
    if (!target) {
      console.log("no active BTC05M event in the sandbox; using the soonest-expiring active event instead");
      target = events.filter(future).sort(byExpiry)[0];
    }
    if (!target?.ticker) throw new Error("no active event with a future expiry");
    console.log(`target ${target.ticker} title="${target.title}" expiry=${target.expiryDate} category=${target.category}`);

    const fetched = await getEventRetrying(client, target.ticker);
    const detail = fetched ?? target;
    if (fetched) await save("btc05m-event.json", fetched);
    else console.log("getEvent kept answering 404; printing the listing's copy of the event instead (sample not overwritten)");
    console.log(`${fetched ? "getEvent" : "listing"}: status=${detail.status} type=${detail.type} contracts=${detail.contracts?.length ?? 0} sourceDetails=${stringify(detail.sourceDetails)}`);
    for (const contract of detail.contracts ?? []) printContractGrid(contract);
    try {
      const strike = await client.predictions.getEventStrike({ eventTicker: target.ticker });
      await save("btc05m-strike.json", strike);
      console.log(`getEventStrike: ${stringify(strike)}`);
    } catch (error) {
      console.log(`getEventStrike failed: ${describeError(error)}`);
    }

    // 3. Recently settled events.
    console.log("\n== listRecentlySettledEvents({ limit: 5 })");
    const settled = await client.predictions.listRecentlySettledEvents({ limit: 5 });
    await save("settled-events.json", settled);
    const first = settled.data?.[0];
    if (first) {
      await save("settled-event.json", first);
      console.log(`first settled: ${first.ticker} title="${first.title}" status=${first.status} resolvedAt=${first.resolvedAt} settlement=${stringify(first.settlement)}`);
      for (const contract of first.contracts ?? []) {
        console.log(
          `  ${contract.instrumentSymbol} label="${contract.label}" resolutionSide=${contract.resolutionSide ?? "undefined"} settlementValue=${contract.settlementValue ?? "undefined"} resolvedAt=${contract.resolvedAt ?? "undefined"} status=${contract.status} marketState=${contract.marketState}`,
        );
      }
      const allSettledContracts = (settled.data ?? []).flatMap((e) => e.contracts ?? []);
      console.log(`resolutionSide values across ${allSettledContracts.length} settled contracts: ${stringify(count(allSettledContracts, (c) => String(c.resolutionSide)))}`);
      console.log(`settled event.status values: ${stringify(count(settled.data ?? [], (e) => String(e.status)))}`);
    } else {
      console.log("no recently settled events returned");
    }

    // 4. Terms status (authenticated). A failure here is reported, not fatal, so the public checks still finish.
    console.log("\n== getPredictionMarketsTermsStatus()");
    let terms: Awaited<ReturnType<Client["predictions"]["getPredictionMarketsTermsStatus"]>> | null = null;
    try {
      terms = await client.predictions.getPredictionMarketsTermsStatus();
      console.log(stringify(terms));
    } catch (error) {
      console.log(`getPredictionMarketsTermsStatus failed: ${describeError(error)}`);
    }

    // 5. Feed source decision and the production fallback test.
    console.log("\n== feed source");
    if (pricedEvents.size >= MIN_PRICED_EVENTS) {
      console.log(`sandbox has ${pricedEvents.size} priced events (>= ${MIN_PRICED_EVENTS}): feed source = sandbox`);
    } else {
      console.log(`sandbox has only ${pricedEvents.size} priced events (< ${MIN_PRICED_EVENTS}): testing the production public feed fallback`);
      const pub = await sdk.createClient({ env: "production", skipWsInit: true });
      try {
        const prodEvents = await listAllActiveEvents(pub, "production");
        const prodPriced = pricedContracts(prodEvents);
        const sandboxSymbols = new Set(allContracts.map((c) => c.instrumentSymbol).filter((s): s is string => typeof s === "string"));
        const overlap = prodPriced.filter((p) => p.contract.instrumentSymbol && sandboxSymbols.has(p.contract.instrumentSymbol));
        await save("events-production.json", { count: prodEvents.length, data: prodEvents.slice(0, 50) });
        console.log(`production: ${prodEvents.length} active events, ${prodPriced.length} open priced contracts`);
        console.log(`production priced contracts whose instrumentSymbol also exists in the sandbox: ${overlap.length}`);
        console.log(`by lane (overlap): ${stringify(count(overlap, (p) => laneFor(p.expiresAt, now) ?? "null"))}`);
        console.log(overlap.length > priced.length ? "feed source = production intersect sandbox" : "feed source = sandbox (fallback adds nothing)");
      } finally {
        pub.close();
      }
    }

    // 6. One real order, only with --order.
    if (PLACE_ORDER) {
      console.log("\n== --order: one $1 immediate-or-cancel buy on YES");
      if (!terms) throw new Error("terms status unavailable (authentication failed), not placing an order");
      if (!terms.hasAcceptedLatest) {
        const accepted = await client.predictions.acceptTerms();
        console.log(`acceptTerms(): ${stringify(accepted)}`);
        console.log(`terms status after accept: ${stringify(await client.predictions.getPredictionMarketsTermsStatus())}`);
      }
      // Prefer the BTC 5-minute event; when its contract has no YES buy price yet, use the soonest-expiring
      // priced BTC event (the 15-minute Up/Down market) so the test order still reaches the sandbox book.
      const hasYesBuy = (c: Contract) => c.marketState === "open" && typeof c.prices?.buy?.yes === "string" && c.prices.buy.yes !== "";
      let orderEvent: Event | undefined;
      let contract: Contract | undefined;
      for (const candidate of [target, ...events.filter((e) => e.ticker?.startsWith("BTC") && future(e)).sort(byExpiry)]) {
        if (!candidate.ticker) continue;
        const fresh = await getEventRetrying(client, candidate.ticker);
        if (!fresh) continue;
        const found = (fresh.contracts ?? []).find(hasYesBuy);
        if (found) {
          orderEvent = fresh;
          contract = found;
          break;
        }
        console.log(`${candidate.ticker}: no open contract with a YES buy price right now, trying the next BTC event`);
      }
      if (!orderEvent?.ticker || !contract?.instrumentSymbol || !contract.prices?.buy?.yes) throw new Error("no BTC event with a YES buy price; not placing an order");
      console.log(`order event ${orderEvent.ticker} title="${orderEvent.title}" expiry=${orderEvent.expiryDate}`);
      const rawPrice = contract.prices.buy.yes;
      const price = ceil2(Number(rawPrice));
      if (!(price > 0 && price < 1)) throw new Error(`YES buy price out of range: ${rawPrice}`);
      const priceStr = price.toFixed(2);
      const fractional = (Math.floor((1 / price) * 100) / 100).toFixed(2);
      console.log(`contract ${contract.instrumentSymbol} buy.yes=${rawPrice} -> limit price ${priceStr}, quantity ${fractional} (about $${(Number(fractional) * price).toFixed(4)})`);
      console.log(`grid: quantityIncrement=${contract.quantityIncrement} quantityMinimum=${contract.quantityMinimum} priceIncrement=${contract.priceIncrement} priceMinimum=${contract.priceMinimum}`);

      const attempts: unknown[] = [];
      let worked: string | null = null;
      for (const quantity of [fractional, "1"]) {
        const request = {
          symbol: contract.instrumentSymbol,
          orderType: "limit" as const,
          side: "buy" as const,
          quantity,
          price: priceStr,
          outcome: "yes" as const,
          timeInForce: "immediate-or-cancel" as const,
          makerOrCancel: false,
        };
        console.log(`placeOrder ${stringify(request)}`);
        try {
          const response = await client.predictions.placeOrder(request);
          console.log(`response: ${stringify(response)}`);
          console.log(`orderId=${String(response.orderId)} status=${response.status} quantity=${response.quantity} filledQuantity=${response.filledQuantity} remainingQuantity=${response.remainingQuantity} avgExecutionPrice=${response.avgExecutionPrice}`);
          attempts.push({ quantity, ok: true, request, response });
          worked = quantity;
          break;
        } catch (error) {
          const detail = describeError(error);
          console.log(`rejected: ${detail}`);
          attempts.push({ quantity, ok: false, request, error: detail });
          const retryable =
            error instanceof sdk.ValidationError ||
            (error instanceof sdk.ApiError &&
              !(error instanceof sdk.AcceptTermsRequired) &&
              !(error instanceof sdk.InsufficientFunds) &&
              (error.status === 400 || error.status === 422));
          if (!retryable || quantity === "1") break;
          console.log("retrying once with quantity \"1\"");
        }
      }
      await save("order.json", { placedAt: new Date().toISOString(), eventTicker: orderEvent.ticker, workedWithQuantity: worked, attempts });
      console.log(worked === null ? "ORDER NOT PLACED" : worked === "1" ? "fractional quantity REJECTED; whole contract worked" : `fractional quantity ${worked} WORKED`);
    }

    console.log("\nSMOKE OK");
  } finally {
    client.close();
  }
}

main().catch((error: unknown) => {
  console.error(`SMOKE FAILED: ${describeError(error)}`);
  process.exitCode = 1;
});
