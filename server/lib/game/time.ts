/** "Today" for daily caps means the calendar day in this zone (SPEC F5). */
export const LA_TIME_ZONE = "America/Los_Angeles";

const laClock = new Intl.DateTimeFormat("en-US", {
  timeZone: LA_TIME_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** The LA wall-clock reading at an instant. */
function wallClock(at: Date): WallClock {
  const clock: WallClock = { year: 0, month: 0, day: 0, hour: 0, minute: 0, second: 0 };
  for (const part of laClock.formatToParts(at)) {
    if (part.type === "literal") continue;
    if (part.type in clock) clock[part.type as keyof WallClock] = Number(part.value);
  }
  return clock;
}

/**
 * Milliseconds that LA wall-clock time is ahead of UTC at an instant
 * (negative, -7h in PDT and -8h in PST). The formatter has second precision,
 * so the instant is truncated to the second before comparing.
 */
function laOffsetAt(at: Date): number {
  const w = wallClock(at);
  const wallAsUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  const atSeconds = Math.floor(at.getTime() / 1000) * 1000;
  return wallAsUtc - atSeconds;
}

/**
 * The UTC instant of midnight in LA on an LA calendar date. The day may be
 * out of range (for example 32); Date.UTC rolls it into the next month.
 * Two passes: the offset in force at the UTC-midnight guess, then the offset
 * in force at the first answer. US transitions happen at 2 AM local time, so
 * midnight is never inside one and the second pass is exact.
 */
function laMidnightUtc(year: number, month: number, day: number): number {
  const guess = Date.UTC(year, month - 1, day, 0, 0, 0, 0);
  const firstPass = guess - laOffsetAt(new Date(guess));
  return guess - laOffsetAt(new Date(firstPass));
}

/**
 * Start (inclusive) and end (exclusive) of the America/Los_Angeles calendar
 * day containing `now`, as UTC ISO strings. The end is the next LA midnight,
 * so days are 24 hours except 23 on spring-forward and 25 on fall-back days.
 * Query with created_at >= startIso AND created_at < endIso.
 */
export function laDayBounds(now: Date): { startIso: string; endIso: string } {
  const today = wallClock(now);
  const start = laMidnightUtc(today.year, today.month, today.day);
  const end = laMidnightUtc(today.year, today.month, today.day + 1);
  return { startIso: new Date(start).toISOString(), endIso: new Date(end).toISOString() };
}
