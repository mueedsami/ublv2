/** Date boundaries and latest-run selection for a TODAY-ONLY Bangladesh price report.
 * These helpers are pure: no database queries, writes, or local-timezone assumptions.
 */
export type ScrapeRun = Record<string, unknown>;

const str = (value: unknown) => String(value ?? '').trim();

export function getDhakaTodayWindow(now: Date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const part = (kind: string) => parts.find(p => p.type === kind)?.value || '';
  const reportDate = `${part('year')}-${part('month')}-${part('day')}`;
  // Bangladesh does not currently observe daylight saving time (UTC+06:00).
  // Use an explicit offset so this works on UTC Vercel hosts and local laptops.
  const start = new Date(`${reportDate}T00:00:00+06:00`);
  if (Number.isNaN(start.valueOf())) throw new Error('Unable to determine Bangladesh report date.');
  return {
    reportDate,
    startUtc: start.toISOString(),
    endUtc: new Date(start.valueOf() + 86400000).toISOString(),
  };
}

/** One complete daily snapshot per account. Prefer a successful run; otherwise
 * accept today's most recent partial run. Never use an earlier day as fallback.
 */
export function chooseTodayRuns(runs: ScrapeRun[], startUtc: string, endUtc: string): ScrapeRun[] {
  const start = Date.parse(startUtc), end = Date.parse(endUtc);
  const chosen = new Map<string, ScrapeRun>();
  for (const run of runs) {
    const account = str(run.account_code).toLowerCase();
    const status = str(run.status).toLowerCase();
    const finished = Date.parse(str(run.finished_at));
    if (!account || !str(run.id) || !['success', 'partial'].includes(status) ||
        !Number.isFinite(finished) || finished < start || finished >= end) continue;
    const prev = chosen.get(account);
    if (!prev) { chosen.set(account, run); continue; }
    const wasSuccess = str(prev.status).toLowerCase() === 'success';
    const isSuccess = status === 'success';
    if ((isSuccess && !wasSuccess) || (isSuccess === wasSuccess && finished > Date.parse(str(prev.finished_at)))) {
      chosen.set(account, run);
    }
  }
  return [...chosen.values()].sort((a, b) => str(a.account_code).localeCompare(str(b.account_code)));
}
