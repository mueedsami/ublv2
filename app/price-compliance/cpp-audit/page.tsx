'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowDownToLine, RefreshCw, Search, AlertTriangle, CircleCheck, CalendarClock } from 'lucide-react';
import type {AuditData,AuditRow,AuditStatus} from '@/lib/scraped-cpp-audit';
import '../price-compliance.css';
import './cpp-audit.css';

const money=(x:number|null)=>x===null?'—':`৳${x.toLocaleString('en-BD',{maximumFractionDigits:2})}`;
const percentage=(x:number|null)=>x===null?'—':`${x.toFixed(2)}%`;
const when=(x:string|null)=>x?new Date(x).toLocaleString('en-BD',{timeZone:'Asia/Dhaka',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}):'—';
const statuses:Record<AuditStatus,string>={
  violation:'CPP violation',within_tolerance:'Within tolerance',compliant:'Compliant',reference_expired:'Expired CPP reference',
  reference_future:'Reference not effective',ambiguous_cpp:'Conflicting CPP entries',invalid_reference:'Invalid expected price',
  not_scraped:'No daily scrape',missing_price:'Price unavailable',unavailable:'Product OOS',unknown_stock:'Stock unknown',stale:'Stale scrape'
};
const colors:Record<AuditStatus,string>={
  violation:'bad',within_tolerance:'caution',compliant:'good',reference_expired:'muted',
  reference_future:'muted',ambiguous_cpp:'muted',invalid_reference:'muted',not_scraped:'muted',missing_price:'muted',
  unavailable:'muted',unknown_stock:'muted',stale:'muted'
};
const selectStatuses=[
  ['all','All CPP-listed SKUs'],['violation','Violations only'],['review','Violations + tolerance'],
  ['exceptions','Missing / expired / excluded'],['compliant','Compliant only']
];
function validFilter(r:AuditRow,f:string){
  if(f==='violation')return r.status==='violation';
  if(f==='review')return r.status==='violation'||r.status==='within_tolerance';
  if(f==='compliant')return r.status==='compliant';
  if(f==='exceptions')return !['violation','within_tolerance','compliant'].includes(r.status);
  return true;
}

