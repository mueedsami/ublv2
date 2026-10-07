'use client';

import { useEffect, useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';

type OlaRow = {
  stock_date: string;
  scope: 'overall' | 'branch';
  branch_code: string | null;
  branch_name: string;
  sort_order: number;
  expected_basepacks: number;
  available_basepacks: number;
  unavailable_basepacks: number;
  ola_pct: number | null;
};

type DailySummary = {
  stock_date: string;
  branch_count: number;
  expected_basepacks: number;
  network_available_basepacks: number;
  network_unavailable_basepacks: number;
  network_coverage_pct: number | null;
  available_branch_cells: number;
  unavailable_branch_cells: number;
  total_branch_cells: number;
  branch_ola_pct: number | null;
};

type MonthlyRow = {
  month_start: string;
  days_with_data: number;
  avg_ola_pct: number | null;
  min_ola_pct: number | null;
  max_ola_pct: number | null;
  first_stock_date: string;
  last_stock_date: string;
  avg_network_coverage_pct: number | null;
};

type FlagRow = {
  flag_type: string;
  severity: 'critical' | 'warning' | 'info';
  entity_type: 'basepack' | 'branch';
  entity_key: string;
  entity_name: string;
  stock_date: string;
  metrics: Record<string, number | string | null>;
  title: string;
  message: string;
};

type TabKey = 'overview' | 'branches' | 'flags' | 'daily' | 'monthly';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'branches', label: 'Branch OLA' },
  { key: 'flags', label: 'Flags' },
  { key: 'daily', label: 'Daily History' },
  { key: 'monthly', label: 'Monthly History' },
];

function pct(value: number | null | undefined) {
  return value === null || value === undefined ? '—' : `${Number(value).toFixed(2)}%`;
}

function monthLabel(value: string) {
  return new Intl.DateTimeFormat('en-GB', { month: 'short', year: 'numeric' }).format(new Date(`${value}T00:00:00`));
}

function dateLabel(value: string | null | undefined) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(`${value}T00:00:00`));
}

