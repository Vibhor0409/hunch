import { describe, expect, it } from "vitest";
import { TRADE_ID_PREFIX, tradeIdOf } from "../../app/api/_lib/trade";

/** The shape the app shows: "HN-" and 8 uppercase hex characters. */
const TRADE_ID = /^HN-[0-9A-F]{8}$/;

describe("tradeIdOf", () => {
  it('formats a swipe uuid as "HN-" plus its first 8 hex characters', () => {
    expect(tradeIdOf("3f9a21c7-5b6d-4e8f-9a0b-1c2d3e4f5a6b")).toBe("HN-3F9A21C7");
    expect(TRADE_ID_PREFIX).toBe("HN-");
  });

  it("matches the documented format for many random uuids", () => {
    for (let i = 0; i < 200; i++) {
      const id = tradeIdOf(crypto.randomUUID());
      expect(id, id).toMatch(TRADE_ID);
      expect(id).toHaveLength(11);
    }
  });

  it("uppercases the letters whatever the case of the uuid", () => {
    expect(tradeIdOf("abcdef12-0000-4000-8000-000000000000")).toBe("HN-ABCDEF12");
    expect(tradeIdOf("ABCDEF12-0000-4000-8000-000000000000")).toBe("HN-ABCDEF12");
    expect(tradeIdOf("AbCdEf12-0000-4000-8000-000000000000")).toBe("HN-ABCDEF12");
  });

  it("removes hyphens before taking the first 8 characters", () => {
    expect(tradeIdOf("3f9a-21c7-5b6d-4e8f")).toBe("HN-3F9A21C7");
    expect(tradeIdOf("3f9a21c75b6d4e8f9a0b1c2d3e4f5a6b")).toBe("HN-3F9A21C7");
  });

  it("is stable: the same swipe id always gives the same trade id", () => {
    const swipeId = crypto.randomUUID();
    const first = tradeIdOf(swipeId);
    expect(tradeIdOf(swipeId)).toBe(first);
    expect(tradeIdOf(swipeId)).toBe(first);
  });

  it("differs for swipe ids that differ in their first 8 characters", () => {
    const a = tradeIdOf("00000001-0000-4000-8000-000000000000");
    const b = tradeIdOf("00000002-0000-4000-8000-000000000000");
    expect(a).toBe("HN-00000001");
    expect(b).toBe("HN-00000002");
    expect(a).not.toBe(b);

    const ids = new Set<string>();
    for (let i = 0; i < 200; i++) ids.add(tradeIdOf(crypto.randomUUID()));
    expect(ids.size, "200 random uuids give 200 trade ids").toBe(200);
  });
});
