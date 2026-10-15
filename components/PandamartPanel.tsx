'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Download, MapPin, RefreshCw, RotateCcw, ShieldAlert, TrendingDown } from 'lucide-react';
import { exportCsv } from '@/lib/csv-export';
import { FilterField, FlagMetricChips, HorizontalBars, MiniTrend, SearchField, SeverityStrip, olaTone } from '@/components/AccountVisuals';

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
type AvailabilityFilter = 'all' | 'has-oos' | 'fully-available';
type PandaSeverity = 'all' | FlagRow['severity'];

const TABS: { key: TabKey; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'branches', label: 'Branch OLA' },
  { key: 'flags', label: 'Flags' },
  { key: 'daily', label: 'Daily History' },
  { key: 'monthly', label: 'Monthly History' },
];

function pct(value: number | null | undefined) { return value == null ? '—' : `${Number(value).toFixed(2)}%`; }
function monthLabel(value: string) { return new Intl.DateTimeFormat('en-GB', { month: 'short', year: 'numeric' }).format(new Date(`${value}T00:00:00`)); }
function dateLabel(value: string | null | undefined) { return !value ? '—' : new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(`${value}T00:00:00`)); }
function shortDate(value: string) { return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short' }).format(new Date(`${value}T00:00:00`)); }
function labelize(value: string) { return value.replaceAll('_', ' ').replace(/\b\w/g, (m) => m.toUpperCase()); }
function flagLabel(value: string) {
  const labels: Record<string,string> = {
    dc_stuck: 'DC Stock Stuck',
    dead_stock: 'Dead Stock',
    distribution_imbalance: 'Distribution Imbalance',
    sales_decline: 'Sales Decline',
    stockout_risk: 'Stockout Risk',
  };
  return labels[value] ?? labelize(value);
}

export default function PandamartPanel() {
  const [branches, setBranches] = useState<OlaRow[]>([]);
  const [daily, setDaily] = useState<DailySummary[]>([]);
  const [monthly, setMonthly] = useState<MonthlyRow[]>([]);
  const [flags, setFlags] = useState<FlagRow[]>([]);
  const [activeTab, setActiveTab] = useState<TabKey>('overview');
  const [availabilityFilter, setAvailabilityFilter] = useState<AvailabilityFilter>('all');
  const [branchSearch, setBranchSearch] = useState('');
  const [severityFilter, setSeverityFilter] = useState<PandaSeverity>('all');
  const [flagTypeFilter, setFlagTypeFilter] = useState('all');
  const [entityFilter, setEntityFilter] = useState<'all' | FlagRow['entity_type']>('all');
  const [flagSearch, setFlagSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true); setError('');
    try {
      const res = await fetch('/api/pandamart', { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load Pandamart intelligence.');
      setBranches((json.latestBranches || []).filter((r: OlaRow) => r.scope === 'branch'));
      setDaily(json.daily || []); setMonthly(json.monthly || []); setFlags(json.flags || []);
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to load Pandamart intelligence.'); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);

  const latest = daily[0] ?? null;
  const currentMonth = monthly[0] ?? null;
  const recentDaily = useMemo(() => daily.slice(0, 14).reverse(), [daily]);
  const filteredBranches = useMemo(() => {
    const q = branchSearch.trim().toLowerCase();
    return branches.filter((r) => {
      const statusOk = availabilityFilter === 'all' || (availabilityFilter === 'has-oos' ? r.unavailable_basepacks > 0 : r.unavailable_basepacks === 0);
      const searchOk = !q || r.branch_name.toLowerCase().includes(q);
      return statusOk && searchOk;
    });
  }, [branches, availabilityFilter, branchSearch]);

  const flagTypes = useMemo(() => Array.from(new Set(flags.map((f) => f.flag_type))).sort(), [flags]);
  const visibleFlags = useMemo(() => {
    const q = flagSearch.trim().toLowerCase();
    return flags.filter((f) =>
      (severityFilter === 'all' || f.severity === severityFilter) &&
      (flagTypeFilter === 'all' || f.flag_type === flagTypeFilter) &&
      (entityFilter === 'all' || f.entity_type === entityFilter) &&
      (!q || `${f.title} ${f.entity_name} ${f.message} ${f.flag_type}`.toLowerCase().includes(q))
    );
  }, [flags, severityFilter, flagTypeFilter, entityFilter, flagSearch]);

  const critical = flags.filter((f) => f.severity === 'critical').length;
  const warning = flags.filter((f) => f.severity === 'warning').length;
  const info = flags.filter((f) => f.severity === 'info').length;
  const flaggedEntities = new Set(flags.map((f) => `${f.entity_type}:${f.entity_key}`)).size;
  const worstBranches = useMemo(() => [...branches].sort((a, b) => Number(a.ola_pct ?? 0) - Number(b.ola_pct ?? 0)).slice(0, 8), [branches]);
  const healthyBranches = branches.filter((r) => Number(r.ola_pct ?? 0) >= 80).length;
  const warningBranches = branches.filter((r) => Number(r.ola_pct ?? 0) >= 70 && Number(r.ola_pct ?? 0) < 80).length;
  const criticalBranches = branches.filter((r) => Number(r.ola_pct ?? 0) < 70).length;
  const flagTypeRows = useMemo(() => {
    const map = new Map<string, number>();
    flags.forEach((f) => map.set(f.flag_type, (map.get(f.flag_type) ?? 0) + 1));
    return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([label, value]) => ({ label: flagLabel(label), value, tone: label === 'stockout_risk' || label === 'dc_stuck' ? 'critical' as const : 'warning' as const }));
  }, [flags]);
  const priorityFlags = useMemo(() => {
    const criticalRows = flags.filter((f) => f.severity === 'critical');
    const selected: FlagRow[] = [];
    const seenTypes = new Set<string>();
    for (const flag of criticalRows) {
      if (!seenTypes.has(flag.flag_type)) { selected.push(flag); seenTypes.add(flag.flag_type); }
      if (selected.length >= 6) break;
    }
    if (selected.length < 6) {
      for (const flag of criticalRows) {
        if (selected.includes(flag)) continue;
        selected.push(flag);
        if (selected.length >= 6) break;
      }
    }
    return selected;
  }, [flags]);

  function resetFlagFilters() { setSeverityFilter('all'); setFlagTypeFilter('all'); setEntityFilter('all'); setFlagSearch(''); }
  function exportBranches() { exportCsv(`pandamart-branch-ola-${availabilityFilter}`, filteredBranches.map((r) => ({ Stock_Date: r.stock_date, Branch: r.branch_name, Available: r.available_basepacks, Unavailable: r.unavailable_basepacks, Total: r.expected_basepacks, OLA_Pct: r.ola_pct }))); }
  function exportFlags() { exportCsv('pandamart-flags', visibleFlags.map((f) => ({ Severity: f.severity, Flag: f.title, Type: f.flag_type, Entity_Type: f.entity_type, Entity: f.entity_name, Stock_Date: f.stock_date, Message: f.message, ...f.metrics }))); }

  return <div className="account-intelligence-page pandamart-dashboard">
    <section className="account-command-card">
      <div className="account-command-top">
        <div className="pandamart-tabs account-tabs-heavy" role="tablist" aria-label="Pandamart sections">
          {TABS.map((tab) => <button key={tab.key} type="button" role="tab" aria-selected={activeTab === tab.key} className={activeTab === tab.key ? 'active' : ''} onClick={() => setActiveTab(tab.key)}>
            {tab.label}{tab.key === 'flags' && flags.length > 0 ? <span className="tab-count alert-count">{flags.length}</span> : null}
          </button>)}
        </div>
        <button className="button secondary compact" onClick={() => void load()} disabled={loading}><RefreshCw size={15}/>{loading ? 'Loading' : 'Refresh'}</button>
      </div>
      <div className="account-command-note"><MapPin size={14}/><span>Customer-facing branch availability. Distribution-center stock is kept outside the primary OLA.</span></div>
    </section>

    {error ? <div className="alert error pandamart-alert">{error}</div> : null}
    {loading && !latest ? <section className="card"><div className="empty">Loading Pandamart intelligence…</div></section> : null}
    {!loading && !latest && !error ? <section className="card"><div className="empty">No Pandamart stock history yet. Upload the Pandamart workbook from Uploads to start this dashboard.</div></section> : null}

    {latest && activeTab === 'overview' ? <>
      <section className="account-hero account-hero-panda">
        <div className="account-hero-copy"><span className="account-hero-kicker">Pandamart availability command center</span><h2>{pct(latest.branch_ola_pct)} branch OLA</h2><p>{latest.available_branch_cells.toLocaleString()} of {latest.total_branch_cells.toLocaleString()} mapped basepack × branch cells are currently available across {latest.branch_count} customer-facing branches.</p><div className="account-hero-meta"><span>Stock date <strong>{dateLabel(latest.stock_date)}</strong></span><span>Network coverage <strong>{pct(latest.network_coverage_pct)}</strong></span><span>Active flags <strong>{flags.length}</strong></span></div></div>
        <div className="pandamart-health-summary"><span className="account-hero-kicker">Branch health</span><div className="pandamart-health-score"><strong>{branches.length}</strong><small>customer-facing branches</small></div><div className="pandamart-health-grid"><div className="healthy"><strong>{healthyBranches}</strong><span>Healthy ≥80%</span></div><div className="warning"><strong>{warningBranches}</strong><span>Watch 70–79%</span></div><div className="critical"><strong>{criticalBranches}</strong><span>Critical &lt;70%</span></div></div><div className="pandamart-network-note"><span>Network coverage</span><strong>{pct(latest.network_coverage_pct)}</strong></div></div>
      </section>

      <section className="account-kpi-grid">
        <div className="account-kpi"><span>Branch OLA</span><strong>{pct(latest.branch_ola_pct)}</strong><small>{latest.unavailable_branch_cells.toLocaleString()} branch cells currently OOS</small></div>
        <div className="account-kpi"><span>Network coverage</span><strong>{pct(latest.network_coverage_pct)}</strong><small>{latest.network_unavailable_basepacks} basepacks unavailable everywhere</small></div>
        <div className="account-kpi"><span>Month avg OLA</span><strong>{pct(currentMonth?.avg_ola_pct)}</strong><small>{currentMonth ? `${currentMonth.days_with_data} observed snapshot${currentMonth.days_with_data === 1 ? '' : 's'}` : 'No monthly history'}</small></div>
        <div className={`account-kpi ${critical > 0 ? 'danger' : 'positive'}`}><span>Critical flags</span><strong>{critical}</strong><small>{warning} warnings · {flaggedEntities} flagged entities</small></div>
      </section>
      <section className="account-number-strip pandamart-number-strip"><div className="positive"><span>Healthy branches</span><strong>{healthyBranches}</strong><small>OLA at or above 80%</small></div><div className="warning"><span>Watch branches</span><strong>{warningBranches}</strong><small>OLA between 70% and 79%</small></div><div className="danger"><span>Critical branches</span><strong>{criticalBranches}</strong><small>OLA below 70%</small></div><div><span>Network OOS basepacks</span><strong>{latest.network_unavailable_basepacks}</strong><small>Unavailable in every customer-facing branch</small></div></section>

      <section className="account-visual-grid">
        <div className="card account-chart-card"><div className="card-head"><div><h2>Branches needing attention</h2><p>Lowest current branch OLA, ranked first.</p></div><TrendingDown size={18}/></div><HorizontalBars rows={worstBranches.map((r) => ({ label: r.branch_name, value: Number(r.ola_pct ?? 0), note: `${r.unavailable_basepacks} OOS`, tone: olaTone(r.ola_pct) }))} onPick={(label) => { setBranchSearch(label); setAvailabilityFilter('all'); setActiveTab('branches'); }}/></div>
        <div className="card account-chart-card"><div className="card-head"><div><h2>Recent OLA pulse</h2><p>Actual uploaded stock dates only.</p></div></div><MiniTrend rows={recentDaily.map((r) => ({ label: shortDate(r.stock_date), value: r.branch_ola_pct }))}/></div>
      </section>

      {priorityFlags.length ? <section className="card account-attention-card"><div className="card-head"><div><h2>Immediate action queue</h2><p>Critical operational signals from the current snapshot.</p></div><button className="button secondary compact" onClick={() => setActiveTab('flags')}>Open all flags</button></div><div className="account-attention-grid">{priorityFlags.map((flag) => <button type="button" key={`${flag.flag_type}-${flag.entity_key}`} onClick={() => { setFlagSearch(flag.entity_name); setActiveTab('flags'); }}><span><ShieldAlert size={14}/> {flagLabel(flag.flag_type)}</span><strong>{flag.entity_name}</strong><p>{flag.message}</p></button>)}</div></section> : null}
    </> : null}

    {latest && activeTab === 'branches' ? <>
      <section className="card account-filter-card"><div className="account-filter-head"><div><span className="eyebrow">Branch workbench</span><strong>{filteredBranches.length} of {branches.length} branches shown</strong></div><button className="button secondary compact" onClick={exportBranches} disabled={!filteredBranches.length}><Download size={15}/>Export CSV</button></div><div className="account-filter-grid two-plus-search"><SearchField value={branchSearch} onChange={setBranchSearch} placeholder="Search branch"/><FilterField label="Availability"><select value={availabilityFilter} onChange={(e) => setAvailabilityFilter(e.target.value as AvailabilityFilter)}><option value="all">All branches</option><option value="has-oos">Has unavailable products</option><option value="fully-available">Fully available</option></select></FilterField><button className="account-reset-button" type="button" onClick={() => { setBranchSearch(''); setAvailabilityFilter('all'); }}><RotateCcw size={14}/>Reset</button></div></section>
      <section className="card account-table-card"><div className="card-head"><div><h2>Latest branch OLA</h2><p>{dateLabel(latest.stock_date)} · DC excluded from customer OLA.</p></div></div>{filteredBranches.length ? <div className="table-wrap"><table className="account-rich-table"><thead><tr><th>Branch</th><th>Availability visual</th><th>Available</th><th>Out</th><th>Total</th><th>OLA</th></tr></thead><tbody>{filteredBranches.map((row) => <tr key={row.branch_code ?? row.branch_name}><td><strong>{row.branch_name}</strong></td><td><div className="account-inline-meter"><span className={olaTone(row.ola_pct)} style={{ width: `${Math.max(2, Number(row.ola_pct ?? 0))}%` }}/></div></td><td>{row.available_basepacks}</td><td><strong className={row.unavailable_basepacks > 0 ? 'text-danger' : ''}>{row.unavailable_basepacks}</strong></td><td>{row.expected_basepacks}</td><td><span className={`account-score-pill ${olaTone(row.ola_pct)}`}>{pct(row.ola_pct)}</span></td></tr>)}</tbody></table></div> : <div className="empty">No branches match these filters.</div>}</section>
    </> : null}

    {latest && activeTab === 'flags' ? <>
      <section className="account-flags-hero pandamart-flags-hero"><div><span className="account-hero-kicker">Pandamart action center</span><h2>{critical} critical issues require attention</h2><p>Flags combine branch stock distribution, sales history and DC behavior. Use this page as the operational queue—not just as a table.</p></div><div className="account-flags-hero-stats"><div><span>Flagged entities</span><strong>{flaggedEntities}</strong></div><div><span>Total flags</span><strong>{flags.length}</strong></div></div></section>
      <section className="account-kpi-grid flags"><div className="account-kpi danger"><span>Critical</span><strong>{critical}</strong><small>Highest-priority availability or distribution risks</small></div><div className="account-kpi warning"><span>Warnings</span><strong>{warning}</strong><small>Issues to correct before they become critical</small></div><div className="account-kpi"><span>Info</span><strong>{info}</strong><small>Lower-priority informational signals</small></div><div className="account-kpi"><span>Flag types</span><strong>{flagTypes.length}</strong><small>Distinct operational rules firing today</small></div></section>
      <section className="account-visual-grid flags-grid"><div className="card account-chart-card"><div className="card-head"><div><h2>Severity mix</h2><p>How the active queue is distributed.</p></div><AlertTriangle size={18}/></div><SeverityStrip critical={critical} warning={warning} watch={info}/></div><div className="card account-chart-card"><div className="card-head"><div><h2>Most common flag types</h2><p>Rules contributing the most items.</p></div></div><HorizontalBars rows={flagTypeRows} suffix="" onPick={(label) => { const original = flagTypes.find((t) => labelize(t) === label); if (original) setFlagTypeFilter(original); }}/></div></section>
      {priorityFlags.length ? <section className="card account-priority-card"><div className="card-head"><div><h2>Priority queue</h2><p>Critical items surfaced before the full list.</p></div></div><div className="account-priority-grid">{priorityFlags.map((flag, index) => <button key={`${flag.entity_key}-${flag.flag_type}`} type="button" onClick={() => setFlagSearch(flag.entity_name)}><span className="priority-number">0{index + 1}</span><div><span className="flag-pill critical">critical</span><strong>{flag.entity_name}</strong><small>{flagLabel(flag.flag_type)}</small><p>{flag.message}</p></div></button>)}</div></section> : null}
      <section className="card account-filter-card flags-filter-card"><div className="account-filter-head"><div><span className="eyebrow">Flag workbench</span><strong>{visibleFlags.length} of {flags.length} flags shown</strong></div><div className="account-filter-actions"><button className="account-reset-button" type="button" onClick={resetFlagFilters}><RotateCcw size={14}/>Reset</button><button className="button secondary compact" onClick={exportFlags} disabled={!visibleFlags.length}><Download size={15}/>Export flags</button></div></div><div className="account-filter-grid flag-grid"><SearchField value={flagSearch} onChange={setFlagSearch} placeholder="Search flag, basepack or branch"/><FilterField label="Severity"><select value={severityFilter} onChange={(e) => setSeverityFilter(e.target.value as PandaSeverity)}><option value="all">All severities</option><option value="critical">Critical</option><option value="warning">Warning</option><option value="info">Info</option></select></FilterField><FilterField label="Flag type"><select value={flagTypeFilter} onChange={(e) => setFlagTypeFilter(e.target.value)}><option value="all">All flag types</option>{flagTypes.map((type) => <option key={type} value={type}>{flagLabel(type)}</option>)}</select></FilterField><FilterField label="Entity"><select value={entityFilter} onChange={(e) => setEntityFilter(e.target.value as 'all' | FlagRow['entity_type'])}><option value="all">Basepacks + branches</option><option value="basepack">Basepacks</option><option value="branch">Branches</option></select></FilterField></div></section>
      <section className="card account-table-card"><div className="card-head"><div><h2>Operational flags</h2><p>Filtered action list for {dateLabel(latest.stock_date)}.</p></div></div>{visibleFlags.length ? <div className="table-wrap"><table className="account-rich-table flags-table"><thead><tr><th>Severity</th><th>Issue</th><th>Entity</th><th>Key metrics</th><th>Why this is flagged</th></tr></thead><tbody>{visibleFlags.map((flag) => <tr key={`${flag.flag_type}-${flag.entity_type}-${flag.entity_key}`}><td><span className={`flag-pill ${flag.severity === 'info' ? 'watch' : flag.severity}`}>{flag.severity}</span></td><td><strong>{flagLabel(flag.flag_type)}</strong><small>{flag.entity_type === 'branch' ? 'Branch signal' : 'Basepack signal'}</small></td><td><strong>{flag.entity_name}</strong><small>{labelize(flag.entity_type)}</small></td><td><FlagMetricChips metrics={Object.entries(flag.metrics ?? {}).slice(0, 4).map(([label, value]) => ({ label: labelize(label), value }))}/></td><td className="flag-reason-cell">{flag.message}</td></tr>)}</tbody></table></div> : <div className="empty">No Pandamart flags match these filters.</div>}</section>
      <section className="card account-rule-card"><div className="card-head"><div><h2>How to read Pandamart flags</h2><p>Account-specific rules remain unchanged; the page now makes them easier to act on.</p></div></div><div className="pandamart-rule-grid"><div><strong>Stockout risk</strong><p>Low days of cover is escalated using current branch stock and accumulated daily sales.</p></div><div><strong>Distribution imbalance</strong><p>Products concentrated in too few branches are surfaced even when network coverage technically exists.</p></div><div><strong>DC / dead stock</strong><p>Inventory that is stuck centrally or not translating into customer-facing availability is surfaced separately.</p></div><div><strong>Sales decline</strong><p>Once enough history exists, sales pace deterioration is highlighted rather than buried in daily rows.</p></div></div></section>
    </> : null}

    {latest && activeTab === 'daily' ? <section className="card account-table-card"><div className="card-head"><div><h2>Daily OLA history</h2><p>Corrected re-uploads replace the same stock date; new dates append to history.</p></div></div>{daily.length ? <div className="table-wrap"><table className="account-rich-table"><thead><tr><th>Stock date</th><th>Available cells</th><th>Out cells</th><th>Total cells</th><th>Branch OLA</th><th>Network coverage</th></tr></thead><tbody>{daily.slice(0, 31).map((row) => <tr key={row.stock_date}><td><strong>{dateLabel(row.stock_date)}</strong></td><td>{row.available_branch_cells.toLocaleString()}</td><td>{row.unavailable_branch_cells.toLocaleString()}</td><td>{row.total_branch_cells.toLocaleString()}</td><td><span className={`account-score-pill ${olaTone(row.branch_ola_pct)}`}>{pct(row.branch_ola_pct)}</span></td><td>{pct(row.network_coverage_pct)}</td></tr>)}</tbody></table></div> : <div className="empty">No daily history yet.</div>}</section> : null}

    {latest && activeTab === 'monthly' ? <section className="card account-table-card"><div className="card-head"><div><h2>Monthly OLA history</h2><p>Monthly OLA averages the daily branch snapshots actually stored for that month.</p></div></div>{monthly.length ? <div className="table-wrap"><table className="account-rich-table"><thead><tr><th>Month</th><th>Observed days</th><th>Average OLA</th><th>Low</th><th>High</th><th>Avg network coverage</th><th>Window</th></tr></thead><tbody>{monthly.map((row) => <tr key={row.month_start}><td><strong>{monthLabel(row.month_start)}</strong></td><td>{row.days_with_data}</td><td><span className={`account-score-pill ${olaTone(row.avg_ola_pct)}`}>{pct(row.avg_ola_pct)}</span></td><td>{pct(row.min_ola_pct)}</td><td>{pct(row.max_ola_pct)}</td><td>{pct(row.avg_network_coverage_pct)}</td><td>{dateLabel(row.first_stock_date)} – {dateLabel(row.last_stock_date)}</td></tr>)}</tbody></table></div> : <div className="empty">No monthly history yet.</div>}</section> : null}
  </div>;
}
