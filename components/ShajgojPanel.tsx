'use client';

import { useEffect, useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';

type BasepackRow = {
  stock_date: string;
  packsize: string;
  brands: string[] | null;
  categories: string[] | null;
  sub_categories: string[] | null;
  business_groups: string[] | null;
  stock_qty: number;
  is_available: boolean;
};

type DailyRow = {
  stock_date: string;
  expected_basepacks: number;
  available_basepacks: number;
  unavailable_basepacks: number;
  ola_pct: number | null;
  total_stock: number;
};

type MonthlyRow = {
  month_start: string;
  days_with_data: number;
  avg_ola_pct: number | null;
  min_ola_pct: number | null;
  max_ola_pct: number | null;
  first_stock_date: string;
  last_stock_date: string;
};

type SalesSnapshot = {
  period_start: string;
  period_end: string;
  is_complete_month: boolean;
  sku_rows: number;
  selling_skus: number;
  sold_qty: number;
  sales_value: number;
};

type FlagRow = {
  stock_date: string; previous_stock_date: string | null; packsize: string; brands: string[] | null; business_groups: string[] | null; categories: string[] | null; sub_categories: string[] | null; stock_qty: number; previous_stock_qty: number | null; sold_qty: number; sales_value: number; period_start: string | null; period_end: string | null; days_of_cover: number | null; flag_type: string; severity: 'critical' | 'warning' | 'watch' | 'positive'; reason: string; priority: number;
};

type FlagSummary = { stock_date: string; total_flags: number; critical_flags: number; warning_flags: number; watch_flags: number; positive_flags: number; flagged_basepacks: number; };

type TabKey = 'overview' | 'stock' | 'sales' | 'daily' | 'monthly' | 'flags';
const TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'overview', label: 'Overview' },
  { key: 'stock', label: 'Current Stock' },
  { key: 'sales', label: 'Sales History' },
  { key: 'daily', label: 'Daily OLA' },
  { key: 'monthly', label: 'Monthly OLA' },
  { key: 'flags', label: 'Flags' },
];

function pct(value: number | null | undefined) {
  return value === null || value === undefined ? '—' : `${Number(value).toFixed(2)}%`;
}
function number(value: number | null | undefined) {
  return value === null || value === undefined ? '—' : Number(value).toLocaleString();
}
function dateLabel(value: string | null | undefined) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(`${value}T00:00:00`));
}
function monthLabel(value: string) {
  return new Intl.DateTimeFormat('en-GB', { month: 'short', year: 'numeric' }).format(new Date(`${value}T00:00:00`));
}
function join(values: string[] | null) {
  return values?.length ? values.join(' · ') : '—';
}

