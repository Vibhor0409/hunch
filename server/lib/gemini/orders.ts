// Order placement on the Gemini sandbox. One limit buy, immediate-or-cancel,
// never retried. API failures come back as a receipt, never as a throw.
import type { OrderReceipt, Side } from "../types";
import { getGemini, getSdk } from "./client";

/** Orders get a longer deadline than reads; the SDK never retries POSTs. */
const ORDER_TIMEOUT_MS = 15_000;

type Sdk = Awaited<ReturnType<typeof getSdk>>;
type OrderResponse = Awaited<ReturnType<Awaited<ReturnType<typeof getGemini>>["predictions"]["placeOrder"]>>;

/** Floors to the 0.01 quantity grid seen on every sampled contract (quantityIncrement "0.01"). */
function toGrid(value: number): number {
  return Math.floor(value * 100 + 1e-9) / 100;
}

function parseNumber(value: string | null | undefined): number | null {
  if (typeof value !== "string" || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Places one limit buy of `quantity` contracts of `side` at `price`
 * (immediate-or-cancel, makerOrCancel false). Price and quantity go out as
 * 2-decimal strings, the grid of every sampled contract (priceIncrement and
 * quantityIncrement "0.01"). The receipt's `price` is the limit price sent.
 * `contracts` is the filled quantity when the response carries one, else the
 * requested quantity when the status is "filled", else 0.
 * Failures: AcceptTermsRequired -> "not_placed" ("Terms not accepted");
 * everything else -> "error" with a short message. Never throws for API errors.
 */
export async function placeBuy(args: { symbol: string; side: Side; price: number; quantity: number }): Promise<OrderReceipt> {
  const { symbol, side } = args;
  const price = Number(args.price.toFixed(2));
  const quantity = toGrid(args.quantity);
  const failed = (status: OrderReceipt["status"], message: string): OrderReceipt => ({
    orderId: null,
    status,
    symbol,
    price,
    contracts: 0,
    message,
  });
  if (!(price > 0 && price < 1)) return failed("error", "Price out of range");
  if (!(quantity >= 0.01)) return failed("error", "Quantity below 0.01");

  let sdk: Sdk;
  let client: Awaited<ReturnType<typeof getGemini>>;
  try {
    sdk = await getSdk();
    client = await getGemini();
  } catch {
    return failed("error", "Gemini client unavailable");
  }

  let response: OrderResponse;
  try {
    response = await client.predictions.placeOrder(
      {
        symbol,
        orderType: "limit",
        side: "buy",
        quantity: quantity.toFixed(2),
        price: price.toFixed(2),
        outcome: side,
        timeInForce: "immediate-or-cancel",
        makerOrCancel: false,
      },
      { timeoutMs: ORDER_TIMEOUT_MS },
    );
  } catch (error) {
    const mapped = describeFailure(sdk, error);
    return failed(mapped.status, mapped.message);
  }

  const orderId = response.orderId === undefined || response.orderId === null ? null : String(response.orderId);
  const filled = parseNumber(response.filledQuantity);
  const status = response.status;
  if (status !== "filled" && status !== "open" && status !== "cancelled") {
    return { orderId, status: "error", symbol, price, contracts: filled ?? 0, message: "Unexpected order status" };
  }
  const contracts = filled ?? (status === "filled" ? quantity : 0);
  return { orderId, status, symbol, price, contracts };
}

/** Maps an SDK error to a receipt status and a short, user-safe message. */
function describeFailure(sdk: Sdk, error: unknown): { status: OrderReceipt["status"]; message: string } {
  if (error instanceof sdk.AcceptTermsRequired) return { status: "not_placed", message: "Terms not accepted" };
  if (error instanceof sdk.ValidationError) return { status: "error", message: `Invalid order field: ${error.field}` };
  if (error instanceof sdk.InsufficientFunds) return { status: "error", message: "Insufficient funds" };
  if (error instanceof sdk.RequestTimeoutError || error instanceof sdk.RequestAbortedError) {
    return { status: "error", message: "Gemini timed out" };
  }
  if (error instanceof sdk.ApiError) {
    const reason = error.reason && /^[A-Za-z0-9_]{1,40}$/.test(error.reason) ? error.reason : error.name;
    return { status: "error", message: `Order rejected: ${reason}` };
  }
  return { status: "error", message: "Order failed" };
}
