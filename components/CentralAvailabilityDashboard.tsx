'use client';

import { useEffect, useMemo, useState } from 'react';
import { Download, LayoutGrid, RefreshCw, RotateCcw, Search, SlidersHorizontal, TableProperties } from 'lucide-react';
import { exportCsv } from '@/lib/csv-export';

type CentralRow = {
  account_code: string;
  account_name: string;
  sort_order: number;
  observation_date: string;
  basepack_id: string;
  packsize: string;
  brands: string[] | null;
  business_groups: string[] | null;
  categories: string[] | null;
  sub_categories: string[] | null;
  product_types: string[] | null;
  retail_types: string[] | null;
  variants: string[] | null;
  expected_units: number;
  available_units: number;
  availability_score: number;
  is_available: boolean;
  stock_qty: number;
  stock_valuation: number | null;
};

type AccountSummary = {
  account_code: string;
  account_name: string;
  sort_order: number;
  observation_date: string | null;
};

type Filters = {
  businessGroup: string;
  category: string;
  subCategory: string;
  brand: string;
  basepack: string;
};

type PivotDimension = 'brandBasepack' | 'brand' | 'businessGroup' | 'category' | 'subCategory';

const EMPTY_FILTERS: Filters = {
  businessGroup: 'all',
  category: 'all',
  subCategory: 'all',
  brand: 'all',
  basepack: 'all',
};

function arr(value: string[] | null | undefined) { return value ?? []; }
function pct(score: number | null | undefined) { return score == null ? '—' : `${(Number(score) * 100).toFixed(2)}%`; }
function fmtDate(value: string | null | undefined) {
  if (!value) return 'No observation';
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(`${value}T00:00:00`));
}
function avg(values: number[]) { return values.length ? values.reduce((a,b)=>a+b,0) / values.length : null; }
function first(values: string[] | null | undefined) { return values?.[0] ?? 'Unclassified'; }

