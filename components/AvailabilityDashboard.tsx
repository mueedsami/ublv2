'use client';

import { useEffect, useMemo, useState } from 'react';
import { RefreshCw, RotateCcw, Search } from 'lucide-react';

type Summary = {
  account_code: string;
  account_name: string;
  snapshot_date: string | null;
  expected_basepacks: number;
  available_basepacks: number;
  unavailable_basepacks: number | null;
  availability_pct: number | null;
  total_stock: number | null;
  metric_type?: 'basepack' | 'branch_ola';
  network_coverage_pct?: number | null;
};

type AvailabilityRow = {
  basepack_id: string;
  packsize: string;
  sku_count: number;
  brands: string[] | null;
  business_groups: string[] | null;
  categories: string[] | null;
  sub_categories: string[] | null;
  product_types: string[] | null;
  retail_types: string[] | null;
  variants: string[] | null;
  account_code: string;
  account_name: string;
  account_skus: string;
  snapshot_date: string | null;
  stock_qty: number | null;
  is_available: boolean | null;
};

type FilterKey = 'businessGroup' | 'category' | 'subCategory' | 'brand' | 'productType' | 'retailType' | 'variant' | 'basepack';

type Filters = Record<FilterKey, string>;

const EMPTY_FILTERS: Filters = {
  businessGroup: 'all', category: 'all', subCategory: 'all', brand: 'all',
  productType: 'all', retailType: 'all', variant: 'all', basepack: 'all',
};

function fmtDate(value: string | null) {
  if (!value) return 'No upload';
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(`${value}T00:00:00`));
}

function values(row: AvailabilityRow, key: FilterKey): string[] {
  if (key === 'businessGroup') return row.business_groups ?? [];
  if (key === 'category') return row.categories ?? [];
  if (key === 'subCategory') return row.sub_categories ?? [];
  if (key === 'brand') return row.brands ?? [];
  if (key === 'productType') return row.product_types ?? [];
  if (key === 'retailType') return row.retail_types ?? [];
  if (key === 'variant') return row.variants ?? [];
  return [row.packsize];
}

function join(values: string[] | null, fallback = '—') {
  return values?.length ? values.join(' · ') : fallback;
}

