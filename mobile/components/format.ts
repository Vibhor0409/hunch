// Formatting helpers for copy that carries numbers. Pure functions, no data.

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "closes in 4m", "closes in 40s", "closes 3:05 PM", "closes Tue 3 PM". */
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
  return `closes ${DAYS[target.getDay()]} ${clock}`;
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
