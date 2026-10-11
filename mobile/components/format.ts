// Formatting helpers for copy that carries numbers. Pure functions, no data.

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "closes in 4m", "closes in 40s", "closes 3:05 PM", "closes Tue 3 PM", "closes Nov 4". */
export function formatCloses(expiresAt: string, now: number = Date.now()): string {
  const target = new Date(expiresAt);
  const ms = target.getTime() - now;
  if (Number.isNaN(ms)) return "closes soon";
  if (ms <= 0) return "closing now";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return `closes in ${Math.max(1, Math.floor(ms / 1000))}s`;
  if (minutes < 60) return `closes in ${minutes}m`;
  const sameDay = new Date(now).toDateString() === target.toDateString();
  const clock = formatClock(target);
  if (sameDay || ms < 24 * 60 * 60_000) return `closes ${clock}`;
  if (ms < 7 * 24 * 60 * 60_000) return `closes ${DAYS[target.getDay()]} ${clock}`;
  return `closes ${MONTHS[target.getMonth()]} ${target.getDate()}`;
}

/** True when the market closes within the hour, so the pill can read as urgent. */
export function closesSoon(expiresAt: string, now: number = Date.now()): boolean {
  const ms = new Date(expiresAt).getTime() - now;
  return Number.isFinite(ms) && ms > 0 && ms < 60 * 60_000;
}

function formatClock(d: Date): string {
  const h24 = d.getHours();
  const m = d.getMinutes();
  const suffix = h24 >= 12 ? "PM" : "AM";
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  return m === 0 ? `${h} ${suffix}` : `${h}:${String(m).padStart(2, "0")} ${suffix}`;
}

export function formatPct(n: number): string {
  return `${Math.round(n)}%`;
}

/** "$1", "$1.35", "$2.50". Whole dollars drop the cents. */
export function formatDollars(n: number): string {
  if (!Number.isFinite(n)) return "$0";
  if (Number.isInteger(n)) return `$${n}`;
  return `$${n.toFixed(2)}`;
}

/** Wallet money, always with cents and thousands separators: "$1,000.00", "-$9.86". */
export function formatMoney(n: number): string {
  if (!Number.isFinite(n)) return "$0.00";
  const abs = Math.abs(n);
  const whole = Math.floor(abs);
  const cents = Math.round((abs - whole) * 100);
  const carry = cents === 100;
  const dollars = formatInt(carry ? whole + 1 : whole);
  const centsText = String(carry ? 0 : cents).padStart(2, "0");
  return `${n < 0 ? "-" : ""}$${dollars}.${centsText}`;
}

/** Signed wallet movement: "+$12.00", "-$9.86". Zero shows as "$0.00". */
export function formatSignedMoney(n: number): string {
  if (n > 0) return `+${formatMoney(n)}`;
  return formatMoney(n);
}

/** "2:14 PM" today, otherwise "Oct 11". */
export function formatWhen(iso: string, now: number = Date.now()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  if (new Date(now).toDateString() === d.toDateString()) return formatClock(d);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

/** Signed with one decimal: "+2.6", "-7.4", "0.0". */
export function formatEdge(n: number): string {
  const fixed = n.toFixed(1);
  if (n > 0) return `+${fixed}`;
  if (n < 0) return fixed;
  return "0.0";
}

export function formatPrice(p: number): string {
  return p.toFixed(2);
}

export function formatContracts(c: number): string {
  return Number.isInteger(c) ? String(c) : c.toFixed(2);
}

/** 1234567 -> "1,234,567". */
export function formatInt(n: number): string {
  const rounded = Math.round(n);
  return String(rounded).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** "1st", "2nd", "3rd", "4th", "11th", "22nd". */
export function formatOrdinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

/** Plural helper: count("call", 1) -> "1 call", count("call", 3) -> "3 calls". */
export function count(noun: string, n: number): string {
  return `${formatInt(n)} ${noun}${n === 1 ? "" : "s"}`;
}