export default function PandamartPanel() {
  const [branches, setBranches] = useState<OlaRow[]>([]);
  const [daily, setDaily] = useState<DailySummary[]>([]);
  const [monthly, setMonthly] = useState<MonthlyRow[]>([]);
  const [flags, setFlags] = useState<FlagRow[]>([]);
  const [activeTab, setActiveTab] = useState<TabKey>('overview');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/pandamart', { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load Pandamart intelligence.');
      setBranches((json.latestBranches || []).filter((r: OlaRow) => r.scope === 'branch'));
      setDaily(json.daily || []);
      setMonthly(json.monthly || []);
      setFlags(json.flags || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load Pandamart intelligence.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  const latest = daily[0] ?? null;
  const currentMonth = monthly[0] ?? null;
  const recentDaily = useMemo(() => daily.slice(0, 31), [daily]);
  const critical = flags.filter((f) => f.severity === 'critical').length;
  const warning = flags.filter((f) => f.severity === 'warning').length;

  return <div className="pandamart-dashboard">
    <div className="pandamart-tabbar">
      <div className="pandamart-tabs" role="tablist" aria-label="Pandamart sections">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.key}
            className={activeTab === tab.key ? 'active' : ''}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
            {tab.key === 'flags' && flags.length > 0 && <span className="tab-count">{flags.length}</span>}
          </button>
        ))}
      </div>
      <button className="button secondary compact" onClick={() => void load()} disabled={loading}>
        <RefreshCw size={15}/>{loading ? 'Loading' : 'Refresh'}
      </button>
    </div>

    {error && <div className="alert error pandamart-alert">{error}</div>}

    {loading && !latest ? <section className="card"><div className="empty">Loading Pandamart intelligence…</div></section> : null}

    {!loading && !latest && !error ? <section className="card"><div className="empty">No Pandamart stock history yet. Upload the Pandamart workbook from Uploads to start this dashboard.</div></section> : null}

    {latest && activeTab === 'overview' && <>
      <section className="kpi-grid pandamart-kpis">
        <div className="kpi"><span>Current branch OLA</span><strong>{pct(latest.branch_ola_pct)}</strong><small>{latest.available_branch_cells.toLocaleString()} / {latest.total_branch_cells.toLocaleString()} basepack-branch cells</small></div>
        <div className="kpi"><span>Network coverage</span><strong>{pct(latest.network_coverage_pct)}</strong><small>{latest.network_available_basepacks}/{latest.expected_basepacks} basepacks available in ≥1 branch</small></div>
        <div className="kpi"><span>This month</span><strong>{pct(currentMonth?.avg_ola_pct)}</strong><small>{currentMonth ? `${currentMonth.days_with_data} daily snapshot${currentMonth.days_with_data === 1 ? '' : 's'} stored` : 'No monthly history yet'}</small></div>
        <div className="kpi"><span>Active flags</span><strong>{flags.length}</strong><small>{critical} critical · {warning} warning</small></div>
      </section>

      <section className="card">
        <div className="card-head"><div><h2>Latest snapshot</h2><p>Current operational picture from the latest stored Pandamart branch stock snapshot.</p></div></div>
        <div className="pandamart-overview-grid">
          <div><span>Stock date</span><strong>{dateLabel(latest.stock_date)}</strong></div>
          <div><span>Customer branches</span><strong>{latest.branch_count}</strong></div>
          <div><span>Expected basepacks</span><strong>{latest.expected_basepacks}</strong></div>
          <div><span>Available cells</span><strong>{latest.available_branch_cells.toLocaleString()}</strong></div>
          <div><span>Out cells</span><strong>{latest.unavailable_branch_cells.toLocaleString()}</strong></div>
          <div><span>Network unavailable</span><strong>{latest.network_unavailable_basepacks}</strong></div>
        </div>
      </section>

      <section className="card">
        <div className="card-head"><div><h2>How Pandamart is measured</h2><p>The dashboard keeps customer-facing availability separate from distribution-center inventory.</p></div></div>
        <div className="pandamart-rule-grid">
          <div><strong>Branch OLA</strong><p>Each master-listed basepack × each of the 16 customer-facing branches is one availability cell. DC never counts toward this KPI.</p></div>
          <div><strong>Network coverage</strong><p>A basepack is covered when it is available in at least one customer-facing branch. This is useful, but it is not the primary OLA.</p></div>
          <div><strong>History</strong><p>Every stock date is stored separately, so daily and monthly OLA remain available after future uploads.</p></div>
        </div>
      </section>
    </>}

    {latest && activeTab === 'branches' && <section className="card">
      <div className="card-head"><div><h2>Latest branch OLA</h2><p>{dateLabel(latest.stock_date)} · each master-listed basepack × branch is one OLA cell. DC is excluded.</p></div></div>
      {branches.length > 0 ? <div className="table-wrap"><table><thead><tr><th>Branch</th><th>Available</th><th>Out</th><th>Total</th><th>OLA</th></tr></thead><tbody>{branches.map((row) => <tr key={row.branch_code}><td><strong>{row.branch_name}</strong></td><td>{row.available_basepacks}</td><td>{row.unavailable_basepacks}</td><td>{row.expected_basepacks}</td><td><strong>{pct(row.ola_pct)}</strong></td></tr>)}</tbody></table></div> : <div className="empty">No branch snapshot available.</div>}
    </section>}

    {latest && activeTab === 'flags' && <section className="card">
      <div className="card-head"><div><h2>Operational flags</h2><p>Derived from the latest branch stock plus accumulated Pandamart daily sales history.</p></div></div>
      {flags.length > 0 ? <>
        <div className="flag-summary"><span><strong>{critical}</strong> critical</span><span><strong>{warning}</strong> warning</span><span><strong>{flags.length}</strong> total</span></div>
        <div className="table-wrap"><table><thead><tr><th>Severity</th><th>Flag</th><th>Basepack / Branch</th><th>Why</th></tr></thead><tbody>{flags.map((flag) => <tr key={`${flag.flag_type}-${flag.entity_type}-${flag.entity_key}`}><td><span className={`flag-severity ${flag.severity}`}>{flag.severity}</span></td><td><strong>{flag.title}</strong></td><td>{flag.entity_name}</td><td>{flag.message}</td></tr>)}</tbody></table></div>
        <div className="card-foot-note">Initial thresholds: stockout risk ≤7 days cover; distribution imbalance ≤3 stocked branches; sales decline ≥30% across 15-day halves once 30 days exist; store-health warning below 65% OLA. DC-stuck and zero-network-stock rules are direct.</div>
      </> : <div className="empty">No active Pandamart flags for the current snapshot.</div>}
    </section>}

    {latest && activeTab === 'daily' && <section className="card">
      <div className="card-head"><div><h2>Daily OLA history</h2><p>Corrected re-uploads replace the same stock date; new dates are appended to history.</p></div></div>
      {recentDaily.length > 0 ? <div className="table-wrap"><table><thead><tr><th>Stock date</th><th>Available cells</th><th>Out cells</th><th>Total cells</th><th>Branch OLA</th><th>Network coverage</th></tr></thead><tbody>{recentDaily.map((row) => <tr key={row.stock_date}><td><strong>{dateLabel(row.stock_date)}</strong></td><td>{row.available_branch_cells.toLocaleString()}</td><td>{row.unavailable_branch_cells.toLocaleString()}</td><td>{row.total_branch_cells.toLocaleString()}</td><td><strong>{pct(row.branch_ola_pct)}</strong></td><td>{pct(row.network_coverage_pct)}</td></tr>)}</tbody></table></div> : <div className="empty">No daily history yet.</div>}
    </section>}

    {latest && activeTab === 'monthly' && <section className="card">
      <div className="card-head"><div><h2>Monthly OLA history</h2><p>Monthly OLA is the average of the daily branch OLA snapshots stored for that month.</p></div></div>
      {monthly.length > 0 ? <div className="table-wrap"><table><thead><tr><th>Month</th><th>Days</th><th>Avg OLA</th><th>Low</th><th>High</th><th>Avg network coverage</th><th>Coverage window</th></tr></thead><tbody>{monthly.map((row) => <tr key={row.month_start}><td><strong>{monthLabel(row.month_start)}</strong></td><td>{row.days_with_data}</td><td><strong>{pct(row.avg_ola_pct)}</strong></td><td>{pct(row.min_ola_pct)}</td><td>{pct(row.max_ola_pct)}</td><td>{pct(row.avg_network_coverage_pct)}</td><td>{dateLabel(row.first_stock_date)} – {dateLabel(row.last_stock_date)}</td></tr>)}</tbody></table></div> : <div className="empty">No monthly history yet.</div>}
    </section>}
  </div>;
}