export default function CentralAvailabilityDashboard() {
  const [rows, setRows] = useState<CentralRow[]>([]);
  const [accounts, setAccounts] = useState<AccountSummary[]>([]);
  const [selectedAccounts, setSelectedAccounts] = useState<string[]>([]);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [search, setSearch] = useState('');
  const [availabilityFilter, setAvailabilityFilter] = useState<'all'|'available'|'unavailable'>('all');
  const [tab, setTab] = useState<'overview'|'pivot'>('overview');
  const [pivotDimension, setPivotDimension] = useState<PivotDimension>('brandBasepack');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true); setError('');
    try {
      const response = await fetch('/api/central', { cache: 'no-store' });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || 'Failed to load central availability.');
      const nextAccounts: AccountSummary[] = json.accounts ?? [];
      setRows(json.rows ?? []);
      setAccounts(nextAccounts);
      setSelectedAccounts((current) => current.length ? current : nextAccounts.map((a) => a.account_code));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load central availability.');
    } finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, []);

  const businessGroupOptions = useMemo(() => [...new Set(rows.flatMap((r)=>arr(r.business_groups)))].sort(), [rows]);
  const categoryOptions = useMemo(() => [...new Set(rows.filter((r)=>filters.businessGroup==='all'||arr(r.business_groups).includes(filters.businessGroup)).flatMap((r)=>arr(r.categories)))].sort(), [rows,filters.businessGroup]);
  const subCategoryOptions = useMemo(() => [...new Set(rows.filter((r)=>(filters.businessGroup==='all'||arr(r.business_groups).includes(filters.businessGroup))&&(filters.category==='all'||arr(r.categories).includes(filters.category))).flatMap((r)=>arr(r.sub_categories)))].sort(), [rows,filters.businessGroup,filters.category]);
  const brandOptions = useMemo(() => [...new Set(rows.filter((r)=>(filters.businessGroup==='all'||arr(r.business_groups).includes(filters.businessGroup))&&(filters.category==='all'||arr(r.categories).includes(filters.category))&&(filters.subCategory==='all'||arr(r.sub_categories).includes(filters.subCategory))).flatMap((r)=>arr(r.brands)))].sort(), [rows,filters.businessGroup,filters.category,filters.subCategory]);
  const basepackOptions = useMemo(() => [...new Set(rows.filter((r)=>(filters.businessGroup==='all'||arr(r.business_groups).includes(filters.businessGroup))&&(filters.category==='all'||arr(r.categories).includes(filters.category))&&(filters.subCategory==='all'||arr(r.sub_categories).includes(filters.subCategory))&&(filters.brand==='all'||arr(r.brands).includes(filters.brand))).map((r)=>r.packsize))].sort(), [rows,filters]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (!selectedAccounts.includes(r.account_code)) return false;
      if (filters.businessGroup !== 'all' && !arr(r.business_groups).includes(filters.businessGroup)) return false;
      if (filters.category !== 'all' && !arr(r.categories).includes(filters.category)) return false;
      if (filters.subCategory !== 'all' && !arr(r.sub_categories).includes(filters.subCategory)) return false;
      if (filters.brand !== 'all' && !arr(r.brands).includes(filters.brand)) return false;
      if (filters.basepack !== 'all' && r.packsize !== filters.basepack) return false;
      if (availabilityFilter === 'available' && Number(r.availability_score) <= 0) return false;
      if (availabilityFilter === 'unavailable' && Number(r.availability_score) > 0) return false;
      if (q) {
        const haystack = [r.packsize,...arr(r.brands),...arr(r.business_groups),...arr(r.categories),...arr(r.sub_categories),r.account_name].join(' ').toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [rows, selectedAccounts, filters, search, availabilityFilter]);


  const accountStats = useMemo(() => accounts.filter((a)=>selectedAccounts.includes(a.account_code)).map((a) => {
    const scoped = filteredRows.filter((r)=>r.account_code===a.account_code);
    const score = avg(scoped.map((r)=>Number(r.availability_score)));
    return { ...a, score, basepacks: scoped.length, equivalent: scoped.reduce((n,r)=>n+Number(r.availability_score),0) };
  }), [accounts, selectedAccounts, filteredRows]);

  const brandSummary = useMemo(() => {
    const map = new Map<string,{brand:string;basepacks:Set<string>;scores:number[];byAccount:Map<string,number[]>}>();
    for (const row of filteredRows) {
      const brands = arr(row.brands).length ? arr(row.brands) : ['Unclassified'];
      for (const brand of brands) {
        const item = map.get(brand) ?? { brand, basepacks:new Set<string>(), scores:[], byAccount:new Map<string,number[]>() };
        item.basepacks.add(row.basepack_id); item.scores.push(Number(row.availability_score));
        const list = item.byAccount.get(row.account_code) ?? []; list.push(Number(row.availability_score)); item.byAccount.set(row.account_code,list);
        map.set(brand,item);
      }
    }
    return [...map.values()].map((x)=>({
      brand:x.brand, basepacks:x.basepacks.size,
      accountScores:Object.fromEntries([...x.byAccount].map(([k,v])=>[k,avg(v)])),
    })).sort((a,b)=>a.brand.localeCompare(b.brand));
  }, [filteredRows]);

  const basepackMatrix = useMemo(() => {
    const map = new Map<string,{basepack_id:string;packsize:string;brand:string;businessGroup:string;category:string;subCategory:string;cells:Map<string,CentralRow>;scores:number[]}>();
    for (const row of filteredRows) {
      const fallback: {basepack_id:string;packsize:string;brand:string;businessGroup:string;category:string;subCategory:string;cells:Map<string,CentralRow>;scores:number[]} = {
        basepack_id:row.basepack_id, packsize:row.packsize, brand:first(row.brands), businessGroup:first(row.business_groups), category:first(row.categories), subCategory:first(row.sub_categories), cells:new Map<string,CentralRow>(), scores:[],
      };
      const item = map.get(row.basepack_id) ?? fallback;
      item.cells.set(row.account_code,row); item.scores.push(Number(row.availability_score)); map.set(row.basepack_id,item);
    }
    return [...map.values()].sort((a,b)=>a.brand.localeCompare(b.brand)||a.packsize.localeCompare(b.packsize));
  }, [filteredRows]);

  const groupedPivot = useMemo(() => {
    if (pivotDimension === 'brandBasepack') return [];
    const map = new Map<string,{label:string;basepacks:Set<string>;scores:number[];byAccount:Map<string,number[]>}>();
    for (const row of filteredRows) {
      const vals = pivotDimension === 'brand' ? arr(row.brands)
        : pivotDimension === 'businessGroup' ? arr(row.business_groups)
        : pivotDimension === 'category' ? arr(row.categories)
        : arr(row.sub_categories);
      for (const label of (vals.length ? vals : ['Unclassified'])) {
        const item = map.get(label) ?? {label,basepacks:new Set<string>(),scores:[],byAccount:new Map<string,number[]>()};
        item.basepacks.add(row.basepack_id); item.scores.push(Number(row.availability_score));
        const list = item.byAccount.get(row.account_code) ?? []; list.push(Number(row.availability_score)); item.byAccount.set(row.account_code,list);
        map.set(label,item);
      }
    }
    return [...map.values()].map((x)=>({label:x.label,basepacks:x.basepacks.size,score:avg(x.scores),accountScores:Object.fromEntries([...x.byAccount].map(([k,v])=>[k,avg(v)]))})).sort((a,b)=>a.label.localeCompare(b.label));
  }, [filteredRows,pivotDimension]);

  function toggleAccount(code:string) {
    setSelectedAccounts((current) => current.includes(code) ? (current.length===1?current:current.filter((x)=>x!==code)) : [...current,code]);
  }
  function reset() { setFilters(EMPTY_FILTERS); setSearch(''); setAvailabilityFilter('all'); setSelectedAccounts(accounts.map((a)=>a.account_code)); }
  function exportFiltered() { exportCsv(`central-availability-${availabilityFilter}`, filteredRows.map((r)=>({ Account:r.account_name, Date:r.observation_date, Basepack:r.packsize, Brand:arr(r.brands).join(' | '), Business_Unit:arr(r.business_groups).join(' | '), Category:arr(r.categories).join(' | '), Sub_Category:arr(r.sub_categories).join(' | '), Availability:r.availability_score>0?'Available':'Unavailable', Availability_Pct:(Number(r.availability_score)*100).toFixed(2), Stock:r.stock_qty }))); }
  function setFilter<K extends keyof Filters>(key:K,value:string) {
    setFilters((prev) => {
      if (key==='businessGroup') return {...EMPTY_FILTERS,businessGroup:value};
      if (key==='category') return {...prev,category:value,subCategory:'all',brand:'all',basepack:'all'};
      if (key==='subCategory') return {...prev,subCategory:value,brand:'all',basepack:'all'};
      if (key==='brand') return {...prev,brand:value,basepack:'all'};
      return {...prev,[key]:value};
    });
  }

  return <div className="page central-page">
    <div className="page-head">
      <div><h1>Central Availability</h1></div>
      <button className="button secondary" onClick={()=>void load()} disabled={loading}><RefreshCw size={16}/>Refresh</button>
    </div>

    {error && <div className="alert error central-alert">{error}</div>}

    <div className="central-tabs">
      <button className={tab==='overview'?'active':''} onClick={()=>setTab('overview')}><LayoutGrid size={16}/>Overview</button>
      <button className={tab==='pivot'?'active':''} onClick={()=>setTab('pivot')}><TableProperties size={16}/>Pivot</button>
    </div>

    <section className="card central-filter-card">
      <div className="toolbar filter-toolbar">
        <div className="search-box"><Search size={17}/><input value={search} onChange={(e)=>setSearch(e.target.value)} placeholder="Search basepack, brand, category or account"/></div>
        <button className="button secondary compact" onClick={exportFiltered} disabled={!filteredRows.length}><Download size={15}/>Export CSV</button>
        <button className="button secondary compact" onClick={reset}><RotateCcw size={15}/>Reset</button>
      </div>
      <div className="filter-grid central-filter-grid">
        <label><span>Business Unit</span><select value={filters.businessGroup} onChange={(e)=>setFilter('businessGroup',e.target.value)}><option value="all">All business units</option>{businessGroupOptions.map((v)=><option key={v} value={v}>{v}</option>)}</select></label>
        <label><span>Category</span><select value={filters.category} onChange={(e)=>setFilter('category',e.target.value)}><option value="all">All categories</option>{categoryOptions.map((v)=><option key={v} value={v}>{v}</option>)}</select></label>
        <label><span>Sub-category</span><select value={filters.subCategory} onChange={(e)=>setFilter('subCategory',e.target.value)}><option value="all">All sub-categories</option>{subCategoryOptions.map((v)=><option key={v} value={v}>{v}</option>)}</select></label>
        <label><span>Brand</span><select value={filters.brand} onChange={(e)=>setFilter('brand',e.target.value)}><option value="all">All brands</option>{brandOptions.map((v)=><option key={v} value={v}>{v}</option>)}</select></label>
        <label><span>Availability</span><select value={availabilityFilter} onChange={(e)=>setAvailabilityFilter(e.target.value as any)}><option value="all">All products</option><option value="available">Available only</option><option value="unavailable">Unavailable only</option></select></label>
        <label><span>Basepack</span><select value={filters.basepack} onChange={(e)=>setFilter('basepack',e.target.value)}><option value="all">All basepacks</option>{basepackOptions.map((v)=><option key={v} value={v}>{v}</option>)}</select></label>
      </div>
      <div className="account-toggle-row">
        <span><SlidersHorizontal size={14}/>Accounts</span>
        {accounts.map((a)=><button key={a.account_code} className={selectedAccounts.includes(a.account_code)?'selected':''} onClick={()=>toggleAccount(a.account_code)}>{a.account_name}</button>)}
      </div>
    </section>

    <section className="central-kpis">
      {accountStats.map((a)=><div className="central-kpi" key={a.account_code}><span>{a.account_name}</span><strong>{a.score==null?'—':pct(a.score)}</strong><small>{a.basepacks} in-scope basepacks · {fmtDate(a.observation_date)}</small></div>)}
    </section>

    {tab==='overview' ? <>
      <section className="card">
        <div className="card-head"><div><h2>Brand OLA summary</h2><p>Every account percentage responds to the filters above.</p></div></div>
        <div className="table-wrap">
          <table className="central-summary-table"><thead><tr><th>Brand</th><th>Basepacks</th>{accountStats.map((a)=><th key={a.account_code}>{a.account_name}<small>{fmtDate(a.observation_date)}</small></th>)}</tr></thead>
          <tbody>{brandSummary.map((b)=><tr key={b.brand}><td><strong>{b.brand}</strong></td><td>{b.basepacks}</td>{accountStats.map((a)=><td key={a.account_code}>{b.accountScores[a.account_code]==null?'—':pct(b.accountScores[a.account_code])}</td>)}</tr>)}
          {!brandSummary.length&&<tr><td colSpan={1+accountStats.length} className="empty">No basepacks match the selected filters.</td></tr>}</tbody></table>
        </div>
      </section>
      <section className="card">
        <div className="card-head"><div><h2>Lowest availability basepacks</h2><p>Fast exception view across the selected scope.</p></div></div>
        <div className="table-wrap"><table><thead><tr><th>Brand</th><th>Basepack</th><th>Lowest account OLA</th><th>Accounts in scope</th></tr></thead><tbody>
          {[...basepackMatrix].sort((a,b)=>Math.min(...a.scores)-Math.min(...b.scores)).slice(0,15).map((b)=><tr key={b.basepack_id}><td>{b.brand}</td><td><strong>{b.packsize}</strong><small>{b.businessGroup} · {b.category} · {b.subCategory}</small></td><td><strong>{b.scores.length ? pct(Math.min(...b.scores)) : '—'}</strong></td><td>{b.cells.size}</td></tr>)}
        </tbody></table></div>
      </section>
    </> : <section className="card pivot-card">
      <div className="card-head pivot-head"><div><h2>Availability Pivot</h2><p>Brand/basepack matrix by default. Change the row dimension for management rollups.</p></div>
        <label className="pivot-dimension"><span>Rows</span><select value={pivotDimension} onChange={(e)=>setPivotDimension(e.target.value as PivotDimension)}><option value="brandBasepack">Brand → Basepack</option><option value="brand">Brand</option><option value="businessGroup">Business Unit</option><option value="category">Category</option><option value="subCategory">Sub-category</option></select></label>
      </div>
      {pivotDimension==='brandBasepack' ? <div className="table-wrap"><table className="matrix-table central-pivot-table"><thead><tr><th className="sticky-col">Brand / Basepack</th>{accountStats.map((a)=><th key={a.account_code}>{a.account_name}<small>{fmtDate(a.observation_date)}</small></th>)}</tr></thead><tbody>
        {basepackMatrix.map((b,i)=>{
          const previousBrand = i>0 ? basepackMatrix[i-1].brand : null;
          return <tr key={b.basepack_id} className={previousBrand!==b.brand?'brand-start':''}><td className="sticky-col product-cell">{previousBrand!==b.brand&&<span className="pivot-brand-label">{b.brand}</span>}<strong>{b.packsize}</strong><span>{b.businessGroup} · {b.category} · {b.subCategory}</span></td>{accountStats.map((a)=>{const cell=b.cells.get(a.account_code);return <td key={a.account_code}>{!cell?<span className="status not-listed">Not scoped</span>:cell.account_code==='pandamart'?<><span className={`status ${cell.availability_score>0?'available':'oos'}`}>{cell.available_units}/{cell.expected_units} branches</span><div className="stock-number">{pct(Number(cell.availability_score))}</div></>:<><span className={`status ${cell.availability_score>0?'available':'oos'}`}>{cell.availability_score>0?'Available':'OOS'}</span><div className="stock-number">{Number(cell.stock_qty).toLocaleString()} units</div></>}</td>})}</tr>;
        })}
        {!basepackMatrix.length&&<tr><td colSpan={1+accountStats.length} className="empty">No rows match the selected filters.</td></tr>}</tbody></table></div>
      : <div className="table-wrap"><table className="central-summary-table"><thead><tr><th>{pivotDimension==='businessGroup'?'Business Unit':pivotDimension==='subCategory'?'Sub-category':pivotDimension[0].toUpperCase()+pivotDimension.slice(1)}</th><th>Basepacks</th>{accountStats.map((a)=><th key={a.account_code}>{a.account_name}</th>)}</tr></thead><tbody>{groupedPivot.map((g)=><tr key={g.label}><td><strong>{g.label}</strong></td><td>{g.basepacks}</td>{accountStats.map((a)=><td key={a.account_code}>{g.accountScores[a.account_code]==null?'—':pct(g.accountScores[a.account_code])}</td>)}</tr>)}</tbody></table></div>}
    </section>}
  </div>;
}
