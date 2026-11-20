/** Pure daily availability aggregation. No database access or mutations. */
export const MATRIX_DIMENSIONS = ['businessGroup', 'category', 'brand', 'format'] as const;
export type MatrixDimension = (typeof MATRIX_DIMENSIONS)[number];
export const MATRIX_LABELS: Record<MatrixDimension, string> = {
  businessGroup: 'Business Unit', category: 'Category', brand: 'Brand', format: 'Format',
};
export type MatrixStatus = 'available' | 'unavailable' | 'unknown';
export type DailyObservation = {
  date: string; account: string; sku: string; branch: string; status: MatrixStatus; observedAt: string;
  businessGroup: string; category: string; brand: string; format: string;
  subCategory: string; basepack: string; product: string;
};
export type MatrixCounts = { available: number; unavailable: number; unknown: number };
export type DailyMatrixRow = {
  label: string; counts: Record<string, MatrixCounts>; mtd: MatrixCounts;
  observed_days: number;
};
export type DailyMatrix = { dimension: MatrixDimension; rows: DailyMatrixRow[]; total: DailyMatrixRow };

export const cleanLabel = (value: unknown) => String(value ?? '').trim() || 'Unclassified';
export const normalizeKey = (value: unknown) => String(value ?? '').trim().toLocaleLowerCase('en');
export function emptyCounts(): MatrixCounts { return { available: 0, unavailable: 0, unknown: 0 }; }
export function addStatus(counts: MatrixCounts, status: MatrixStatus) { counts[status] += 1; }
export function accumulateCounts(target: MatrixCounts, source: MatrixCounts) {
  target.available += source.available; target.unavailable += source.unavailable; target.unknown += source.unknown;
}
export function olaPercent(counts: MatrixCounts): number | null {
  const known = counts.available + counts.unavailable;
  return known ? Math.round((counts.available / known) * 10000) / 100 : null;
}

/** One and only one SKU/account/branch contribution per date (latest observation wins). */
export function buildDailyMatrices(input: DailyObservation[], dates: string[]): Record<MatrixDimension, DailyMatrix> {
  const latest = new Map<string, DailyObservation>();
  for (const observation of input) {
    const key = [observation.date, normalizeKey(observation.account), normalizeKey(observation.sku), normalizeKey(observation.branch)].join('\u001f');
    const old = latest.get(key);
    if (!old || observation.observedAt >= old.observedAt) latest.set(key, observation);
  }
  const days = new Set(dates);
  const output = {} as Record<MatrixDimension, DailyMatrix>;
  for (const dimension of MATRIX_DIMENSIONS) {
    const grouped = new Map<string, DailyMatrixRow>();
    const totalCounts: Record<string, MatrixCounts> = {};
    const grand = emptyCounts();
    for (const observation of latest.values()) {
      if (!days.has(observation.date)) continue;
      const label = cleanLabel(observation[dimension]);
      let group = grouped.get(label);
      if (!group) { group = {label, counts: {}, mtd: emptyCounts(), observed_days: 0}; grouped.set(label, group); }
      group.counts[observation.date] ??= emptyCounts();
      totalCounts[observation.date] ??= emptyCounts();
      addStatus(group.counts[observation.date], observation.status);
      addStatus(group.mtd, observation.status);
      addStatus(totalCounts[observation.date], observation.status);
      addStatus(grand, observation.status);
    }
    const rows = [...grouped.values()].map(group => ({
      ...group,
      observed_days: Object.values(group.counts).filter(c => c.available + c.unavailable > 0).length,
    })).sort((a, b) => a.label.localeCompare(b.label));
    output[dimension] = {
      dimension,
      rows,
      total: {label: 'TOTAL', counts: totalCounts, mtd: grand, observed_days: Object.values(totalCounts).filter(c => c.available + c.unavailable > 0).length},
    };
  }
  return output;
}
