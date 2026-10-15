'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  BarChart3,
  Boxes,
  CalendarDays,
  Database,
  Download,
  Gauge,
  Layers3,
  PackageSearch,
  RefreshCw,
  Search,
  ShoppingCart,
  Sparkles,
  Warehouse,
} from 'lucide-react';
import { exportCsv } from '@/lib/csv-export';

type SearchResult = {
  type: 'basepack' | 'sku';
  id: string;
  label: string;
  secondary: string;
  brand?: string;
  code?: string;
  accountCode?: string;
  basepackId?: string | null;
};

type Row = {
  accountCode: string;
  accountName: string;
  mapped: boolean;
  mappedSkus: number;
  accountSkus: string[];
  productNames: string[];
  stockQty: number | null;
  stockValue: number | null;
  stockDate: string | null;
  salesQty: number | null;
  salesValue: number | null;
  salesPeriodStart: string | null;
  salesPeriodEnd: string | null;
  salesBasis: string;
  salesComparable: boolean;
  valuationComplete: boolean;
  note: string | null;
};

type Report = {
  mode: 'basepack' | 'sku';
  monthStart: string;
  asOf: string;
  basepack: null | { id: string; packsize: string; productNames: string[]; ublCodes: string[]; brands: string[] };
  sku: null | { accountCode: string; accountSku: string; productNames: string[]; ublCodes: string[]; basepackId: string | null; packsize: string | null };
  rows: Row[];
  totals: {
    stockQty: number;
    stockValue: number;
    salesQty: number;
    salesValue: number;
    mappedAccounts: number;
    reportingAccounts: number;
    comparableSalesAccounts: number;
  };
};

const accountOptions = [
  ['daraz', 'Daraz'],
  ['pandamart', 'Pandamart'],
  ['shajgoj', 'Shajgoj'],
  ['foodi', 'Foodi'],
  ['othoba', 'Othoba'],
] as const;

const ACCOUNT_COLORS: Record<string, string> = {
  daraz: '#f97316',
  pandamart: '#e11d48',
  shajgoj: '#7c3aed',
  foodi: '#16a34a',
  othoba: '#2563eb',
};

