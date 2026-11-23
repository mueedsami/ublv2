'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, AlertTriangle, ArrowDownToLine, ChevronDown, ChevronRight, CircleCheck, RefreshCw, Search, Tag } from 'lucide-react';
import type { PriceMatrixData, BasepackComparison, ProductComparison, PlatformPrice, Severity } from '@/lib/price-compliance-matrix';
import './price-compliance.css';

const money = (n:number|null|undefined) => n===null || n===undefined ? '—' : `৳${n.toLocaleString('en-BD',{maximumFractionDigits:2})}`;
const pct = (n:number|null|undefined) => n===null || n===undefined ? '—' : `${n.toFixed(1)}%`;
const date = (s:string|null|undefined) => s ? new Date(s).toLocaleDateString('en-BD',{day:'2-digit',month:'short',year:'numeric',timeZone:'Asia/Dhaka'}) : 'No observations';
const states:Record<Severity,string> = {critical:'Large gap',warning:'Review',aligned:'Aligned',insufficient:'Insufficient data'};
const classFor = (state:Severity):string => `pcm-${state}`;

function Cell({cell, severity}: {cell:PlatformPrice|undefined; severity:Severity}) {
  if (!cell || cell.price === null) return <td className="pcm-empty-cell"><span>—</span><small>No captured price</small></td>;
  const effective = cell.excludedReason ? 'pcm-stale' : severity === 'insufficient' ? 'pcm-insufficient' : classFor(severity);
  return <td className={`pcm-price-cell ${effective}`} title={`${cell.listingCount} listing(s) • ${cell.branchCount} branch(es) • Last seen ${date(cell.observedAt)}${cell.url?` • ${cell.url}`:''}`}>
    <strong>{money(cell.price)}</strong>
    <small>{cell.excludedReason ? `${cell.excludedReason} · excluded` : cell.deviationPct!==null ? `${cell.deviationPct>0?'+':''}${cell.deviationPct.toFixed(1)}% vs median` : 'Only one fresh platform'}</small>
    {cell.branchCount>1 && <small className="pcm-branch-note">{money(cell.low)}–{money(cell.high)} · {cell.branchCount} branches</small>}
    {cell.listingCount>1 && cell.branchCount===1 && <small className="pcm-branch-note">{cell.listingCount} mapped listings</small>}
    {cell.url && <a href={cell.url} target="_blank" rel="noopener noreferrer" className="pcm-source-link" onClick={e=>e.stopPropagation()}>Product page</a>}
  </td>;
}

function ProductTable({bp, accounts}: {bp:BasepackComparison; accounts:PriceMatrixData['accounts']}) {
  return <div className="pcm-table-wrap">
    <table className="pcm-matrix-table">
      <thead><tr><th className="pcm-product-col">Mapped product / SKU</th>{accounts.map(a=><th key={a.code}>{a.name}</th>)}<th>Cross-platform spread</th></tr></thead>
      <tbody>{bp.products.map(product=><tr key={product.id}>
        <td className="pcm-product-col"><strong>{product.name}</strong><small>UBL SKU {product.ublCode} · {product.category}</small></td>
        {accounts.map(a=><Cell key={a.code} cell={product.platformPrices[a.code]} severity={product.severity}/>)}
        <td><div className={`pcm-flag ${classFor(product.severity)}`}>{states[product.severity]}</div>
          <strong className="pcm-spread">{pct(product.spreadPct)}</strong>
          <small className="pcm-muted">{product.comparablePlatforms} fresh platforms</small>
          {product.minPrice!==null && <small className="pcm-muted">{money(product.minPrice)} – {money(product.maxPrice)}</small>}
        </td>
      </tr>)}</tbody>
    </table>
  </div>;
}

