'use client';

import { useEffect, useMemo, useState } from 'react';
import { BarChart3, Download, Search } from 'lucide-react';
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

  useEffect(() => {
    setSelected(null);
    setReport(null);
    setSearchResults([]);
    setQuery('');
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

  return <div className="page dashboard-report-page">
    <div className="page-head dashboard-report-head">
      <div>
        <span className="eyebrow">Dashboard Report</span>
        <h1>Stock & Sales Value</h1>
        <p>Search a basepack across accounts or drill into a marketplace SKU. Stock and sales values are normalized at TP for a consistent cross-account view.</p>
      </div>
      {report && <button className="button secondary" onClick={exportRows}><Download size={16}/>Export CSV</button>}
    </div>

    <div className="segment-tabs dashboard-mode-tabs">
      <button className={mode === 'basepack' ? 'active' : ''} onClick={() => setMode('basepack')}>Basepack across accounts</button>
      <button className={mode === 'sku' ? 'active' : ''} onClick={() => setMode('sku')}>Account SKU lookup</button>
    </div>

    <section className="card dashboard-search-card">
      <div className="dashboard-search-grid">
        {mode === 'sku' && <label><span>Account</span><select value={account} onChange={(e) => setAccount(e.target.value)}>{accountOptions.map(([code, label]) => <option key={code} value={code}>{label}</option>)}</select></label>}
        <label className="dashboard-product-search"><span>{mode === 'basepack' ? 'Basepack / product / UBL code' : 'Marketplace SKU / product'}</span><div className="search-box"><Search size={16}/><input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void search(); }} placeholder={mode === 'basepack' ? 'e.g. Lux Body Wash Freesia...' : 'Enter SKU number or product name'} /></div></label>
        <button className="button" onClick={() => void search()} disabled={searching || query.trim().length < 2}><Search size={16}/>{searching ? 'Searching…' : 'Search'}</button>
        <label><span>Month</span><input type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></label>
        <label><span>As of</span><input type="date" value={asOf} min={`${month}-01`} max={monthEnd(month)} onChange={(e) => setAsOf(e.target.value)} /></label>
        {selected && <button className="button secondary" onClick={() => void loadReport()} disabled={loading}>{loading ? 'Refreshing…' : 'Apply period'}</button>}
      </div>
      {searchResults.length > 0 && <div className="dashboard-search-results">
        {searchResults.map((result) => <button key={`${result.type}-${result.id}`} onClick={() => choose(result)}>
          <div><strong>{result.label}</strong><span>{result.secondary}</span></div>
          <div><small>{result.brand || '—'}</small><small>{result.code || ''}</small></div>
        </button>)}
      </div>}
      {error && <div className="alert error dashboard-report-alert">{error}</div>}
    </section>

    {!report && !loading && <section className="card"><div className="empty"><BarChart3 size={30}/><strong>Choose a product to build the dashboard report</strong><span>Use the basepack view for account-wise totals, or the SKU view for a single marketplace SKU.</span></div></section>}
    {loading && !report && <section className="card"><div className="empty">Building stock and sales report…</div></section>}

    {report && <>
      <section className="card dashboard-product-summary">
        <div>
          <span className="eyebrow">{report.mode === 'basepack' ? 'Selected basepack' : 'Selected marketplace SKU'}</span>
          <h2>{title}</h2>
          <p>{secondary}</p>
        </div>
        <div className="dashboard-period-summary">
          <span>{monthLabel(report.monthStart.slice(0, 7))}</span>
          <strong>Data through {d(report.asOf)}</strong>
        </div>
      </section>

      <section className="dashboard-report-kpis">
        <div className="kpi hero"><span>Total stock value</span><strong>{money(report.totals.stockValue)}</strong><small>{n(report.totals.stockQty)} units across mapped reporting accounts</small></div>
        <div className="kpi"><span>Month sales value</span><strong>{money(report.totals.salesValue)}</strong><small>{n(report.totals.salesQty)} units on comparable calendar-month feeds</small></div>
        <div className="kpi"><span>Mapped accounts</span><strong>{report.totals.mappedAccounts}/{report.totals.reportingAccounts}</strong><small>Marketplace IDs found in the current V2 master</small></div>
        <div className="kpi"><span>Comparable sales feeds</span><strong>{report.totals.comparableSalesAccounts}</strong><small>Foodi rolling-30D is excluded unless its source period matches the selected month</small></div>
      </section>

      <section className="card">
        <div className="card-head"><div><h2>Account-wise stock & sales</h2><p>Current stock is the latest uploaded snapshot in the selected month. Sales value = sold quantity × TP.</p></div></div>
        <div className="table-wrap"><table className="dashboard-account-table"><thead><tr><th>Account</th><th>Marketplace SKU</th><th>Stock qty</th><th>Stock value</th><th>Stock as of</th><th>Sales qty</th><th>Sales value</th><th>Sales through</th><th>Basis</th></tr></thead><tbody>
          {report.rows.map((row) => <tr key={row.accountCode} className={!row.mapped ? 'dashboard-unmapped-row' : ''}>
            <td><strong>{row.accountName}</strong><small>{row.mapped ? `${row.mappedSkus} mapped SKU${row.mappedSkus === 1 ? '' : 's'}` : 'Not mapped'}</small></td>
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

      <section className="card dashboard-definition-card">
        <div className="card-head"><div><h2>How this dashboard calculates value</h2><p>One consistent valuation basis is used so accounts can be added together without mixing marketplace currencies or account-specific valuation fields.</p></div></div>
        <div className="dashboard-definition-grid">
          <div><strong>Stock value</strong><p>Latest stock quantity in the selected month × UBL TP from the master.</p></div>
          <div><strong>Sales value</strong><p>Month-to-date sold quantity × UBL TP. Daraz uses GIS from the latest DOD snapshot; Pandamart sums daily sold quantity; Shajgoj and Othoba use their latest cumulative monthly sales.</p></div>
          <div><strong>Foodi</strong><p>Foodi currently supplies rolling 30-day sales. It is displayed with its actual period, but excluded from calendar-month totals unless the period starts on the first day of the selected month.</p></div>
        </div>
      </section>
    </>}
  </div>;
}