export default function AvailabilityDashboard() {
  const [summary, setSummary] = useState<Summary[]>([]);
  const [rows, setRows] = useState<AvailabilityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [account, setAccount] = useState('all');
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);

  async function load() {
    setLoading(true); setError('');
    try {
      const res = await fetch('/api/availability', { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load availability.');
      setSummary(json.summary || []); setRows(json.rows || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load availability.');
    } finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, []);

  const overall = useMemo(() => {
    const withData = summary.filter((s) => s.availability_pct !== null);
    const expected = withData.reduce((n, s) => n + Number(s.expected_basepacks || 0), 0);
    const available = withData.reduce((n, s) => n + Number(s.available_basepacks || 0), 0);
    return { expected, available, pct: expected ? Math.round((available / expected) * 10000) / 100 : null, accountsUpdated: withData.length };
  }, [summary]);

  const filteredSummary = account === 'all' ? summary : summary.filter((s) => s.account_code === account);
  const visibleAccounts = account === 'all' ? summary : summary.filter((s) => s.account_code === account);

  const filterOptions = useMemo(() => {
    const keys: FilterKey[] = ['businessGroup','category','subCategory','brand','productType','retailType','variant','basepack'];
    return Object.fromEntries(keys.map((key) => [key, [...new Set(rows.flatMap((row) => values(row, key)).filter(Boolean))].sort((a,b)=>a.localeCompare(b))])) as Record<FilterKey,string[]>;
  }, [rows]);

  const matrix = useMemo(() => {
    const q = search.trim().toLowerCase();
    const byBasepack = new Map<string, { basepack: AvailabilityRow; cells: Map<string, AvailabilityRow> }>();
    for (const row of rows) {
      if (account !== 'all' && row.account_code !== account) continue;
      const haystack = [row.packsize, ...(row.brands ?? []), ...(row.business_groups ?? []), ...(row.categories ?? []), ...(row.sub_categories ?? []), ...(row.product_types ?? []), ...(row.retail_types ?? []), ...(row.variants ?? []), row.account_skus].join(' ').toLowerCase();
      if (q && !haystack.includes(q)) continue;
      if ((Object.keys(filters) as FilterKey[]).some((key) => filters[key] !== 'all' && !values(row, key).includes(filters[key]))) continue;
      const current = byBasepack.get(row.basepack_id) ?? { basepack: row, cells: new Map() };
      current.cells.set(row.account_code, row);
      byBasepack.set(row.basepack_id, current);
    }
    return [...byBasepack.values()].sort((a,b)=>a.basepack.packsize.localeCompare(b.basepack.packsize));
  }, [rows, account, search, filters]);

  function setFilter(key: FilterKey, value: string) { setFilters((prev) => ({ ...prev, [key]: value })); }
  function resetFilters() { setAccount('all'); setSearch(''); setFilters(EMPTY_FILTERS); }

  return <div className="page">
    <div className="page-head">
      <div><span className="eyebrow">Basepack availability</span><h1>Availability</h1><p>Master basepack → account SKU IDs → latest stock dump. No extra workflow.</p></div>
      <button className="button secondary" onClick={() => void load()} disabled={loading}><RefreshCw size={16}/>Refresh</button>
    </div>

    {error && <div className="alert error">{error}</div>}

    <section className="kpi-grid">
      <div className="kpi"><span>Overall availability</span><strong>{overall.pct === null ? '—' : `${overall.pct}%`}</strong><small>{overall.available} / {overall.expected} availability cells available</small></div>
      <div className="kpi"><span>Accounts with stock data</span><strong>{overall.accountsUpdated}</strong><small>of {summary.length} configured accounts</small></div>
      <div className="kpi"><span>Master basepacks</span><strong>{new Set(rows.map((r)=>r.basepack_id)).size}</strong><small>active basepacks mapped to at least one account</small></div>
    </section>

    <section className="card">
      <div className="card-head"><div><h2>Account status</h2><p>Availability is counted by basepack, not by duplicate or promotional SKU rows.</p></div></div>
      <div className="account-grid">
        {filteredSummary.map((s) => <button key={s.account_code} className={`account-card ${account === s.account_code ? 'selected' : ''}`} onClick={() => setAccount(account === s.account_code ? 'all' : s.account_code)}>
          <div className="account-card-top"><strong>{s.account_name}</strong><span>{fmtDate(s.snapshot_date)}</span></div>
          <div className="account-pct">{s.availability_pct === null ? 'No data' : `${s.availability_pct}%`}</div>
          <div className="mini-meter"><span style={{ width: `${s.availability_pct ?? 0}%` }} /></div>
          <small>{s.snapshot_date ? (s.metric_type==='branch_ola' ? `${s.available_basepacks}/${s.expected_basepacks} basepack-branch cells available` : `${s.available_basepacks}/${s.expected_basepacks} basepacks available`) : `${s.expected_basepacks} master-listed basepacks`}</small>
        </button>)}
      </div>
    </section>


    <section className="card">
      <div className="toolbar filter-toolbar">
        <div className="search-box"><Search size={17}/><input value={search} onChange={(e)=>setSearch(e.target.value)} placeholder="Search basepack, brand, category or account SKU"/></div>
        <select value={account} onChange={(e)=>setAccount(e.target.value)}><option value="all">All accounts</option>{summary.map((s)=><option key={s.account_code} value={s.account_code}>{s.account_name}</option>)}</select>
        <button className="button secondary compact" onClick={resetFilters}><RotateCcw size={15}/>Reset</button>
      </div>
      <div className="filter-grid">
        <label><span>Business Group</span><select value={filters.businessGroup} onChange={(e)=>setFilter('businessGroup',e.target.value)}><option value="all">All</option>{filterOptions.businessGroup.map((v)=><option key={v}>{v}</option>)}</select></label>
        <label><span>Category</span><select value={filters.category} onChange={(e)=>setFilter('category',e.target.value)}><option value="all">All</option>{filterOptions.category.map((v)=><option key={v}>{v}</option>)}</select></label>
        <label><span>Sub Category</span><select value={filters.subCategory} onChange={(e)=>setFilter('subCategory',e.target.value)}><option value="all">All</option>{filterOptions.subCategory.map((v)=><option key={v}>{v}</option>)}</select></label>
        <label><span>Brand</span><select value={filters.brand} onChange={(e)=>setFilter('brand',e.target.value)}><option value="all">All</option>{filterOptions.brand.map((v)=><option key={v}>{v}</option>)}</select></label>
        <label><span>Basepack</span><select value={filters.basepack} onChange={(e)=>setFilter('basepack',e.target.value)}><option value="all">All</option>{filterOptions.basepack.map((v)=><option key={v}>{v}</option>)}</select></label>
        <label><span>Type</span><select value={filters.productType} onChange={(e)=>setFilter('productType',e.target.value)}><option value="all">All</option>{filterOptions.productType.map((v)=><option key={v}>{v}</option>)}</select></label>
        <label><span>Retail Type</span><select value={filters.retailType} onChange={(e)=>setFilter('retailType',e.target.value)}><option value="all">All</option>{filterOptions.retailType.map((v)=><option key={v}>{v}</option>)}</select></label>
        <label><span>Variant</span><select value={filters.variant} onChange={(e)=>setFilter('variant',e.target.value)}><option value="all">All</option>{filterOptions.variant.map((v)=><option key={v}>{v}</option>)}</select></label>
      </div>

      {loading ? <div className="empty">Loading availability…</div> : <div className="table-wrap">
        <table className="matrix-table"><thead><tr><th className="sticky-col">Basepack</th>{visibleAccounts.map((a)=><th key={a.account_code}>{a.account_name}<small>{fmtDate(a.snapshot_date)}</small></th>)}</tr></thead>
          <tbody>
            {matrix.map(({ basepack, cells }) => <tr key={basepack.basepack_id}>
              <td className="sticky-col product-cell"><strong>{basepack.packsize}</strong><span>{join(basepack.brands)} · {join(basepack.categories)} · {basepack.sku_count} SKU{basepack.sku_count===1?'':'s'}</span><small>{join(basepack.business_groups)} · {join(basepack.sub_categories)}</small></td>
              {visibleAccounts.map((a)=>{const cell=cells.get(a.account_code);if(!cell)return <td key={a.account_code}><span className="status not-listed">Not listed</span></td>;if(!cell.snapshot_date)return <td key={a.account_code}><span className="status no-data">No data</span><small className="cell-note">{cell.account_skus}</small></td>;return <td key={a.account_code}><span className={`status ${cell.is_available?'available':'oos'}`}>{cell.is_available?'Available':'Out'}</span><strong className="stock-number">{Number(cell.stock_qty||0).toLocaleString()}</strong><small className="cell-note">{cell.account_skus}</small></td>;})}
            </tr>)}
            {!matrix.length && <tr><td colSpan={visibleAccounts.length+1}><div className="empty">No basepacks match the current filters.</div></td></tr>}
          </tbody>
        </table>
      </div>}
    </section>
  </div>;
}