export default function PriceCompliancePage() {
  const [data,setData]=useState<PriceMatrixData|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [days,setDays]=useState('14');
  const [threshold,setThreshold]=useState('10,20');
  const [query,setQuery]=useState('');
  const [brand,setBrand]=useState('all');
  const [severity,setSeverity]=useState('all');
  const [expanded,setExpanded]=useState<string[]>([]);
  const [visibleCodes,setVisibleCodes]=useState<string[]>([]);
  const [showColumns,setShowColumns]=useState(false);
  const [refreshKey,setRefreshKey]=useState(0);
  const requestPath=useMemo(()=>{
    const [warning,critical]=threshold.split(',');
    return `/api/price-compliance?days=${days}&warning=${warning}&critical=${critical}`;
  },[days,threshold]);
  useEffect(()=>{
    const controller=new AbortController();
    setLoading(true);setError('');
    fetch(requestPath,{cache:'no-store',signal:controller.signal})
      .then(async res=>{const json=await res.json(); if(!res.ok) throw new Error(json.error||`HTTP ${res.status}`); return json as PriceMatrixData;})
      .then(result=>{setData(result);setExpanded(result.basepacks.filter(bp=>bp.critical>0).slice(0,2).map(bp=>bp.id));setVisibleCodes(old=>old.length?old:result.accounts.map(a=>a.code));})
      .catch(e=>{if(!controller.signal.aborted)setError(e instanceof Error?e.message:'Failed to load scraped prices.');})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return ()=>controller.abort();
  },[requestPath,refreshKey]);
  const brands=useMemo(()=>[...new Set(data?.basepacks.map(bp=>bp.brand)||[])].sort(),[data]);
  const filtered=useMemo(()=>{
    const text=query.toLowerCase().trim();
    return (data?.basepacks||[]).filter(bp=>{
      if(brand!=='all' && bp.brand!==brand)return false;
      if(severity!=='all' && bp.severity!==severity)return false;
      if(text && ![bp.packsize,bp.brand,bp.category,...bp.products.flatMap(p=>[p.name,p.ublCode])].some(v=>v.toLowerCase().includes(text)))return false;
      return true;
    });
  },[data,query,brand,severity]);
  const visibleAccounts=useMemo(()=>data?.accounts.filter(a=>visibleCodes.includes(a.code))||[],[data,visibleCodes]);
  const toggle=useCallback((id:string)=>setExpanded(old=>old.includes(id)?old.filter(x=>x!==id):[...old,id]),[]);
  const exportXlsx=()=>{window.location.assign(`${requestPath}&format=xlsx`);};
  return <div className="page pcm-page">
    <header className="page-head">
      <div><div className="eyebrow">Digital shelf intelligence / Scraped pricing</div>
        <h1>Price Compliance Matrix</h1>
        <p>Find suspicious price gaps for the same mapped product across retail platforms. Independent of CPP.</p>
      </div>
      <div className="pcm-head-actions">
        <button className="button secondary" onClick={()=>setRefreshKey(x=>x+1)} disabled={loading}><RefreshCw size={16}/> Refresh</button>
        <button className="button" onClick={exportXlsx} disabled={loading||!data}><ArrowDownToLine size={16}/> Export matrix (.xlsx)</button>
      </div>
    </header>
    <nav className="pcm-layer-nav" aria-label="Price compliance views"><span className="pcm-layer-active">Cross-platform Price Gaps</span><Link href="/price-compliance/cpp-audit" className="pcm-layer-link">CPP Cross-check from Daily Scrape →</Link></nav>
    <div className="pcm-source-strip"><Tag size={16}/><span><strong>Source:</strong> OLA scraping prices · <strong>Latest accepted scrape:</strong> {date(data?.asOf)} · <strong>Lookback:</strong> {days} days (up to 4 latest successful runs/account)</span></div>
    {error && <div className="pcm-error"><AlertCircle size={18}/><span>{error}</span></div>}
    <section className="pcm-controls card">
      <div className="pcm-control-row">
        <label><span>Search product, basepack or SKU</span><div className="pcm-search"><Search size={16}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search all mapped products..."/></div></label>
        <label><span>Brand</span><select value={brand} onChange={e=>setBrand(e.target.value)}><option value="all">All brands</option>{brands.map(v=><option key={v} value={v}>{v}</option>)}</select></label>
        <label><span>Flag status</span><select value={severity} onChange={e=>setSeverity(e.target.value)}><option value="all">All statuses</option><option value="critical">Large gap</option><option value="warning">Review</option><option value="aligned">Aligned</option><option value="insufficient">Insufficient data</option></select></label>
        <label><span>Scrape lookback</span><select value={days} onChange={e=>setDays(e.target.value)}><option value="7">7 days</option><option value="14">14 days</option><option value="30">30 days</option></select></label>
        <label><span>Gap thresholds</span><select value={threshold} onChange={e=>setThreshold(e.target.value)}><option value="10,20">10% / 20%</option><option value="5,15">5% / 15%</option><option value="15,30">15% / 30%</option></select></label>
      </div>
      <div className="pcm-column-toggle"><button type="button" onClick={()=>setShowColumns(v=>!v)}><ChevronDown size={15}/> Platform columns ({visibleAccounts.length})</button>
        {showColumns&&<div className="pcm-column-list">{data?.accounts.map(a=><label key={a.code}><input type="checkbox" checked={visibleCodes.includes(a.code)} onChange={e=>setVisibleCodes(old=>e.target.checked?[...old,a.code]:old.filter(x=>x!==a.code))}/>{a.name}</label>)}</div>}
      </div>
    </section>
    <section className="pcm-kpis">
      <div className="pcm-kpi"><small>Products compared</small><strong>{loading?'…':data?.summary.products.toLocaleString()||0}</strong><span>Mapped active products</span></div>
      <div className="pcm-kpi pcm-critical"><small><AlertTriangle size={14}/> Large gaps</small><strong>{loading?'…':data?.summary.critical||0}</strong><span>≥ {data?.thresholdCritical??20}% spread</span></div>
      <div className="pcm-kpi pcm-warning"><small>Review</small><strong>{loading?'…':data?.summary.warning||0}</strong><span>≥ {data?.thresholdWarning??10}% spread</span></div>
      <div className="pcm-kpi pcm-aligned"><small><CircleCheck size={14}/> Aligned</small><strong>{loading?'…':data?.summary.aligned||0}</strong><span>Below warning threshold</span></div>
      <div className="pcm-kpi"><small>Insufficient data</small><strong>{loading?'…':data?.summary.insufficient||0}</strong><span>Under 2 fresh platforms</span></div>
    </section>
    <div className="pcm-legend"><span><i className="pcm-key pcm-key-critical"/> Red: ≥ critical spread</span><span><i className="pcm-key pcm-key-warning"/> Amber: review gap</span><span><i className="pcm-key pcm-key-aligned"/> Green: prices aligned</span><span><i className="pcm-key pcm-key-muted"/> Grey: missing or stale</span></div>
    <section className="card pcm-results">
      <div className="card-head"><div><h2>Basepack → Product → Platform price</h2><p>{filtered.length} basepacks shown · Expand to compare exact SKUs.</p></div></div>
      {loading?<div className="empty">Reading current scraper data and master SKU mappings…</div>:
       !data?<div className="empty">Price information unavailable.</div>:
       filtered.length===0?<div className="empty">No basepacks match your filters.</div>:
       <div className="pcm-groups">{filtered.map(bp=><div className="pcm-group" key={bp.id}>
          <button type="button" className="pcm-group-head" onClick={()=>toggle(bp.id)} aria-expanded={expanded.includes(bp.id)}>
            {expanded.includes(bp.id)?<ChevronDown size={18}/>:<ChevronRight size={18}/>}
            <span className="pcm-group-name"><strong>{bp.packsize}</strong><small>{bp.brand} · {bp.category} · {bp.products.length} mapped product{bp.products.length===1?'':'s'}</small></span>
            <span className="pcm-group-badges"><span className={`pcm-flag ${classFor(bp.severity)}`}>{bp.severity==='critical'?`${bp.critical} large gap${bp.critical===1?'':'s'}`:states[bp.severity]}</span>{bp.warning>0&&<span className="pcm-flag pcm-warning">{bp.warning} review</span>}</span>
          </button>
          {expanded.includes(bp.id)&&<ProductTable bp={bp} accounts={visibleAccounts}/>}
        </div>)}</div>}
    </section>
    {data && <div className="pcm-footnote"><strong>How the flags work:</strong> prices come exclusively from <code>ola_scrape_observations.price</code>, matched by account SKU to the master product and basepack. The red/amber threshold uses (highest − lowest) ÷ lowest price among fresh platform observations for the <strong>same exact product</strong>. Platform prices with multiple branch/listing observations use their median; the branch range remains visible. Prices older than 72 hours relative to now or the latest accepted scraper snapshot, and OOS/stock-unknown prices, are excluded from flag calculations. Missing, unmapped and stale prices are never counted as zero. A gap is an investigation flag, not proof of incorrect pricing or a CPP violation. <strong>Mapped price records:</strong> {data.summary.mappedPriceRows.toLocaleString()} · <strong>Unmapped:</strong> {data.summary.unmappedPriceRows.toLocaleString()} · <strong>Ambiguous:</strong> {data.summary.ambiguousPriceRows.toLocaleString()}.</div>}
  </div>;
}