export default function ShajgojPanel() {
  const [current, setCurrent] = useState<BasepackRow[]>([]);
  const [daily, setDaily] = useState<DailyRow[]>([]);
  const [monthly, setMonthly] = useState<MonthlyRow[]>([]);
  const [salesSnapshots, setSalesSnapshots] = useState<SalesSnapshot[]>([]);
  const [monthlySales, setMonthlySales] = useState<SalesSnapshot[]>([]);
  const [flags, setFlags] = useState<FlagRow[]>([]);
  const [flagSummary, setFlagSummary] = useState<FlagSummary | null>(null);
  const [severityFilter, setSeverityFilter] = useState<'all' | FlagRow['severity']>('all');
  const [activeTab, setActiveTab] = useState<TabKey>('overview');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true); setError('');
    try {
      const res = await fetch('/api/shajgoj', { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load Shajgoj intelligence.');
      setCurrent(json.current || []);
      setDaily(json.daily || []);
      setMonthly(json.monthly || []);
      setSalesSnapshots(json.salesSnapshots || []);
      setMonthlySales(json.monthlySales || []);
      setFlags(json.flags || []);
      setFlagSummary(json.flagSummary || null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load Shajgoj intelligence.');
    } finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, []);

  const latest = daily[0] ?? null;
  const currentMonth = monthly[0] ?? null;
  const latestSales = salesSnapshots[0] ?? null;
  const availableStock = useMemo(() => current.filter((row) => row.is_available).length, [current]);
  const visibleFlags = useMemo(() => severityFilter==='all' ? flags : flags.filter((row)=>row.severity===severityFilter), [flags, severityFilter]);

  return <div className="pandamart-dashboard">
    <div className="pandamart-tabbar">
      <div className="pandamart-tabs" role="tablist" aria-label="Shajgoj sections">
        {TABS.map((tab) => <button key={tab.key} type="button" role="tab" aria-selected={activeTab===tab.key} className={activeTab===tab.key?'active':''} onClick={()=>setActiveTab(tab.key)}>{tab.label}</button>)}
      </div>
      <button className="button secondary compact" onClick={()=>void load()} disabled={loading}><RefreshCw size={15}/>{loading?'Loading':'Refresh'}</button>
    </div>

    {error && <div className="alert error pandamart-alert">{error}</div>}
    {loading && !latest ? <section className="card"><div className="empty">Loading Shajgoj intelligence…</div></section> : null}
    {!loading && !latest && !error ? <section className="card"><div className="empty">No Shajgoj stock history yet. Upload a Shajgoj workbook and choose the stock date to start this dashboard.</div></section> : null}

    {latest && activeTab==='overview' && <>
      <section className="kpi-grid pandamart-kpis">
        <div className="kpi"><span>Current OLA</span><strong>{pct(latest.ola_pct)}</strong><small>{latest.available_basepacks}/{latest.expected_basepacks} basepacks available</small></div>
        <div className="kpi"><span>Current stock date</span><strong className="date-kpi">{dateLabel(latest.stock_date)}</strong><small>{number(latest.total_stock)} stock units across mapped basepacks</small></div>
        <div className="kpi"><span>Latest cumulative sold qty</span><strong>{number(latestSales?.sold_qty)}</strong><small>{latestSales ? `${dateLabel(latestSales.period_start)} → ${dateLabel(latestSales.period_end)}` : 'No sales snapshot yet'}</small></div>
        <div className="kpi"><span>This month OLA</span><strong>{pct(currentMonth?.avg_ola_pct)}</strong><small>{currentMonth ? `${currentMonth.days_with_data} observed stock date${currentMonth.days_with_data===1?'':'s'}` : 'No monthly history yet'}</small></div>
      </section>

      <section className="card">
        <div className="card-head"><div><h2>Latest snapshot</h2><p>Only actual uploaded stock dates are stored. Missing calendar dates are intentionally left blank.</p></div></div>
        <div className="pandamart-overview-grid">
          <div><span>Expected basepacks</span><strong>{latest.expected_basepacks}</strong></div>
          <div><span>Available basepacks</span><strong>{availableStock}</strong></div>
          <div><span>Out basepacks</span><strong>{latest.unavailable_basepacks}</strong></div>
          <div><span>Latest sales period end</span><strong>{dateLabel(latestSales?.period_end)}</strong></div>
          <div><span>Selling SKUs</span><strong>{latestSales?.selling_skus ?? '—'}</strong></div>
          <div><span>Sales value</span><strong>{number(latestSales?.sales_value)}</strong></div>
        </div>
      </section>

      <section className="card">
        <div className="card-head"><div><h2>How Shajgoj is measured</h2><p>The stock snapshot and cumulative sales period are intentionally treated differently.</p></div></div>
        <div className="pandamart-rule-grid">
          <div><strong>Stock</strong><p>The selected date is the actual date represented by Total Stock QTY. No missing date is filled forward.</p></div>
          <div><strong>Sales</strong><p>For stock date X, the changing month column is stored as cumulative sold quantity from day 1 through X−1.</p></div>
          <div><strong>Monthly OLA</strong><p>The monthly figure is the average of only the stock dates actually uploaded, and the number of observed days is always shown.</p></div>
        </div>
      </section>
    </>}

    {latest && activeTab==='stock' && <section className="card">
      <div className="card-head"><div><h2>Current basepack stock</h2><p>{dateLabel(latest.stock_date)} · basepack availability is derived from the master Shajgoj SKU IDs.</p></div></div>
      <div className="table-wrap"><table><thead><tr><th>Basepack</th><th>Brand</th><th>Category</th><th>Stock</th><th>Status</th></tr></thead><tbody>{current.map((row)=><tr key={row.packsize}><td><strong>{row.packsize}</strong></td><td>{join(row.brands)}</td><td>{join(row.categories)}</td><td>{number(row.stock_qty)}</td><td><span className={`status ${row.is_available?'available':'oos'}`}>{row.is_available?'Available':'Out'}</span></td></tr>)}</tbody></table></div>
    </section>}

    {latest && activeTab==='sales' && <>
      <section className="card">
        <div className="card-head"><div><h2>Cumulative sales snapshots</h2><p>Each row is a month-to-date state. Skipped upload days do not lose sales because the next file contains the larger cumulative period.</p></div></div>
        {salesSnapshots.length ? <div className="table-wrap"><table><thead><tr><th>Period</th><th>Type</th><th>SKU rows</th><th>Selling SKUs</th><th>Sold qty</th><th>Sales value</th></tr></thead><tbody>{salesSnapshots.map((row)=><tr key={`${row.period_start}-${row.period_end}`}><td><strong>{dateLabel(row.period_start)} → {dateLabel(row.period_end)}</strong></td><td>{row.is_complete_month?'Complete month':'MTD snapshot'}</td><td>{row.sku_rows}</td><td>{row.selling_skus}</td><td>{number(row.sold_qty)}</td><td>{number(row.sales_value)}</td></tr>)}</tbody></table></div> : <div className="empty">No sales history yet.</div>}
      </section>
      <section className="card">
        <div className="card-head"><div><h2>Month-by-month sales</h2><p>For each month, the latest cumulative snapshot is used. Completed month sheets are marked separately.</p></div></div>
        {monthlySales.length ? <div className="table-wrap"><table><thead><tr><th>Month</th><th>Through</th><th>Status</th><th>Sold qty</th><th>Sales value</th></tr></thead><tbody>{monthlySales.map((row:any)=><tr key={row.month_start}><td><strong>{monthLabel(row.month_start)}</strong></td><td>{dateLabel(row.period_end)}</td><td>{row.is_complete_month?'Complete':'Partial'}</td><td>{number(row.sold_qty)}</td><td>{number(row.sales_value)}</td></tr>)}</tbody></table></div> : <div className="empty">No monthly sales history yet.</div>}
      </section>
    </>}

    {latest && activeTab==='daily' && <section className="card">
      <div className="card-head"><div><h2>Daily OLA observations</h2><p>Only actual uploaded stock dates appear here; gaps are preserved rather than estimated.</p></div></div>
      {daily.length ? <div className="table-wrap"><table><thead><tr><th>Stock date</th><th>Available</th><th>Out</th><th>Expected</th><th>OLA</th><th>Total stock</th></tr></thead><tbody>{daily.map((row)=><tr key={row.stock_date}><td><strong>{dateLabel(row.stock_date)}</strong></td><td>{row.available_basepacks}</td><td>{row.unavailable_basepacks}</td><td>{row.expected_basepacks}</td><td><strong>{pct(row.ola_pct)}</strong></td><td>{number(row.total_stock)}</td></tr>)}</tbody></table></div> : <div className="empty">No daily OLA history yet.</div>}
    </section>}

    {latest && activeTab==='monthly' && <section className="card">
      <div className="card-head"><div><h2>Monthly OLA history</h2><p>Average OLA is based only on observed stock dates, with observation count shown so sparse months are transparent.</p></div></div>
      {monthly.length ? <div className="table-wrap"><table><thead><tr><th>Month</th><th>Observed days</th><th>Average OLA</th><th>Low</th><th>High</th><th>Observation window</th></tr></thead><tbody>{monthly.map((row)=><tr key={row.month_start}><td><strong>{monthLabel(row.month_start)}</strong></td><td>{row.days_with_data}</td><td><strong>{pct(row.avg_ola_pct)}</strong></td><td>{pct(row.min_ola_pct)}</td><td>{pct(row.max_ola_pct)}</td><td>{dateLabel(row.first_stock_date)} – {dateLabel(row.last_stock_date)}</td></tr>)}</tbody></table></div> : <div className="empty">No monthly OLA history yet.</div>}
    </section>}

    {latest && activeTab==='flags' && <>
      <section className="kpi-grid pandamart-kpis">
        <div className="kpi"><span>Flagged basepacks</span><strong>{flagSummary?.flagged_basepacks ?? 0}</strong><small>{flagSummary?.total_flags ?? 0} total active flags</small></div>
        <div className="kpi"><span>Critical</span><strong>{flagSummary?.critical_flags ?? 0}</strong><small>Repeated OOS, high-sales OOS or ≤7 days cover</small></div>
        <div className="kpi"><span>Warnings</span><strong>{flagSummary?.warning_flags ?? 0}</strong><small>Demand-linked OOS, 8–14 days cover or missing upload rows</small></div>
        <div className="kpi"><span>Recovered</span><strong>{flagSummary?.positive_flags ?? 0}</strong><small>Back in stock versus the previous observed date</small></div>
      </section>

      <section className="card">
        <div className="card-head"><div><h2>Shajgoj flags</h2><p>Account-specific flags using the latest stock observation, latest cumulative sales period and previous observed stock date where available.</p></div>
          <select value={severityFilter} onChange={(e)=>setSeverityFilter(e.target.value as any)}>
            <option value="all">All severities</option><option value="critical">Critical</option><option value="warning">Warning</option><option value="watch">Watch</option><option value="positive">Positive</option>
          </select>
        </div>
        {visibleFlags.length ? <div className="table-wrap"><table><thead><tr><th>Severity</th><th>Flag</th><th>Basepack</th><th>Brand</th><th>Stock</th><th>Sold qty</th><th>Days cover</th><th>Reason</th></tr></thead><tbody>{visibleFlags.map((row,idx)=><tr key={`${row.packsize}-${row.flag_type}-${idx}`}><td><span className={`flag-pill ${row.severity}`}>{row.severity}</span></td><td><strong>{row.flag_type.replaceAll('_',' ')}</strong></td><td>{row.packsize}</td><td>{join(row.brands)}</td><td>{number(row.stock_qty)}</td><td>{number(row.sold_qty)}</td><td>{row.days_of_cover===null?'—':Number(row.days_of_cover).toFixed(1)}</td><td>{row.reason}</td></tr>)}</tbody></table></div> : <div className="empty">No Shajgoj flags match this severity.</div>}
      </section>

      <section className="card">
        <div className="card-head"><div><h2>Flag rules</h2><p>These rules are specific to Shajgoj; missing dates are never filled or inferred.</p></div></div>
        <div className="pandamart-rule-grid">
          <div><strong>Demand-linked OOS</strong><p>OOS is escalated when the latest cumulative sales period shows demand; 25+ sold units is treated as high-sales OOS.</p></div>
          <div><strong>Days of cover</strong><p>Stock ÷ average daily sales for the latest sales period. ≤7 days is critical; 8–14 days is warning.</p></div>
          <div><strong>History flags</strong><p>Repeated OOS and recovery compare only the latest and previous actual uploaded stock observations.</p></div>
        </div>
      </section>
    </>}

  </div>;
}
