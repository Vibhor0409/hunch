// Every Gemini call in Hunch goes through this module.
export {
  findActiveEvent,
  findRecentlySettledEvent,
  getEventOrNull,
  getGemini,
  getPublicGemini,
  getSdk,
  listActiveEventsOnce,
  PAGE_LIMIT,
  REQUEST_TIMEOUT_MS,
  type GeminiClient,
  type GeminiContract,
  type GeminiEnv,
  type GeminiEvent,
} from "./client";
export { buyPricesOf, expiresAtOf, questionFor, toCardQuote, type BuyPrices } from "./cards";
export { FEED_CACHE_MS, fetchActiveCards } from "./feed";
export { getQuote } from "./quote";
export { placeBuy } from "./orders";
export { outcomeOf, resolveOutcome } from "./settlement";
