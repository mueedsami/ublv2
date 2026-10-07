'use client';

import { useEffect, useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';

type BasepackRow = {
  stock_date: string;
  packsize: string;
  brands: string[] | null;
  categories: string[] | null;
  stock_qty: number;
  is_available: boolean;
  sold_qty_30d: number;
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

type SalesRow = {
  stock_date: string;
  period_start: string;
  period_end: string;
  sku_rows: number;
  selling_skus: number;
  sold_qty: number;
};

type TabKey = 'overview' | 'stock' | 'sales' | 'daily' | 'monthly';
const TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'overview', label: 'Overview' },
  { key: 'stock', label: 'Current Stock' },
  { key: 'sales', label: '30-Day Sales' },
  { key: 'daily', label: 'Daily OLA' },
  { key: 'monthly', label: 'Monthly OLA' },
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

export default function FoodiPanel() {
  const [current, setCurrent] = useState<BasepackRow[]>([]);
  const [daily, setDaily] = useState<DailyRow[]>([]);
  const [monthly, setMonthly] = useState<MonthlyRow[]>([]);
  const [sales30d, setSales30d] = useState<SalesRow[]>([]);
  const [activeTab, setActiveTab] = useState<TabKey>('overview');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true); setError('');
    try {
      const res = await fetch('/api/foodi', { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load Foodi intelligence.');
      setCurrent(json.current || []);
      setDaily(json.daily || []);
      setMonthly(json.monthly || []);
      setSales30d(json.sales30d || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load Foodi intelligence.');
    } finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, []);

  const latest = daily[0] ?? null;
  const currentMonth = monthly[0] ?? null;
  const latestSales = sales30d[0] ?? null;
  const topSelling = useMemo(() => [...current].sort((a, b) => Number(b.sold_qty_30d) - Number(a.sold_qty_30d)).slice(0, 10), [current]);

  return <div className="pandamart-dashboard">
    <div className="pandamart-tabbar">
      <div className="pandamart-tabs" role="tablist" aria-label="Foodi sections">
        {TABS.map((tab) => <button key={tab.key} type="button" role="tab" aria-selected={activeTab===tab.key} className={activeTab===tab.key?'active':''} onClick={()=>setActiveTab(tab.key)}>{tab.label}</button>)}
      </div>
      <button className="button secondary compact" onClick={()=>void load()} disabled={loading}><RefreshCw size={15}/>{loading?'Loading':'Refresh'}</button>
    </div>

    {error && <div className="alert error pandamart-alert">{error}</div>}
    {loading && !latest ? <section className="card"><div className="empty">Loading Foodi intelligence…</div></section> : null}
    {!loading && !latest && !error ? <section className="card"><div className="empty">No Foodi history yet. Upload a Foodi workbook and choose the stock date to start this dashboard.</div></section> : null}

    {latest && activeTab==='overview' && <>
      <section className="kpi-grid pandamart-kpis">
        <div className="kpi"><span>Current OLA</span><strong>{pct(latest.ola_pct)}</strong><small>{latest.available_basepacks}/{latest.expected_basepacks} basepacks available</small></div>
        <div className="kpi"><span>Current stock date</span><strong className="date-kpi">{dateLabel(latest.stock_date)}</strong><small>{number(latest.total_stock)} stock units across mapped Foodi IDs</small></div>
        <div className="kpi"><span>Rolling 30-day sales</span><strong>{number(latestSales?.sold_qty)}</strong><small>{latestSales ? `${dateLabel(latestSales.period_start)} → ${dateLabel(latestSales.period_end)}` : 'No sales snapshot'}</small></div>
        <div className="kpi"><span>Current month avg OLA</span><strong>{pct(currentMonth?.avg_ola_pct)}</strong><small>{currentMonth ? `${currentMonth.days_with_data} observed day${currentMonth.days_with_data===1?'':'s'}` : 'No month history'}</small></div>
      </section>
      <section className="card">
        <div className="card-head"><div><h2>Foodi data rule</h2><p>The Foodi workbook is treated as a sparse observation, not a continuous calendar feed.</p></div></div>
        <div className="pandamart-rule-grid">
          <div><strong>Stock X</strong><p>Total Stock is stored against the stock date you select. Missing dates are not filled forward.</p></div>
          <div><strong>Sales through X−1</strong><p>30 Day Sale Qty is stored as a rolling 30-day window ending one day before the stock date.</p></div>
          <div><strong>Master scope</strong><p>Only active Foodi mappings in the UBL master count toward expected basepacks and OLA.</p></div>
        </div>
      </section>
      {topSelling.length>0 && <section className="card">
        <div className="card-head"><div><h2>Top basepacks by 30-day sales</h2><p>Latest Foodi snapshot, rolled up from mapped Foodi SKUs to UBL basepacks.</p></div></div>
        <div className="table-wrap"><table><thead><tr><th>Basepack</th><th>Brand</th><th>Stock</th><th>30-day sold</th><th>Status</th></tr></thead><tbody>{topSelling.map((row)=><tr key={row.packsize}><td><strong>{row.packsize}</strong></td><td>{join(row.brands)}</td><td>{number(row.stock_qty)}</td><td><strong>{number(row.sold_qty_30d)}</strong></td><td><span className={`status ${row.is_available?'available':'oos'}`}>{row.is_available?'Available':'Out'}</span></td></tr>)}</tbody></table></div>
      </section>}
    </>}

    {latest && activeTab==='stock' && <section className="card">
      <div className="card-head"><div><h2>Current basepack stock</h2><p>{dateLabel(latest.stock_date)} · basepack availability is derived from active master Foodi SKU IDs.</p></div></div>
      <div className="table-wrap"><table><thead><tr><th>Basepack</th><th>Brand</th><th>Category</th><th>Stock</th><th>30-day sold</th><th>Status</th></tr></thead><tbody>{current.map((row)=><tr key={row.packsize}><td><strong>{row.packsize}</strong></td><td>{join(row.brands)}</td><td>{join(row.categories)}</td><td>{number(row.stock_qty)}</td><td>{number(row.sold_qty_30d)}</td><td><span className={`status ${row.is_available?'available':'oos'}`}>{row.is_available?'Available':'Out'}</span></td></tr>)}</tbody></table></div>
    </section>}

    {latest && activeTab==='sales' && <section className="card">
      <div className="card-head"><div><h2>Rolling 30-day sales snapshots</h2><p>Every uploaded stock date keeps its own rolling 30-day sales window. These are overlapping snapshots, not additive daily sales.</p></div></div>
      {sales30d.length ? <div className="table-wrap"><table><thead><tr><th>Stock date</th><th>Sales window</th><th>SKU rows</th><th>Selling SKUs</th><th>Sold qty</th></tr></thead><tbody>{sales30d.map((row)=><tr key={row.stock_date}><td><strong>{dateLabel(row.stock_date)}</strong></td><td>{dateLabel(row.period_start)} → {dateLabel(row.period_end)}</td><td>{row.sku_rows}</td><td>{row.selling_skus}</td><td><strong>{number(row.sold_qty)}</strong></td></tr>)}</tbody></table></div> : <div className="empty">No Foodi sales history yet.</div>}
    </section>}

    {latest && activeTab==='daily' && <section className="card">
      <div className="card-head"><div><h2>Daily OLA observations</h2><p>Only actual uploaded Foodi stock dates appear here.</p></div></div>
      {daily.length ? <div className="table-wrap"><table><thead><tr><th>Stock date</th><th>Available</th><th>Out</th><th>Expected</th><th>OLA</th><th>Total stock</th></tr></thead><tbody>{daily.map((row)=><tr key={row.stock_date}><td><strong>{dateLabel(row.stock_date)}</strong></td><td>{row.available_basepacks}</td><td>{row.unavailable_basepacks}</td><td>{row.expected_basepacks}</td><td><strong>{pct(row.ola_pct)}</strong></td><td>{number(row.total_stock)}</td></tr>)}</tbody></table></div> : <div className="empty">No daily OLA history yet.</div>}
    </section>}

    {latest && activeTab==='monthly' && <section className="card">
      <div className="card-head"><div><h2>Monthly OLA history</h2><p>Average OLA uses only observed Foodi dates, with the observation count shown explicitly.</p></div></div>
      {monthly.length ? <div className="table-wrap"><table><thead><tr><th>Month</th><th>Observed days</th><th>Average OLA</th><th>Low</th><th>High</th><th>Observation window</th></tr></thead><tbody>{monthly.map((row)=><tr key={row.month_start}><td><strong>{monthLabel(row.month_start)}</strong></td><td>{row.days_with_data}</td><td><strong>{pct(row.avg_ola_pct)}</strong></td><td>{pct(row.min_ola_pct)}</td><td>{pct(row.max_ola_pct)}</td><td>{dateLabel(row.first_stock_date)} – {dateLabel(row.last_stock_date)}</td></tr>)}</tbody></table></div> : <div className="empty">No monthly OLA history yet.</div>}
    </section>}
  </div>;
}
