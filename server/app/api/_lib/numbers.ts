// Small numeric helpers for values the API reports with one decimal.

/** Rounds to one decimal and normalizes negative zero to zero. */
export function round1(value: number): number {
  const rounded = Math.round(value * 10) / 10;
  return rounded === 0 ? 0 : rounded;
}

/**
 * Total Edge over settled calls. Edges are stored with one decimal, so they
 * are summed as integer tenths and the result is exact.
 */
export function edgeTotalOf(rows: readonly { edge: number }[]): number {
  let tenths = 0;
  for (const row of rows) tenths += Math.round(row.edge * 10);
  const total = tenths / 10;
  return total === 0 ? 0 : total;
}
