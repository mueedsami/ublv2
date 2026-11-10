'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  BarChart3,
  CheckCircle2,
  Download,
  Layers3,
  LayoutGrid,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldAlert,
  Sparkles,
  TableProperties,
  Target,
} from 'lucide-react';
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

type SkuRow = {
  account_code: string; account_name: string; account_sku: string; basepack: string;
  product_name: string; brand: string; category: string; business_group: string;
  branch: string; status: 'available'|'unavailable'|'unknown';
  stock_qty: number | null; price: number | null; product_url: string | null;
  observed_at: string; run_finished_at: string | null;
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
function pct(score: number | null | undefined, digits = 1) { return score == null ? '—' : `${(Number(score) * 100).toFixed(digits)}%`; }
function fmtDate(value: string | null | undefined) {
  if (!value) return 'No observation';
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(`${value}T00:00:00`));
}
function avg(values: number[]) { return values.length ? values.reduce((a,b)=>a+b,0) / values.length : null; }
function first(values: string[] | null | undefined) { return values?.[0] ?? 'Unclassified'; }
function clampPct(score: number | null | undefined) { return Math.max(0, Math.min(100, Number(score ?? 0) * 100)); }
function scoreBand(score: number | null | undefined) {
  if (score == null) return 'neutral';
  if (score >= .9) return 'excellent';
  if (score >= .75) return 'good';
  if (score >= .5) return 'warning';
  return 'critical';
}
function dayDiff(a: string | null | undefined, b: string | null | undefined) {
  if (!a || !b) return null;
  const ms = new Date(`${a}T00:00:00`).getTime() - new Date(`${b}T00:00:00`).getTime();
  return Math.round(ms / 86400000);
}