export default function DailyCppCrosscheckPage(){
  const [data,setData]=useState<AuditData|null>(null);
  const [account,setAccount]=useState('all');
  const [status,setStatus]=useState('all');
  const [search,setSearch]=useState('');
  const [reload,setReload]=useState(0);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const path=`/api/price-compliance/cpp-audit`;
  useEffect(()=>{
    const controller=new AbortController();setLoading(true);setError('');
    fetch(path,{cache:'no-store',signal:controller.signal})
      .then(async res=>{const json=await res.json();if(!res.ok)throw new Error(json.error||`HTTP ${res.status}`);return json as AuditData;})
      .then(setData)
      .catch(e=>{if(!controller.signal.aborted)setError(e instanceof Error?e.message:'Failed to load CPP cross-check.');})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return ()=>controller.abort();
  },[reload]);
  const rows=useMemo(()=>data?.rows.filter(r=>
    (account==='all'||r.accountCode===account)&&validFilter(r,status)&&
    [r.account,r.accountSku,r.productName,r.ublCode,r.basepack,r.brand].some(v=>v.toLowerCase().includes(search.trim().toLowerCase()))
  )||[],[data,account,status,search]);
  const exportXlsx=()=>window.location.assign(`${path}&format=xlsx&status=${encodeURIComponent(status)}&account=${encodeURIComponent(account)}&search=${encodeURIComponent(search)}`);
  return <div className="page pcm-page cpp-audit-page">
    <header className="page-head"><div><div className="eyebrow">Digital shelf intelligence / Price compliance</div>
      <h1>Daily Scrape × CPP Cross-check</h1>
      <p>Compare each retailer's daily scraped SKU price against that same retailer's uploaded CPP reference. Only account-specific CPP-listed SKUs are included.</p>
    </div><div className="pcm-head-actions">
      <button className="button secondary" type="button" disabled={loading} onClick={()=>setReload(x=>x+1)}><RefreshCw size={16}/> Refresh</button>
      <button className="button" type="button" disabled={loading||!data} onClick={exportXlsx}><ArrowDownToLine size={16}/> Download cross-check (.xlsx)</button>
    </div></header>
    <nav className="pcm-layer-nav" aria-label="Price compliance views"><Link href="/price-compliance" className="pcm-layer-link">← Cross-platform Price Gaps</Link><span className="pcm-layer-active">CPP Cross-check from Daily Scrape</span></nav>
    <div className="pcm-source-strip"><CalendarClock size={16}/><span>Read-only: price from <strong>daily OLA scrape</strong>, expected price and tolerance from <strong>existing CPP references</strong>. No CPP scraper runs are triggered. Checking <strong>{data?.reportDate||"today"}</strong> (Bangladesh time) only. No previous-day scrape fallback.</span></div>
    {error&&<div className="pcm-error"><AlertTriangle size={17}/>{error}</div>}
    <section className="cpp-audit-kpis">
      <div className="cpp-audit-kpi"><small>CPP-listed account SKUs</small><strong>{loading?'…':data?.summary.cppSkus??0}</strong><span>{data?.summary.cppAccounts??0} account references</span></div>
      <div className="cpp-audit-kpi good"><small><CircleCheck size={14}/> Compliant</small><strong>{loading?'…':data?.summary.compliant??0}</strong><span>At or under reference price</span></div>
      <div className="cpp-audit-kpi caution"><small>Within tolerance</small><strong>{loading?'…':data?.summary.withinTolerance??0}</strong><span>Over reference, inside permitted margin</span></div>
      <div className="cpp-audit-kpi bad"><small><AlertTriangle size={14}/> CPP violations</small><strong>{loading?'…':data?.summary.violations??0}</strong><span>Above reference + tolerance</span></div>
      <div className="cpp-audit-kpi"><small>Not evaluated</small><strong>{loading?'…':data?.summary.exceptions??0}</strong><span>No scrape today, missing, OOS, expired, etc.</span></div>
    </section>
    <section className="card cpp-audit-controls"><div className="cpp-audit-filters" style={{gridTemplateColumns:"repeat(3,minmax(180px,1fr))"}}>
      <label><span>Product / SKU / Basepack</span><div className="pcm-search"><Search size={15}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search priority checks..."/></div></label>
      <label><span>Account</span><select value={account} onChange={e=>setAccount(e.target.value)}><option value="all">All CPP accounts</option>{data?.accounts.map(a=><option key={a.code} value={a.code}>{a.name}</option>)}</select></label>
      <label><span>Result</span><select value={status} onChange={e=>setStatus(e.target.value)}>{selectStatuses.map(([value,title])=><option value={value} key={value}>{title}</option>)}</select></label>
      
    </div></section>
    <section className="card cpp-audit-account-summary"><div className="card-head"><div><h2>CPP account coverage</h2><p>The reference must be valid on the scrape date. Unmatched scrape SKUs are excluded.</p></div></div>
      <div className="cpp-audit-scroll"><table><thead><tr><th>Account</th><th>CPP SKU IDs</th><th>Evaluated</th><th>Violations</th><th>Within tolerance</th><th>Not evaluated</th><th>Reference period</th><th>Latest scrape</th></tr></thead><tbody>
        {data?.accounts.map(a=><tr key={a.code}><td><strong>{a.name}</strong><small>{a.referenceFile}</small></td><td>{a.targetSkus}</td><td>{a.checked}</td><td className="cpp-audit-number-bad">{a.violations}</td><td>{a.withinTolerance}</td><td>{a.exceptions}</td><td>{a.referenceFrom||'—'} – {a.referenceTo||'Open'}</td><td>{when(a.latestScrape)}</td></tr>)}
      </tbody></table></div>
    </section>
    <section className="card cpp-audit-results"><div className="card-head"><div><h2>Account SKU × CPP expected price</h2><p>{loading?'Loading…':`${rows.length.toLocaleString()} rows shown. Each comparison uses its own account and SKU ID; branch rows are separate where relevant.`}</p></div></div>
      <div className="cpp-audit-scroll"><table><thead><tr><th>Account / SKU</th><th>Product / Basepack</th><th>CPP reference</th><th>Daily scraped price</th><th>Difference</th><th>Status</th><th>Scraped at</th></tr></thead><tbody>
        {rows.map(r=><tr key={r.id}><td><strong>{r.account}</strong><small className="mono">{r.accountSku}{r.branch!=='All'?` · ${r.branch}`:''}</small></td>
          <td><strong>{r.productName}</strong><small>{r.basepack}</small>{r.mappingNote&&<small className="cpp-audit-hint">{r.mappingNote}</small>}</td>
          <td><strong>{money(r.expectedPrice)}</strong><small>Allowed max: {money(r.allowedPrice)} ({r.tolerancePct.toFixed(2)}%)</small></td>
          <td><strong>{money(r.scrapedPrice)}</strong>{r.productUrl&&<a href={r.productUrl} target="_blank" rel="noopener noreferrer">View listing</a>}</td>
          <td><strong>{money(r.difference)}</strong><small>{percentage(r.deviationPct)}</small></td>
          <td><span className={`cpp-audit-status ${colors[r.status]}`}>{statuses[r.status]}</span></td><td>{when(r.checkedAt)}</td>
        </tr>)}
        {!loading&&rows.length===0&&<tr><td colSpan={7} className="cpp-audit-empty">No matching CPP checks for today. Confirm today’s scrape completed or adjust the account and status filters.</td></tr>}
      </tbody></table></div>
    </section>
    <div className="pcm-footnote"><strong>Rule:</strong> Daily scraped price ≤ CPP expected = compliant; higher but ≤ expected × (1 + account target tolerance) = within tolerance; higher still = violation. <strong>Not evaluated:</strong> expired CPP references, missing or conflicting reference entries, no scrape today, OOS/unknown stock, or missing price. Older scraped prices are never carried forward. Pricing from non-CPP-listed SKUs is never treated as a CPP issue. <strong>Ignored scraped account-SKU pairs:</strong> {data?.summary.excludedScrapeSkus??'—'}. <strong>CPP reference rows without retailer SKU ID:</strong> {data?.summary.cppRowsWithoutSku??'—'} (cannot be matched safely). The existing CPP page and database records are unchanged.</div>
  </div>;
}