const n = (v: number | null | undefined, digits = 0) => v == null ? '—' : Number(v).toLocaleString(undefined, { maximumFractionDigits: digits });
const money = (v: number | null | undefined) => v == null ? '—' : `৳${Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const d = (v: string | null | undefined) => !v ? '—' : new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(`${v}T00:00:00`));
const monthLabel = (v: string) => new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' }).format(new Date(`${v}-01T00:00:00`));

function localToday() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function monthEnd(month: string) {
  const [year, mon] = month.split('-').map(Number);
  const value = new Date(year, mon, 0);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

function daysBetween(a: string, b: string) {
  const first = new Date(`${a}T00:00:00`).getTime();
  const second = new Date(`${b}T00:00:00`).getTime();
  return Math.max(0, Math.round((second - first) / 86400000));
}

function pct(part: number, total: number) {
  return total > 0 ? (part / total) * 100 : 0;
}

function accountColor(code: string) {
  return ACCOUNT_COLORS[code] || '#64748b';
}

export default function DashboardReport() {
  const today = useMemo(() => localToday(), []);
  const [mode, setMode] = useState<'basepack' | 'sku'>('basepack');
  const [month, setMonth] = useState(today.slice(0, 7));
  const [asOf, setAsOf] = useState(today);
  const [account, setAccount] = useState('daraz');
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [selected, setSelected] = useState<SearchResult | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [searching, setSearching] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [focusAccount, setFocusAccount] = useState<string>('all');

  useEffect(() => {
    setSelected(null);
    setReport(null);
    setSearchResults([]);
    setQuery('');
    setFocusAccount('all');
  }, [mode, account]);

  useEffect(() => {
    const currentMonth = today.slice(0, 7);
    setAsOf(month === currentMonth ? today : monthEnd(month));
  }, [month, today]);

  async function search() {
    if (query.trim().length < 2) return;
    setSearching(true);
    setError('');
    try {
      const params = new URLSearchParams({ mode, q: query.trim() });
      if (mode === 'sku') params.set('account', account);
      const res = await fetch(`/api/dashboard-report/search?${params.toString()}`, { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Search failed.');
      setSearchResults(json.results || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Search failed.');
    } finally {
      setSearching(false);
    }
  }

  async function loadReport(target = selected) {
    if (!target) return;
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ month, asOf });
      if (mode === 'basepack') params.set('basepackId', target.id);
      else {
        params.set('account', account);
        params.set('sku', target.id);
      }
      const res = await fetch(`/api/dashboard-report?${params.toString()}`, { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to build report.');
      setReport(json);
      setFocusAccount('all');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to build report.');
    } finally {
      setLoading(false);
    }
  }

  function choose(result: SearchResult) {
    setSelected(result);
    setQuery(result.label);
    setSearchResults([]);
    void loadReport(result);
  }

  function exportRows() {
    if (!report) return;
    exportCsv(`dashboard-report-${report.mode}-${report.monthStart.slice(0, 7)}`, report.rows.map((r) => ({
      Account: r.accountName,
      Marketplace_SKUs: r.accountSkus.join(' | '),
      Stock_Qty: r.stockQty ?? '',
      Stock_Value_TP: r.stockValue ?? '',
      Stock_As_Of: r.stockDate ?? '',
      Sales_Qty: r.salesQty ?? '',
      Sales_Value_TP: r.salesValue ?? '',
      Sales_Period_Start: r.salesPeriodStart ?? '',
      Sales_Period_End: r.salesPeriodEnd ?? '',
      Sales_Basis: r.salesBasis,
      Comparable_Monthly_Sales: r.salesComparable ? 'Yes' : 'No',
      Note: r.note ?? '',
    })));
  }

  const maxStock = Math.max(1, ...(report?.rows.map((r) => r.stockValue ?? 0) ?? [1]));
  const maxSales = Math.max(1, ...(report?.rows.filter((r) => r.salesComparable).map((r) => r.salesValue ?? 0) ?? [1]));
  const title = report?.basepack?.productNames?.[0] || report?.sku?.productNames?.[0] || selected?.label || 'Select a product';
  const secondary = report?.basepack?.packsize || report?.sku?.accountSku || '';
  const reportRows = report?.rows ?? [];
  const mappedRows = reportRows.filter((row) => row.mapped);
  const stockRows = [...mappedRows].filter((row) => (row.stockValue ?? 0) > 0).sort((a, b) => (b.stockValue ?? 0) - (a.stockValue ?? 0));
  const salesRows = [...mappedRows].filter((row) => row.salesComparable && (row.salesValue ?? 0) > 0).sort((a, b) => (b.salesValue ?? 0) - (a.salesValue ?? 0));
  const topStockRow = stockRows[0] || null;
  const topSalesRow = salesRows[0] || null;
  const staleRows = report ? mappedRows.filter((row) => row.stockDate && daysBetween(row.stockDate, report.asOf) > 2) : [];
  const freshestStockDate = mappedRows.map((row) => row.stockDate).filter((value): value is string => Boolean(value)).sort().at(-1) || null;
  const filteredTableRows = focusAccount === 'all' ? reportRows : reportRows.filter((row) => row.accountCode === focusAccount);

  return <div className="page dashboard-report-page dashboard-report-presentation">
    <div className="page-head dashboard-report-head dashboard-presentation-head">
      <div>
        <span className="eyebrow">Dashboard Report</span>
        <h1>Stock & Sales Command Center</h1>
        <p>A presentation-first view of where inventory sits, where sales are coming from, and how fresh each account feed is.</p>
      </div>
      <div className="dashboard-head-actions">
        {report && <div className="dashboard-head-period"><CalendarDays size={15}/><span>{monthLabel(report.monthStart.slice(0, 7))}</span><strong>Through {d(report.asOf)}</strong></div>}
        {report && <button className="button secondary" onClick={exportRows}><Download size={16}/>Export CSV</button>}
      </div>
    </div>

    <section className="card dashboard-command-bar">
      <div className="dashboard-command-topline">
        <div className="segment-tabs dashboard-mode-tabs">
          <button className={mode === 'basepack' ? 'active' : ''} onClick={() => setMode('basepack')}><Layers3 size={15}/>Basepack across accounts</button>
          <button className={mode === 'sku' ? 'active' : ''} onClick={() => setMode('sku')}><PackageSearch size={15}/>Account SKU lookup</button>
        </div>
        <div className="dashboard-command-hint"><Sparkles size={14}/><span>Search once, then use the visuals to tell the account story.</span></div>
      </div>
      <div className="dashboard-search-grid dashboard-search-grid-heavy">
        {mode === 'sku' && <label><span>Account</span><select value={account} onChange={(e) => setAccount(e.target.value)}>{accountOptions.map(([code, label]) => <option key={code} value={code}>{label}</option>)}</select></label>}
        <label className="dashboard-product-search"><span>{mode === 'basepack' ? 'Basepack / product / UBL code' : 'Marketplace SKU / product'}</span><div className="search-box"><Search size={16}/><input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void search(); }} placeholder={mode === 'basepack' ? 'e.g. Lux Body Wash Freesia...' : 'Enter SKU number or product name'} /></div></label>
        <button className="button" onClick={() => void search()} disabled={searching || query.trim().length < 2}><Search size={16}/>{searching ? 'Searching…' : 'Search'}</button>
        <label><span>Month</span><input type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></label>
        <label><span>As of</span><input type="date" value={asOf} min={`${month}-01`} max={monthEnd(month)} onChange={(e) => setAsOf(e.target.value)} /></label>
        {selected && <button className="button secondary" onClick={() => void loadReport()} disabled={loading}><RefreshCw size={15}/>{loading ? 'Refreshing…' : 'Apply period'}</button>}
      </div>
      {searchResults.length > 0 && <div className="dashboard-search-results">
        {searchResults.map((result) => <button key={`${result.type}-${result.id}`} onClick={() => choose(result)}>
          <div><strong>{result.label}</strong><span>{result.secondary}</span></div>
          <div><small>{result.brand || '—'}</small><small>{result.code || ''}</small></div>
        </button>)}
      </div>}
      {error && <div className="alert error dashboard-report-alert">{error}</div>}
    </section>

    {!report && !loading && <section className="dashboard-empty-stage">
      <div className="dashboard-empty-visual"><BarChart3 size={36}/><div className="dashboard-empty-bars"><i/><i/><i/><i/><i/></div></div>
      <div><span className="eyebrow">Start with one product</span><h2>Turn a basepack into an account story</h2><p>Search a product above. The dashboard will convert the raw account feeds into an executive view of stock, sales, account contribution and data freshness.</p></div>
    </section>}
    {loading && !report && <section className="card"><div className="empty">Building stock and sales story…</div></section>}

    {report && <>
      <section className="dashboard-hero-story">
        <div className="dashboard-hero-product">
          <span className="dashboard-story-kicker">{report.mode === 'basepack' ? 'Selected basepack' : 'Selected marketplace SKU'}</span>
          <h2>{title}</h2>
          <p>{secondary || 'Cross-account commercial view'}</p>
          <div className="dashboard-hero-tags">
            {report.basepack?.brands?.slice(0, 3).map((brand) => <span key={brand}>{brand}</span>)}
            {report.basepack?.ublCodes?.slice(0, 2).map((code) => <span key={code} className="mono">UBL {code}</span>)}
            {report.sku?.accountSku && <span className="mono">SKU {report.sku.accountSku}</span>}
          </div>
        </div>
        <div className="dashboard-hero-narrative">
          <div><Warehouse size={18}/><span>Stock value</span><strong>{money(report.totals.stockValue)}</strong><small>{n(report.totals.stockQty)} current units</small></div>
          <div><ShoppingCart size={18}/><span>MTD sales value</span><strong>{money(report.totals.salesValue)}</strong><small>{n(report.totals.salesQty)} comparable units</small></div>
          <div><Database size={18}/><span>Reporting coverage</span><strong>{report.totals.mappedAccounts}/{report.totals.reportingAccounts}</strong><small>{freshestStockDate ? `Freshest stock ${d(freshestStockDate)}` : 'No stock date'}</small></div>
        </div>
      </section>

      <section className="dashboard-report-kpis dashboard-report-kpis-heavy">
        <div className="kpi dashboard-kpi-card stock"><div className="dashboard-kpi-icon"><Warehouse size={18}/></div><span>Total stock value</span><strong>{money(report.totals.stockValue)}</strong><small>{n(report.totals.stockQty)} units currently held</small></div>
        <div className="kpi dashboard-kpi-card sales"><div className="dashboard-kpi-icon"><ShoppingCart size={18}/></div><span>Month sales value</span><strong>{money(report.totals.salesValue)}</strong><small>{n(report.totals.salesQty)} units on comparable feeds</small></div>
        <div className="kpi dashboard-kpi-card"><div className="dashboard-kpi-icon"><Layers3 size={18}/></div><span>Mapped accounts</span><strong>{report.totals.mappedAccounts}/{report.totals.reportingAccounts}</strong><small>Current V2 marketplace mappings</small></div>
        <div className="kpi dashboard-kpi-card"><div className="dashboard-kpi-icon"><Gauge size={18}/></div><span>Comparable sales feeds</span><strong>{report.totals.comparableSalesAccounts}</strong><small>Feeds safe for the calendar-month total</small></div>
        <div className="kpi dashboard-kpi-card"><div className="dashboard-kpi-icon"><CalendarDays size={18}/></div><span>Freshest stock snapshot</span><strong className="date-kpi">{d(freshestStockDate)}</strong><small>Latest stock observation within the selected period</small></div>
        <div className={`kpi dashboard-kpi-card ${staleRows.length ? 'warning' : 'healthy'}`}><div className="dashboard-kpi-icon"><AlertTriangle size={18}/></div><span>Feeds needing attention</span><strong>{staleRows.length}</strong><small>{staleRows.length ? 'Stock snapshot is more than 2 days behind the selected as-of date' : 'All mapped stock feeds are within 2 days'}</small></div>
      </section>

      <section className="dashboard-insight-strip">
        <div className="dashboard-insight-title"><Sparkles size={17}/><div><span>Executive readout</span><strong>What stands out right now</strong></div></div>
        <div className="dashboard-insight-items">
          <div><span>Largest stock position</span><strong>{topStockRow ? topStockRow.accountName : '—'}</strong><small>{topStockRow ? `${money(topStockRow.stockValue)} · ${pct(topStockRow.stockValue || 0, report.totals.stockValue).toFixed(1)}% of stock value` : 'No stock value available'}</small></div>
          <div><span>Largest sales contribution</span><strong>{topSalesRow ? topSalesRow.accountName : '—'}</strong><small>{topSalesRow ? `${money(topSalesRow.salesValue)} · ${pct(topSalesRow.salesValue || 0, report.totals.salesValue).toFixed(1)}% of comparable sales` : 'No comparable monthly sales'}</small></div>
          <div><span>Data freshness</span><strong>{staleRows.length ? `${staleRows.length} account${staleRows.length === 1 ? '' : 's'} lagging` : 'Feeds look fresh'}</strong><small>{staleRows.length ? staleRows.map((row) => row.accountName).join(', ') : `Measured through ${d(report.asOf)}`}</small></div>
        </div>
      </section>

      <section className="dashboard-visual-grid">
        <article className="card dashboard-chart-card">
          <div className="card-head dashboard-chart-head"><div><span className="dashboard-chart-kicker">Inventory concentration</span><h2>Stock value by account</h2><p>Where the selected product's inventory value is currently sitting.</p></div><Boxes size={20}/></div>
          <div className="dashboard-bar-chart">
            {stockRows.length ? stockRows.map((row) => <button type="button" key={row.accountCode} className={focusAccount === row.accountCode ? 'active' : ''} onClick={() => setFocusAccount(focusAccount === row.accountCode ? 'all' : row.accountCode)}>
              <div className="dashboard-bar-label"><span className="dashboard-account-dot" style={{ background: accountColor(row.accountCode) }}/><strong>{row.accountName}</strong><small>{n(row.stockQty)} units</small></div>
              <div className="dashboard-bar-track"><span style={{ width: `${Math.max(3, ((row.stockValue || 0) / maxStock) * 100)}%`, background: accountColor(row.accountCode) }}/></div>
              <div className="dashboard-bar-value"><strong>{money(row.stockValue)}</strong><small>{pct(row.stockValue || 0, report.totals.stockValue).toFixed(1)}%</small></div>
            </button>) : <div className="dashboard-chart-empty">No stock value available for the selected product.</div>}
          </div>
        </article>

        <article className="card dashboard-chart-card">
          <div className="card-head dashboard-chart-head"><div><span className="dashboard-chart-kicker">Commercial contribution</span><h2>Month sales value by account</h2><p>Comparable calendar-month sales only; rolling feeds remain visible in the detail layer.</p></div><ArrowUpRight size={20}/></div>
          <div className="dashboard-bar-chart sales-chart">
            {salesRows.length ? salesRows.map((row) => <button type="button" key={row.accountCode} className={focusAccount === row.accountCode ? 'active' : ''} onClick={() => setFocusAccount(focusAccount === row.accountCode ? 'all' : row.accountCode)}>
              <div className="dashboard-bar-label"><span className="dashboard-account-dot" style={{ background: accountColor(row.accountCode) }}/><strong>{row.accountName}</strong><small>{n(row.salesQty)} units</small></div>
              <div className="dashboard-bar-track"><span style={{ width: `${Math.max(3, ((row.salesValue || 0) / maxSales) * 100)}%`, background: accountColor(row.accountCode) }}/></div>
              <div className="dashboard-bar-value"><strong>{money(row.salesValue)}</strong><small>{pct(row.salesValue || 0, report.totals.salesValue).toFixed(1)}%</small></div>
            </button>) : <div className="dashboard-chart-empty">No comparable calendar-month sales value is available.</div>}
          </div>
        </article>
      </section>

      <section className="card dashboard-contribution-card">
        <div className="card-head dashboard-chart-head"><div><span className="dashboard-chart-kicker">Share of total</span><h2>Account contribution mix</h2><p>A slide-like view of how the product's stock and sales are distributed across marketplaces.</p></div></div>
        <div className="dashboard-contribution-grid">
          <div className="dashboard-contribution-row">
            <div><Warehouse size={17}/><span>Stock value mix</span><strong>{money(report.totals.stockValue)}</strong></div>
            <div className="dashboard-stacked-bar">{stockRows.map((row) => <button key={row.accountCode} type="button" title={`${row.accountName}: ${money(row.stockValue)}`} style={{ width: `${pct(row.stockValue || 0, report.totals.stockValue)}%`, background: accountColor(row.accountCode) }} onClick={() => setFocusAccount(row.accountCode)} />)}</div>
          </div>
          <div className="dashboard-contribution-row">
            <div><ShoppingCart size={17}/><span>Sales value mix</span><strong>{money(report.totals.salesValue)}</strong></div>
            <div className="dashboard-stacked-bar">{salesRows.map((row) => <button key={row.accountCode} type="button" title={`${row.accountName}: ${money(row.salesValue)}`} style={{ width: `${pct(row.salesValue || 0, report.totals.salesValue)}%`, background: accountColor(row.accountCode) }} onClick={() => setFocusAccount(row.accountCode)} />)}</div>
          </div>
          <div className="dashboard-contribution-legend">
            {mappedRows.map((row) => <button type="button" key={row.accountCode} onClick={() => setFocusAccount(focusAccount === row.accountCode ? 'all' : row.accountCode)} className={focusAccount === row.accountCode ? 'active' : ''}><span style={{ background: accountColor(row.accountCode) }}/>{row.accountName}</button>)}
          </div>
        </div>
      </section>

      <section className="card dashboard-account-story-card">
        <div className="card-head dashboard-chart-head"><div><span className="dashboard-chart-kicker">Account cards</span><h2>Marketplace snapshot</h2><p>Use these as presentation tiles: inventory, sales, freshness and source basis in one glance.</p></div>{focusAccount !== 'all' && <button className="button secondary compact" onClick={() => setFocusAccount('all')}>Show all accounts</button>}</div>
        <div className="dashboard-account-story-grid">
          {mappedRows.map((row) => {
            const staleDays = row.stockDate ? daysBetween(row.stockDate, report.asOf) : null;
            const ratio = row.salesQty && row.salesQty > 0 && row.stockQty != null ? row.stockQty / row.salesQty : null;
            return <button type="button" key={row.accountCode} className={`dashboard-account-story ${focusAccount === row.accountCode ? 'active' : ''}`} onClick={() => setFocusAccount(focusAccount === row.accountCode ? 'all' : row.accountCode)}>
              <div className="dashboard-account-story-top"><div><span className="dashboard-account-dot large" style={{ background: accountColor(row.accountCode) }}/><strong>{row.accountName}</strong></div><span className={`dashboard-freshness-badge ${staleDays != null && staleDays > 2 ? 'stale' : 'fresh'}`}>{row.stockDate ? `${staleDays}d old` : 'No stock date'}</span></div>
              <div className="dashboard-account-story-values"><div><span>Stock</span><strong>{money(row.stockValue)}</strong><small>{n(row.stockQty)} units</small></div><div><span>Sales</span><strong>{money(row.salesValue)}</strong><small>{n(row.salesQty)} units</small></div></div>
              <div className="dashboard-account-story-foot"><span>{row.salesComparable ? 'Calendar-month feed' : 'Non-comparable feed'}</span><strong>{ratio == null ? '—' : `${ratio.toFixed(1)}×`}<small> stock / MTD sales</small></strong></div>
            </button>;
          })}
          {!mappedRows.length && <div className="dashboard-chart-empty">No mapped accounts for this product.</div>}
        </div>
      </section>

      <section className="card dashboard-freshness-card">
        <div className="card-head dashboard-chart-head"><div><span className="dashboard-chart-kicker">Trust the timestamp</span><h2>Data freshness</h2><p>The report never pretends every marketplace is updated on the same day.</p></div></div>
        <div className="dashboard-freshness-list">
          {mappedRows.map((row) => {
            const stockLag = row.stockDate ? daysBetween(row.stockDate, report.asOf) : null;
            return <div key={row.accountCode}>
              <div className="dashboard-freshness-account"><span className="dashboard-account-dot" style={{ background: accountColor(row.accountCode) }}/><strong>{row.accountName}</strong></div>
              <div className="dashboard-freshness-date"><strong>{d(row.stockDate)}</strong><small>stock snapshot</small></div>
              <div className="dashboard-freshness-meter"><span className={stockLag != null && stockLag > 2 ? 'stale' : ''} style={{ width: `${stockLag == null ? 0 : Math.max(8, 100 - Math.min(stockLag, 7) * 13)}%` }}/></div>
              <div className="dashboard-freshness-status">{stockLag == null ? <span className="dashboard-badge warning">No stock feed</span> : stockLag <= 2 ? <span className="dashboard-badge ok">Fresh · {stockLag}d</span> : <span className="dashboard-badge warning">Lagging · {stockLag}d</span>}</div>
            </div>;
          })}
        </div>
      </section>

      <section className="card dashboard-detail-table-card">
        <div className="card-head"><div><span className="dashboard-chart-kicker">Analyst detail</span><h2>Account-wise stock & sales</h2><p>Use the visuals for the story; use this table for exact numbers, SKU IDs and source periods.</p></div>{focusAccount !== 'all' && <div className="dashboard-table-focus">Filtered to <strong>{reportRows.find((row) => row.accountCode === focusAccount)?.accountName || focusAccount}</strong><button onClick={() => setFocusAccount('all')}>Clear</button></div>}</div>
        <div className="table-wrap"><table className="dashboard-account-table"><thead><tr><th>Account</th><th>Marketplace SKU</th><th>Stock qty</th><th>Stock value</th><th>Stock as of</th><th>Sales qty</th><th>Sales value</th><th>Sales through</th><th>Basis</th></tr></thead><tbody>
          {filteredTableRows.map((row) => <tr key={row.accountCode} className={!row.mapped ? 'dashboard-unmapped-row' : ''}>
            <td><div className="dashboard-table-account"><span className="dashboard-account-dot" style={{ background: accountColor(row.accountCode) }}/><div><strong>{row.accountName}</strong><small>{row.mapped ? `${row.mappedSkus} mapped SKU${row.mappedSkus === 1 ? '' : 's'}` : 'Not mapped'}</small></div></div></td>
            <td>{row.accountSkus.length ? row.accountSkus.map((sku) => <span className="dashboard-sku-chip" key={sku}>{sku}</span>) : <span className="muted">—</span>}</td>
            <td><strong>{n(row.stockQty)}</strong></td>
            <td><strong>{money(row.stockValue)}</strong>{row.stockValue != null && <div className="dashboard-value-bar"><span style={{ width: `${Math.max(2, ((row.stockValue || 0) / maxStock) * 100)}%` }}/></div>}</td>
            <td>{d(row.stockDate)}</td>
            <td><strong>{n(row.salesQty)}</strong></td>
            <td><strong>{money(row.salesValue)}</strong>{row.salesValue != null && <div className={`dashboard-value-bar sales ${!row.salesComparable ? 'rolling' : ''}`}><span style={{ width: `${Math.max(2, ((row.salesValue || 0) / maxSales) * 100)}%` }}/></div>}{!row.salesComparable && row.salesValue != null && <span className="dashboard-badge warning">Rolling 30D</span>}</td>
            <td>{row.salesPeriodEnd ? <>{d(row.salesPeriodEnd)}<small>{row.salesPeriodStart ? `${d(row.salesPeriodStart)} → ${d(row.salesPeriodEnd)}` : ''}</small></> : '—'}</td>
            <td><span className={`dashboard-badge ${row.salesComparable ? 'ok' : 'warning'}`}>{row.salesComparable ? 'Calendar month' : 'Not comparable'}</span><small>{row.salesBasis}</small>{row.note && <small className="dashboard-note">{row.note}</small>}</td>
          </tr>)}
        </tbody></table></div>
      </section>

      <section className="card dashboard-definition-card dashboard-definition-card-heavy">
        <div className="card-head"><div><span className="dashboard-chart-kicker">Methodology</span><h2>How the commercial story is calculated</h2><p>Everything shown above uses a consistent valuation basis so account totals can be compared without mixing marketplace-specific definitions.</p></div></div>
        <div className="dashboard-definition-grid">
          <div><Warehouse size={18}/><strong>Stock value</strong><p>Latest stock quantity in the selected month × UBL TP from the master.</p></div>
          <div><ShoppingCart size={18}/><strong>Sales value</strong><p>Month-to-date sold quantity × UBL TP. Daraz uses GIS; Pandamart sums daily sold quantity; Shajgoj and Othoba use their latest cumulative monthly sales.</p></div>
          <div><AlertTriangle size={18}/><strong>Foodi exception</strong><p>Foodi currently supplies rolling 30-day sales. It remains visible with its actual period but is excluded from calendar-month totals unless the source period aligns to the selected month.</p></div>
        </div>
      </section>
    </>}
  </div>;
}