export default function CentralAvailabilityDashboard() {
  const [rows, setRows] = useState<CentralRow[]>([]);
  const [skuRows, setSkuRows] = useState<SkuRow[]>([]);
  const [catalogSummary,setCatalogSummary] = useState<{account_code:string;account_name:string;scraped_at:string|null;catalog_observations:number;in_stock:number;out_of_stock:number;unknown:number;ola_pct:number|null}[]>([]);
  const [pandamartStore, setPandamartStore] = useState('all');
  const [olaReadiness, setOlaReadiness] = useState<{stores:{store_id:string;store_name:string}[];skuCounts:Record<string,number>;latest:Record<string,{status:string;finished_at:string}|null>}|null>(null);
  const [skuLoading, setSkuLoading] = useState(false);
  const [skuError, setSkuError] = useState('');
  const [skuLoaded, setSkuLoaded] = useState(false);
  const [accounts, setAccounts] = useState<AccountSummary[]>([]);
  // Catalog-based BeautyBooth has no Master SKU/basepack rows in /api/central.
  // Keep it selectable without merging catalog OLA into master-mapped executive KPIs.
  // Keep the account selector independent of historical stock-upload coverage.
  // These active scraped accounts may not yet appear in the legacy central OLA view.
  // This is a selector-only fallback: do not invent availability scores for missing rows.
  const filterAccounts = useMemo(() => {
    const mapped = accounts.filter(a => a.account_code !== 'ushop' && a.account_code !== 'beauty_booth');
    const byCode = new Map<string, AccountSummary>(mapped.map(a => [a.account_code, a]));
    for (const [account_code, account_name] of [
      ['arogga', 'Arogga'], ['cartup', 'Cartup'], ['shwapno', 'Shwapno'],
    ] as const) {
      if (!byCode.has(account_code)) {
        byCode.set(account_code, { account_code, account_name, sort_order: 998, observation_date: null });
      }
    }
    byCode.set('beauty_booth', { account_code: 'beauty_booth', account_name: 'BeautyBooth', sort_order: 999, observation_date: null });
    return [...byCode.values()].sort((a, b) => a.account_name.localeCompare(b.account_name, undefined, { sensitivity: 'base' }));
  }, [accounts]);
  const [selectedAccounts, setSelectedAccounts] = useState<string[]>([]);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [search, setSearch] = useState('');
  const [availabilityFilter, setAvailabilityFilter] = useState<'all'|'available'|'unavailable'|'unknown'>('all');
  const [tab, setTab] = useState<'overview'|'pivot'|'sku'>('overview');
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
      setSelectedAccounts((current) => {
        const eligible = [...new Set([...nextAccounts.filter(a => a.account_code !== 'ushop' && a.account_code !== 'beauty_booth').map(a => a.account_code), 'arogga', 'cartup', 'shwapno', 'beauty_booth'])];
        const retained = current.filter(code => eligible.includes(code));
        return retained.length ? retained : eligible;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load central availability.');
    } finally { setLoading(false); }
  }

  useEffect(()=>{fetch('/api/ola/catalog-summary',{cache:'no-store'}).then(r=>r.ok?r.json():null).then(body=>{if(body)setCatalogSummary(body.accounts??[]);}).catch(()=>{});},[]);
  useEffect(()=>{fetch('/api/central/ola-readiness',{cache:'no-store'}).then(r=>r.ok?r.json():null).then(data=>{if(data)setOlaReadiness(data);}).catch(()=>{});},[]);
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
      if (availabilityFilter === 'available' && (r.availability_score == null || Number(r.availability_score) <= 0)) return false;
      if (availabilityFilter === 'unavailable' && (r.availability_score == null || Number(r.availability_score) > 0)) return false;
      if (availabilityFilter === 'unknown' && r.availability_score != null) return false;
      if (q) {
        const haystack = [r.packsize,...arr(r.brands),...arr(r.business_groups),...arr(r.categories),...arr(r.sub_categories),r.account_name].join(' ').toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [rows, selectedAccounts, filters, search, availabilityFilter]);

  async function loadSkuRows() {
    setSkuLoading(true); setSkuError('');
    try {
      const response = await fetch('/api/central/skus', { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Could not load SKU observations');
      setSkuRows(payload.rows ?? []);
      setSkuLoaded(true);
    } catch (error) {
      setSkuError(error instanceof Error ? error.message : 'Failed to load SKU observations');
    } finally { setSkuLoading(false); }
  }

  const pandamartStoreOptions = useMemo(() => [...new Set(skuRows.filter(r=>r.account_code==='pandamart').map(r=>r.branch))].sort(), [skuRows]);

  const filteredSkuRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return skuRows.filter((r) => {
      if (!selectedAccounts.includes(r.account_code)) return false;
      if (pandamartStore !== 'all' && r.account_code==='pandamart' && r.branch!==pandamartStore) return false;
      if (availabilityFilter !== 'all' && r.status !== availabilityFilter) return false;
      if (filters.businessGroup !== 'all' && r.business_group !== filters.businessGroup) return false;
      if (filters.category !== 'all' && r.category !== filters.category) return false;
      if (filters.brand !== 'all' && r.brand !== filters.brand) return false;
      if (filters.basepack !== 'all' && r.basepack !== filters.basepack) return false;
      if (filters.subCategory !== 'all') {
        // There is no SKU-level subcategory in the scraper payload; check basepack metadata.
        if (!rows.some((b) => b.account_code===r.account_code && b.packsize===r.basepack && arr(b.sub_categories).includes(filters.subCategory))) return false;
      }
      if (query && ![r.account_name,r.account_sku,r.basepack,r.product_name,r.brand,r.category,r.branch,r.business_group].join(' ').toLowerCase().includes(query)) return false;
      return true;
    });
  }, [skuRows, rows, selectedAccounts, pandamartStore, availabilityFilter, filters, search]);

  const accountStats = useMemo(() => accounts.filter((a)=>selectedAccounts.includes(a.account_code)).map((a) => {
    const scoped = filteredRows.filter((r)=>r.account_code===a.account_code);
    const score = avg(scoped.map((r)=>Number(r.availability_score)));
    const full = scoped.filter((r)=>Number(r.availability_score)>=.999999).length;
    const partial = scoped.filter((r)=>Number(r.availability_score)>0 && Number(r.availability_score)<.999999).length;
    const oos = scoped.filter((r)=>Number(r.availability_score)<=0).length;
    return { ...a, score, basepacks: scoped.length, equivalent: scoped.reduce((n,r)=>n+Number(r.availability_score),0), full, partial, oos };
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
      brand:x.brand,
      basepacks:x.basepacks.size,
      score:avg(x.scores),
      accountScores:Object.fromEntries([...x.byAccount].map(([k,v])=>[k,avg(v)])),
    })).sort((a,b)=>(a.score ?? 0)-(b.score ?? 0) || a.brand.localeCompare(b.brand));
  }, [filteredRows]);

  const basepackMatrix = useMemo(() => {
    const map = new Map<string,{basepack_id:string;packsize:string;brand:string;businessGroup:string;category:string;subCategory:string;cells:Map<string,CentralRow>;scores:number[]}>();
    for (const row of filteredRows) {
      const fallback = {
        basepack_id:row.basepack_id,
        packsize:row.packsize,
        brand:first(row.brands),
        businessGroup:first(row.business_groups),
        category:first(row.categories),
        subCategory:first(row.sub_categories),
        cells:new Map<string,CentralRow>(),
        scores:[] as number[],
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

  const executive = useMemo(() => {
    const scores = filteredRows.map((r)=>Number(r.availability_score));
    const overall = avg(scores);
    const full = scores.filter((s)=>s>=.999999).length;
    const partial = scores.filter((s)=>s>0 && s<.999999).length;
    const oos = scores.filter((s)=>s<=0).length;
    const uniqueBasepacks = new Set(filteredRows.map((r)=>r.basepack_id)).size;
    const totalCells = scores.length;
    const strongest = [...accountStats].filter((x)=>x.score!=null).sort((a,b)=>(b.score??0)-(a.score??0))[0] ?? null;
    const weakest = [...accountStats].filter((x)=>x.score!=null).sort((a,b)=>(a.score??0)-(b.score??0))[0] ?? null;
    const freshestDate = accountStats.map((x)=>x.observation_date).filter(Boolean).sort().at(-1) ?? null;
    const stale = accountStats.filter((x)=>dayDiff(freshestDate,x.observation_date)!=null && Number(dayDiff(freshestDate,x.observation_date))>=2);
    const riskiestBrand = brandSummary[0] ?? null;
    return { overall, full, partial, oos, uniqueBasepacks, totalCells, strongest, weakest, freshestDate, stale, riskiestBrand };
  }, [filteredRows, accountStats, brandSummary]);

  const categorySummary = useMemo(() => {
    const map = new Map<string,{label:string;scores:number[];basepacks:Set<string>}>();
    for (const row of filteredRows) {
      const labels = arr(row.categories).length ? arr(row.categories) : ['Unclassified'];
      for (const label of labels) {
        const item = map.get(label) ?? { label, scores:[], basepacks:new Set<string>() };
        item.scores.push(Number(row.availability_score));
        item.basepacks.add(row.basepack_id);
        map.set(label,item);
      }
    }
    return [...map.values()].map((x)=>({label:x.label,score:avg(x.scores),basepacks:x.basepacks.size})).sort((a,b)=>(a.score??0)-(b.score??0));
  }, [filteredRows]);

  const criticalBasepacks = useMemo(() => [...basepackMatrix].map((b)=>{
    let oos = 0, partial = 0;
    for (const a of accountStats) {
      const cell = b.cells.get(a.account_code);
      if (!cell) continue;
      const score = Number(cell.availability_score);
      if (score <= 0) oos += 1;
      else if (score < .999999) partial += 1;
    }
    return { ...b, oos, partial, scoped:b.cells.size, score:avg(b.scores) };
  }).sort((a,b)=>b.oos-a.oos || b.partial-a.partial || (a.score??0)-(b.score??0)).slice(0,12), [basepackMatrix,accountStats]);

  const maxAccountScore = Math.max(1, ...accountStats.map((a)=>Number(a.score ?? 0) * 100));

  function toggleAccount(code:string) {
    setSelectedAccounts((current) => current.includes(code) ? (current.length===1?current:current.filter((x)=>x!==code)) : [...current,code]);
  }
  function focusAccount(code:string) { setSelectedAccounts([code]); }
  function reset() { setFilters(EMPTY_FILTERS); setSearch(''); setAvailabilityFilter('all'); setPandamartStore('all'); setSelectedAccounts(filterAccounts.map((a)=>a.account_code)); }
  function exportSkuRows() {
    exportCsv(`central-sku-ola-${pandamartStore==='all'?'all-stores':pandamartStore.replace(/[^a-z0-9-]/gi,'-')}-${availabilityFilter}`, filteredSkuRows.map((r)=>({
      Account:r.account_name, Branch:r.branch, Product:r.product_name, Account_SKU:r.account_sku,
      Basepack:r.basepack, Brand:r.brand, Business_Unit:r.business_group, Category:r.category,
      Availability:r.status==='available'?'In Stock':r.status==='unavailable'?'Out of Stock':'Unknown',
      Stock_Qty:r.stock_qty ?? '', Price:r.price ?? '', Product_URL:r.product_url ?? '',
      Observed_At:r.observed_at, Run_Finished_At:r.run_finished_at ?? '',
    })));
  }
  function exportFiltered() { exportCsv(`central-availability-${availabilityFilter}`, filteredRows.map((r)=>({ Account:r.account_name, Date:r.observation_date, Basepack:r.packsize, Brand:arr(r.brands).join(' | '), Business_Unit:arr(r.business_groups).join(' | '), Category:arr(r.categories).join(' | '), Sub_Category:arr(r.sub_categories).join(' | '), Availability:r.availability_score==null?'Unknown':r.availability_score>0?'In Stock':'Out of Stock', Availability_Pct:(Number(r.availability_score)*100).toFixed(2), Stock:r.stock_qty }))); }
  function setFilter<K extends keyof Filters>(key:K,value:string) {
    setFilters((prev) => {
      if (key==='businessGroup') return {...EMPTY_FILTERS,businessGroup:value};
      if (key==='category') return {...prev,category:value,subCategory:'all',brand:'all',basepack:'all'};
      if (key==='subCategory') return {...prev,subCategory:value,brand:'all',basepack:'all'};
      if (key==='brand') return {...prev,brand:value,basepack:'all'};
      return {...prev,[key]:value};
    });
  }

  const scopeTokens = [
    filters.businessGroup!=='all' ? filters.businessGroup : null,
    filters.category!=='all' ? filters.category : null,
    filters.subCategory!=='all' ? filters.subCategory : null,
    filters.brand!=='all' ? filters.brand : null,
    filters.basepack!=='all' ? filters.basepack : null,
  ].filter(Boolean) as string[];

  return <div className="page central-page central-presentation-page">
    <div className="page-head central-presentation-head">
      <div>
        <span className="central-kicker">Executive availability command center</span>
        <h1>Central Availability</h1>
        <p>One presentation view of where Unilever is winning availability, where coverage is breaking, and which basepacks need action across accounts.</p>
      </div>
      <div className="central-head-actions">
        <a className="button secondary" href="/central/url-mappings">SKU–URL Mapping Manager</a>
        <button className="button secondary" onClick={tab==='sku'?exportSkuRows:exportFiltered} disabled={tab==='sku'?!filteredSkuRows.length:!filteredRows.length}><Download size={16}/>Export {tab==='sku'?'SKUs':'basepacks'} (CSV)</button>
        <button className="button secondary" onClick={()=>void load()} disabled={loading}><RefreshCw size={16}/>{loading?'Refreshing':'Refresh'}</button>
      </div>
    </div>

    {error && <div className="alert error central-alert">{error}</div>}

    <section className="central-hero-card">
      <div className="central-hero-main">
        <div className="central-hero-gauge" style={{background:`conic-gradient(#2bb673 ${clampPct(executive.overall)}%, rgba(255,255,255,.12) 0)`}}>
          <div><span>Scope OLA</span><strong>{pct(executive.overall)}</strong><small>{executive.totalCells.toLocaleString()} account × basepack cells</small></div>
        </div>
        <div className="central-hero-copy">
          <span className="central-hero-label"><Sparkles size={14}/>Current management readout</span>
          <h2>{executive.overall == null ? 'Waiting for availability data' : executive.overall >= .8 ? 'Availability is broadly healthy — focus on concentrated exceptions.' : executive.overall >= .65 ? 'Availability is mixed — several gaps need commercial attention.' : 'Availability is under pressure — prioritize the weakest accounts and cross-account stockouts.'}</h2>
          <div className="central-scope-chips">
            <span>{selectedAccounts.length} account{selectedAccounts.length===1?'':'s'}</span>
            <span>{executive.uniqueBasepacks} basepacks</span>
            {scopeTokens.length ? scopeTokens.map((x)=><span key={x} className="accent">{x}</span>) : <span>All business scope</span>}
          </div>
        </div>
      </div>
      <div className="central-hero-side">
        <div><span>Strongest account</span><strong>{executive.strongest?.account_name ?? '—'}</strong><b>{pct(executive.strongest?.score)}</b></div>
        <div><span>Weakest account</span><strong>{executive.weakest?.account_name ?? '—'}</strong><b className="danger">{pct(executive.weakest?.score)}</b></div>
        <div><span>Highest-risk brand</span><strong>{executive.riskiestBrand?.brand ?? '—'}</strong><b className="danger">{pct(executive.riskiestBrand?.score)}</b></div>
      </div>
    </section>

    <section className="central-command-card card">
      <div className="central-command-top">
        <div className="central-tabs central-tabs-heavy">
          <button className={tab==='overview'?'active':''} onClick={()=>setTab('overview')}><LayoutGrid size={16}/>Executive overview</button>
          <button className={tab==='pivot'?'active':''} onClick={()=>setTab('pivot')}><TableProperties size={16}/>Availability matrix</button>
          <button className={tab==='sku'?'active':''} onClick={()=>{setTab('sku');if(!skuLoaded && !skuLoading) void loadSkuRows();}}><Layers3 size={16}/>SKU availability audit</button>
        </div>
        <button className="button secondary compact" onClick={reset}><RotateCcw size={15}/>Reset scope</button>
      </div>
      <div className="toolbar filter-toolbar central-toolbar-heavy">
        <div className="search-box"><Search size={17}/><input value={search} onChange={(e)=>setSearch(e.target.value)} placeholder="Search basepack, brand, category or account"/></div>
      </div>
      <div className="filter-grid central-filter-grid central-filter-grid-heavy">
        <label><span>Business Unit</span><select value={filters.businessGroup} onChange={(e)=>setFilter('businessGroup',e.target.value)}><option value="all">All business units</option>{businessGroupOptions.map((v)=><option key={v} value={v}>{v}</option>)}</select></label>
        <label><span>Category</span><select value={filters.category} onChange={(e)=>setFilter('category',e.target.value)}><option value="all">All categories</option>{categoryOptions.map((v)=><option key={v} value={v}>{v}</option>)}</select></label>
        <label><span>Sub-category</span><select value={filters.subCategory} onChange={(e)=>setFilter('subCategory',e.target.value)}><option value="all">All sub-categories</option>{subCategoryOptions.map((v)=><option key={v} value={v}>{v}</option>)}</select></label>
        <label><span>Brand</span><select value={filters.brand} onChange={(e)=>setFilter('brand',e.target.value)}><option value="all">All brands</option>{brandOptions.map((v)=><option key={v} value={v}>{v}</option>)}</select></label>
        <div className="central-accounts-field">
          <span className="central-filter-label">Accounts</span>
          <details className="central-accounts-dropdown">
            <summary aria-label="Filter marketplace accounts">
              <span>{selectedAccounts.length === filterAccounts.length ? 'All accounts' : selectedAccounts.length === 1 ? (filterAccounts.find((a) => a.account_code === selectedAccounts[0])?.account_name ?? '1 account') : `${selectedAccounts.length} of ${filterAccounts.length} accounts`}</span>
              <span aria-hidden="true" className="central-accounts-chevron">⌄</span>
            </summary>
            <div className="central-accounts-menu">
              <div className="central-accounts-menu-head">
                <strong>Select accounts</strong>
                <div className="central-account-actions" style={{display: 'flex', gap: 8, alignItems: 'center'}}>
                  <button type="button" onClick={() => setSelectedAccounts(['arogga'])}>Clear all</button>
                  <button type="button" onClick={() => setSelectedAccounts(filterAccounts.map((a) => a.account_code))}>Select all</button>
                </div>
              </div>
              <div className="central-accounts-menu-options">
                {filterAccounts.map((a) => (
                  <label key={a.account_code} className="central-accounts-option">
                    <input type="checkbox" checked={selectedAccounts.includes(a.account_code)} onChange={() => toggleAccount(a.account_code)} />
                    <span>{a.account_name}</span>
                  </label>
                ))}
              </div>
              <p>At least one account must remain selected.</p>
            </div>
          </details>
        </div>
        <label><span>Availability</span><select value={availabilityFilter} onChange={(e)=>setAvailabilityFilter(e.target.value as 'all'|'available'|'unavailable'|'unknown')}><option value="all">All products</option><option value="available">Available only</option><option value="unavailable">Out of Stock only</option><option value="unknown">Unknown / failed check</option></select></label>
        {tab==='sku' && selectedAccounts.includes('pandamart') && <label><span>Pandamart darkstore</span><select value={pandamartStore} onChange={(e)=>setPandamartStore(e.target.value)}><option value="all">All darkstores</option>{pandamartStoreOptions.map((name)=><option key={name} value={name}>{name}</option>)}</select></label>}
        <label><span>Basepack</span><select value={filters.basepack} onChange={(e)=>setFilter('basepack',e.target.value)}><option value="all">All basepacks</option>{basepackOptions.map((v)=><option key={v} value={v}>{v}</option>)}</select></label>
      </div>
    </section>

    {tab==='sku' && olaReadiness && <section className="card"><div className="card-head"><div><h2>Pandamart darkstore readiness</h2><p>Pandamart: {olaReadiness.stores.length} darkstores · {olaReadiness.skuCounts.pandamart??0} Master SKUs · latest run: {olaReadiness.latest.pandamart?.status??'not run'}.</p></div></div></section>}
    <section className="card" aria-label="Catalog-only availability"><div className="card-head"><div><h2>Catalog-based OLA — BeautyBooth</h2><p>Independent of Master SKU basepack coverage. Scraped stock 0 = OOS, positive stock = In Stock, missing/invalid = Unknown. Do not combine these figures with basepack-level scope OLA above.</p></div></div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(225px,1fr))',gap:12,padding:12}}>
        {!selectedAccounts.includes('beauty_booth') && <p style={{padding:16}}>Select BeautyBooth in Accounts to view its catalog-based OLA.</p>}
        {catalogSummary.filter(c=>c.account_code==='beauty_booth' && selectedAccounts.includes('beauty_booth')).map(c=><div className="card" key={c.account_code} style={{padding:16}}><strong>{c.account_name}</strong><p style={{margin:'8px 0'}}>OLA: <strong>{c.ola_pct==null?'—':`${Number(c.ola_pct).toFixed(2)}%`}</strong></p><p>{Number(c.catalog_observations).toLocaleString()} products/variants · {c.in_stock} in stock · {c.out_of_stock} OOS · {c.unknown} unknown</p><p style={{fontSize:12}}>{c.scraped_at?`Last scrape: ${new Date(c.scraped_at).toLocaleString()}`:'No catalog-stock OLA scrape uploaded yet'}</p><a href={`/ola/${c.account_code}`}>Daily &amp; monthly history</a></div>)}
      </div>
    </section>
    {tab==='sku' ? <section className="card central-sku-audit">
      <div className="card-head"><div><h2>SKU-wise availability audit</h2><p>Latest completed scrape per marketplace. Every SKU and Pandamart branch is a separate observation. This list follows the filters above; CSV export includes all matching rows.</p></div>
      <button className="button secondary" onClick={()=>void loadSkuRows()} disabled={skuLoading}><RefreshCw size={15}/>{skuLoading?'Loading SKUs':'Refresh SKU data'}</button></div>
      {skuError && <div className="alert error">{skuError}</div>}
      <p><strong>{filteredSkuRows.length.toLocaleString()}</strong> matching SKU observations · <strong>{filteredSkuRows.filter(r=>r.status==='available').length}</strong> in stock · <strong>{filteredSkuRows.filter(r=>r.status==='unavailable').length}</strong> out of stock · <strong>{filteredSkuRows.filter(r=>r.status==='unknown').length}</strong> unknown</p>
      <div className="table-wrap" style={{maxHeight:560,overflow:'auto'}}><table className="central-summary-table"><thead><tr><th>Account</th><th>Branch</th><th>SKU</th><th>Product</th><th>Basepack</th><th>Brand</th><th>Status</th><th>Qty</th><th>Checked at</th><th>Evidence</th></tr></thead>
      <tbody>{filteredSkuRows.map((r,index)=><tr key={`${r.account_code}-${r.branch}-${r.account_sku}-${index}`}><td>{r.account_name}</td><td>{r.branch}</td><td>{r.account_sku}</td><td>{r.product_name}</td><td>{r.basepack}</td><td>{r.brand}</td><td><span className={`status ${r.status==='available'?'available':r.status==='unavailable'?'oos':'not-listed'}`}>{r.status==='available'?'In Stock':r.status==='unavailable'?'Out of Stock':'Unknown'}</span></td><td>{r.stock_qty ?? '—'}</td><td>{r.observed_at ? new Date(r.observed_at).toLocaleString():'—'}</td><td>{r.product_url?<a href={r.product_url} target="_blank" rel="noopener noreferrer">Listing</a>:'—'}</td></tr>)}
      {!filteredSkuRows.length && <tr><td colSpan={10} className="empty">{skuLoading?'Loading SKU observations…':'No SKU observations match the filters.'}</td></tr>}</tbody></table></div>
    </section> : tab==='overview' ? <>
      <section className="central-executive-kpis">
        <div className="central-exec-kpi primary"><div className="central-exec-icon"><Target size={18}/></div><span>Scope OLA</span><strong>{pct(executive.overall)}</strong><small>Average across valid scoped cells</small></div>
        <div className="central-exec-kpi"><div className="central-exec-icon good"><CheckCircle2 size={18}/></div><span>Fully available</span><strong>{executive.full.toLocaleString()}</strong><small>{executive.totalCells?pct(executive.full/executive.totalCells):'—'} of measured cells</small></div>
        <div className="central-exec-kpi"><div className="central-exec-icon amber"><Activity size={18}/></div><span>Partial coverage</span><strong>{executive.partial.toLocaleString()}</strong><small>Mostly Pandamart branch gaps</small></div>
        <div className="central-exec-kpi"><div className="central-exec-icon bad"><ShieldAlert size={18}/></div><span>Unavailable</span><strong>{executive.oos.toLocaleString()}</strong><small>{executive.totalCells?pct(executive.oos/executive.totalCells):'—'} of measured cells</small></div>
        <div className="central-exec-kpi"><div className="central-exec-icon"><Layers3 size={18}/></div><span>Basepacks in view</span><strong>{executive.uniqueBasepacks}</strong><small>Across {selectedAccounts.length} selected accounts</small></div>
        <div className="central-exec-kpi"><div className="central-exec-icon amber"><AlertTriangle size={18}/></div><span>Stale feeds</span><strong>{executive.stale.length}</strong><small>{executive.stale.length ? executive.stale.map((x)=>x.account_name).join(', ') : 'All feeds aligned within 1 day'}</small></div>
      </section>

      <section className="central-insight-strip">
        <div className="central-insight-title"><Sparkles size={18}/><div><span>Executive readout</span><strong>What deserves attention now</strong></div></div>
        <div className="central-insight-items">
          <div><span>Account gap</span><strong>{executive.weakest?.account_name ?? '—'} · {pct(executive.weakest?.score)}</strong><small>{executive.strongest && executive.weakest && executive.strongest.score!=null && executive.weakest.score!=null ? `${((executive.strongest.score-executive.weakest.score)*100).toFixed(1)}pp behind ${executive.strongest.account_name}` : 'Insufficient comparison data'}</small></div>
          <div><span>Brand risk</span><strong>{executive.riskiestBrand?.brand ?? '—'} · {pct(executive.riskiestBrand?.score)}</strong><small>{executive.riskiestBrand ? `${executive.riskiestBrand.basepacks} basepacks currently in this filtered scope` : 'No brand rows in scope'}</small></div>
          <div><span>Cross-account issue</span><strong>{criticalBasepacks[0]?.packsize ?? 'No critical gap'}</strong><small>{criticalBasepacks[0] ? `${criticalBasepacks[0].oos} OOS + ${criticalBasepacks[0].partial} partial account cells` : 'No basepack exceptions detected'}</small></div>
        </div>
      </section>

      <section className="central-visual-grid">
        <section className="card central-chart-card">
          <div className="card-head central-chart-head"><div><span className="central-chart-kicker">Account comparison</span><h2>OLA by account</h2><p>Click any account to isolate its business scope.</p></div><BarChart3 size={20}/></div>
          <div className="central-account-bars">
            {[...accountStats].sort((a,b)=>(b.score??0)-(a.score??0)).map((a,index)=><button key={a.account_code} onClick={()=>focusAccount(a.account_code)}>
              <div className="central-account-rank">{index+1}</div>
              <div className="central-account-bar-label"><strong>{a.account_name}</strong><small>{a.basepacks} scoped basepacks · {fmtDate(a.observation_date)}</small></div>
              <div className="central-account-bar-track"><span className={scoreBand(a.score)} style={{width:`${Math.max(2,(Number(a.score??0)*100/maxAccountScore)*100)}%`}}/></div>
              <div className="central-account-bar-value"><strong>{pct(a.score)}</strong><small>{a.oos} OOS</small></div>
            </button>)}
          </div>
        </section>

        <section className="card central-chart-card">
          <div className="card-head central-chart-head"><div><span className="central-chart-kicker">Portfolio health</span><h2>Availability composition</h2><p>How the currently measured account-basepack cells are distributed.</p></div><Activity size={20}/></div>
          <div className="central-composition">
            <div className="central-composition-donut" style={{background:`conic-gradient(#2bb673 0 ${executive.totalCells?executive.full/executive.totalCells*100:0}%, #efb447 0 ${executive.totalCells?(executive.full+executive.partial)/executive.totalCells*100:0}%, #df5a63 0 100%)`}}><div><strong>{executive.totalCells}</strong><span>measured cells</span></div></div>
            <div className="central-composition-legend">
              <div><i className="excellent"/><span>Fully available</span><strong>{executive.full}</strong><small>{executive.totalCells?pct(executive.full/executive.totalCells):'—'}</small></div>
              <div><i className="warning"/><span>Partial coverage</span><strong>{executive.partial}</strong><small>{executive.totalCells?pct(executive.partial/executive.totalCells):'—'}</small></div>
              <div><i className="critical"/><span>Unavailable</span><strong>{executive.oos}</strong><small>{executive.totalCells?pct(executive.oos/executive.totalCells):'—'}</small></div>
            </div>
          </div>
        </section>
      </section>

      <section className="central-visual-grid central-visual-grid-secondary">
        <section className="card central-chart-card">
          <div className="card-head central-chart-head"><div><span className="central-chart-kicker">Category pressure</span><h2>Lowest-performing categories</h2><p>Presentation view of where availability is weakest in the selected scope.</p></div></div>
          <div className="central-category-bars">
            {categorySummary.slice(0,8).map((c)=><button key={c.label} onClick={()=>setFilter('category',c.label)}>
              <div><strong>{c.label}</strong><small>{c.basepacks} basepacks</small></div>
              <div className="central-category-track"><span className={scoreBand(c.score)} style={{width:`${clampPct(c.score)}%`}}/></div>
              <b>{pct(c.score)}</b>
            </button>)}
            {!categorySummary.length && <div className="central-empty-chart">No category data in this scope.</div>}
          </div>
        </section>

        <section className="card central-chart-card">
          <div className="card-head central-chart-head"><div><span className="central-chart-kicker">Data confidence</span><h2>Account freshness</h2><p>Availability is only as useful as the latest source snapshot.</p></div></div>
          <div className="central-freshness-list">
            {accountStats.map((a)=>{const lag=dayDiff(executive.freshestDate,a.observation_date);return <div key={a.account_code}>
              <div><strong>{a.account_name}</strong><small>{fmtDate(a.observation_date)}</small></div>
              <div className="central-freshness-track"><span className={lag!=null&&lag>=2?'stale':''} style={{width:`${lag==null?0:Math.max(18,100-lag*18)}%`}}/></div>
              <span className={`central-freshness-label ${lag!=null&&lag>=2?'stale':''}`}>{lag==null?'No date':lag===0?'Freshest':lag===1?'1 day behind':`${lag} days behind`}</span>
            </div>})}
          </div>
        </section>
      </section>

      <section className="card central-risk-card">
        <div className="card-head"><div><span className="central-chart-kicker">Exception board</span><h2>Critical cross-account gaps</h2><p>Basepacks ranked by how many selected accounts are OOS or partially covered.</p></div><AlertTriangle size={20}/></div>
        <div className="central-risk-grid">
          {criticalBasepacks.map((b,index)=><button key={b.basepack_id} onClick={()=>setFilter('basepack',b.packsize)} className={index<3?'priority':''}>
            <div className="central-risk-rank">{String(index+1).padStart(2,'0')}</div>
            <div className="central-risk-copy"><span>{b.brand}</span><strong>{b.packsize}</strong><small>{b.category} · {b.subCategory}</small></div>
            <div className="central-risk-counts"><div className="bad"><b>{b.oos}</b><span>OOS</span></div><div className="amber"><b>{b.partial}</b><span>Partial</span></div><div><b>{b.scoped}</b><span>Scoped</span></div></div>
            <ArrowUpRight size={16}/>
          </button>)}
          {!criticalBasepacks.length && <div className="empty">No basepack exceptions in this scope.</div>}
        </div>
      </section>

      <section className="card central-heatmap-card">
        <div className="card-head"><div><span className="central-chart-kicker">Brand × account heatmap</span><h2>Where brand visibility is breaking</h2><p>Color-coded account OLA by brand. Lowest-performing brands appear first.</p></div></div>
        <div className="table-wrap">
          <table className="central-brand-heatmap"><thead><tr><th>Brand</th><th>Basepacks</th><th>Overall</th>{accountStats.map((a)=><th key={a.account_code}>{a.account_name}<small>{fmtDate(a.observation_date)}</small></th>)}</tr></thead>
          <tbody>{brandSummary.slice(0,30).map((b)=><tr key={b.brand}><td><button onClick={()=>setFilter('brand',b.brand)}>{b.brand}</button></td><td>{b.basepacks}</td><td><span className={`central-heat-cell ${scoreBand(b.score)}`}>{pct(b.score)}</span></td>{accountStats.map((a)=><td key={a.account_code}>{b.accountScores[a.account_code]==null?<span className="central-heat-cell neutral">—</span>:<span className={`central-heat-cell ${scoreBand(b.accountScores[a.account_code])}`}>{pct(b.accountScores[a.account_code])}</span>}</td>)}</tr>)}
          {!brandSummary.length&&<tr><td colSpan={3+accountStats.length} className="empty">No brands match the selected filters.</td></tr>}</tbody></table>
        </div>
      </section>
    </> : <section className="card pivot-card central-pivot-card-heavy">
      <div className="card-head pivot-head"><div><span className="central-chart-kicker">Analyst drill-down</span><h2>Availability matrix</h2><p>The operational truth underneath the executive visuals. Not-scoped cells remain separate from OOS.</p></div>
        <label className="pivot-dimension"><span>Rows</span><select value={pivotDimension} onChange={(e)=>setPivotDimension(e.target.value as PivotDimension)}><option value="brandBasepack">Brand → Basepack</option><option value="brand">Brand</option><option value="businessGroup">Business Unit</option><option value="category">Category</option><option value="subCategory">Sub-category</option></select></label>
      </div>
      {pivotDimension==='brandBasepack' ? <div className="table-wrap"><table className="matrix-table central-pivot-table central-pivot-table-heavy"><thead><tr><th className="sticky-col">Brand / Basepack</th>{accountStats.map((a)=><th key={a.account_code}>{a.account_name}<small>{fmtDate(a.observation_date)}</small></th>)}</tr></thead><tbody>
        {basepackMatrix.map((b,i)=>{
          const previousBrand = i>0 ? basepackMatrix[i-1].brand : null;
          return <tr key={b.basepack_id} className={previousBrand!==b.brand?'brand-start':''}><td className="sticky-col product-cell">{previousBrand!==b.brand&&<span className="pivot-brand-label">{b.brand}</span>}<strong>{b.packsize}</strong><span>{b.businessGroup} · {b.category} · {b.subCategory}</span></td>{accountStats.map((a)=>{const cell=b.cells.get(a.account_code);return <td key={a.account_code}>{!cell?<span className="status not-listed">Not scoped</span>:cell.account_code==='pandamart'?<><span className={`status ${cell.availability_score>0?'available':'oos'}`}>{cell.available_units}/{cell.expected_units} branches</span><div className={`central-matrix-score ${scoreBand(Number(cell.availability_score))}`}>{pct(Number(cell.availability_score))}</div></>:<><span className={`status ${cell.availability_score>0?'available':'oos'}`}>{cell.availability_score>0?'Available':'OOS'}</span><div className={`central-matrix-score ${scoreBand(Number(cell.availability_score))}`}>{Number(cell.stock_qty).toLocaleString()} units</div></>}</td>})}</tr>;
        })}
        {!basepackMatrix.length&&<tr><td colSpan={1+accountStats.length} className="empty">No rows match the selected filters.</td></tr>}</tbody></table></div>
      : <div className="table-wrap"><table className="central-summary-table central-summary-table-heavy"><thead><tr><th>{pivotDimension==='businessGroup'?'Business Unit':pivotDimension==='subCategory'?'Sub-category':pivotDimension[0].toUpperCase()+pivotDimension.slice(1)}</th><th>Basepacks</th><th>Overall</th>{accountStats.map((a)=><th key={a.account_code}>{a.account_name}</th>)}</tr></thead><tbody>{groupedPivot.map((g)=><tr key={g.label}><td><strong>{g.label}</strong></td><td>{g.basepacks}</td><td><span className={`central-heat-cell ${scoreBand(g.score)}`}>{pct(g.score)}</span></td>{accountStats.map((a)=><td key={a.account_code}>{g.accountScores[a.account_code]==null?'—':<span className={`central-heat-cell ${scoreBand(g.accountScores[a.account_code])}`}>{pct(g.accountScores[a.account_code])}</span>}</td>)}</tr>)}</tbody></table></div>}
    </section>}
  </div>;
}
