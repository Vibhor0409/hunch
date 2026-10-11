// Per-session memory for the deck. Skips stay on the device and vanish on relaunch.

const skipped = new Set<string>();
const swiped = new Set<string>();

export function markSkipped(instrumentSymbol: string): void {
  skipped.add(instrumentSymbol);
}

export function markSwiped(instrumentSymbol: string): void {
  swiped.add(instrumentSymbol);
}

/** True when the deck should hide this card for the rest of the session. */
export function isHidden(instrumentSymbol: string): boolean {
  return skipped.has(instrumentSymbol) || swiped.has(instrumentSymbol);
}
