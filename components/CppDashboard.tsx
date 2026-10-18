'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BadgeDollarSign,
  CheckCircle2,
  Clipboard,
  Clock3,
  RefreshCw,
  Search,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react';

type Target = {
  reference_set_id:string; source_file_name:string|null; effective_from:string; effective_to:string|null;
  account_code:string; account_name:string; target_id:string; account_sku:string; ubl_code:string|null;
  basepack_name:string|null; product_name:string|null; brand:string|null; category:string|null;
  expected_price:number; mrp:number|null; tolerance_pct:number; mapping_status:string|null; scrapable:boolean;
};
type Check = {
  check_id:string; run_id:string; run_date:string; checkpoint:'am'|'pm'|'manual'; revision:number; is_current:boolean;
  run_status:string; account_code:string; account_name:string; reference_set_id:string; target_id:string;
  account_sku:string; branch_code:string; branch_name:string|null; checked_at:string; product_name:string|null;
  target_product_name:string|null; basepack_name:string|null; brand:string|null; category:string|null;
  expected_price:number; actual_price:number|null; original_price:number|null; price_difference:number|null;
  over_expected_pct:number|null; in_stock:boolean|null; status:string; compliant:boolean|null; scraper_status:string|null;
  product_url:string|null; valid_price_check:boolean;
};
type Run = {
  run_id:string; account_code:string; account_name:string; run_date:string; checkpoint:string; revision:number;
  is_current:boolean; started_at:string; finished_at:string|null; status:string; rows_expected:number; rows_observed:number;
  rows_checked:number; ok_count:number; half_issue_count:number; issue_count:number; missing_count:number;
  unavailable_count:number; error_count:number; compliance_pct:number|null; worker_version:string|null; message:string|null;
};
type Reference = {
  reference_set_id:string; account_code:string; account_name:string; source_file_name:string|null; parser_profile:string|null;
  effective_from:string; effective_to:string|null; status:string; rows_total:number; rows_scrapable:number; rows_mapped:number;
  rows_unmapped:number; uploaded_at:string;
};
type Payload = { today:string; targets:Target[]; references:Reference[]; runs:Run[]; latest:Check[]; todayChecks:Check[] };

type StatusFilter = 'all'|'ok'|'half_issue'|'issue'|'unavailable'|'missing'|'error';
const SUPPORTED = [
  ['daraz','Daraz'],['pandamart','Pandamart'],['shajgoj','Shajgoj'],['othoba','Othoba'],['arogga','Arogga'],['shwapno','Shwapno'],
] as const;
const money = (value:number|null|undefined) => value == null ? '—' : `৳${Number(value).toLocaleString(undefined,{maximumFractionDigits:2})}`;
const dt = (value:string|null|undefined) => !value ? '—' : new Intl.DateTimeFormat('en-GB',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}).format(new Date(value));
const pct = (value:number|null|undefined) => value == null ? '—' : `${Number(value).toFixed(1)}%`;
const label = (value:string) => ({half_issue:'Within tolerance',ok:'OK',issue:'Issue',unavailable:'Unavailable',missing:'Missing',error:'Error'} as Record<string,string>)[value] || value;

export default function CppDashboard(){
  const [data,setData]=useState<Payload>({today:'',targets:[],references:[],runs:[],latest:[],todayChecks:[]});
  const [loading,setLoading]=useState(true),[error,setError]=useState(''),[account,setAccount]=useState('all');
  const [status,setStatus]=useState<StatusFilter>('all'),[search,setSearch]=useState(''),[copied,setCopied]=useState(false);

  async function load(){
    setLoading(true); setError('');
    try{
      const q=account==='all'?'':`?account=${encodeURIComponent(account)}`;
      const res=await fetch(`/api/cpp/report${q}`,{cache:'no-store'});
      const body=await res.json();
      if(!res.ok) throw new Error(body.error||'Failed to load CPP report.');
      setData(body);
    }catch(e){setError(e instanceof Error?e.message:'Failed to load CPP report.');}
    finally{setLoading(false);}
  }
  useEffect(()=>{void load();},[account]);

  const counts=useMemo(()=>{
    const c={ok:0,half_issue:0,issue:0,unavailable:0,missing:0,error:0,valid:0};
    data.latest.forEach(row=>{if(row.status in c)(c as any)[row.status]++;if(['ok','half_issue','issue'].includes(row.status))c.valid++;});
    return c;
  },[data.latest]);
  const compliance=counts.valid?((counts.ok+counts.half_issue)/counts.valid)*100:null;
  const filtered=useMemo(()=>{
    const q=search.trim().toLowerCase();
    return data.latest.filter(row=>(status==='all'||row.status===status)&&(!q||`${row.account_name} ${row.account_sku} ${row.product_name||''} ${row.target_product_name||''} ${row.basepack_name||''} ${row.brand||''} ${row.branch_name||''}`.toLowerCase().includes(q)));
  },[data.latest,status,search]);

  const byAccount=useMemo(()=>SUPPORTED.map(([code,name])=>{
    const targets=data.targets.filter(t=>t.account_code===code);
    const rows=data.latest.filter(t=>t.account_code===code);
    const run=data.runs.find(r=>r.account_code===code&&r.is_current);
    const valid=rows.filter(r=>['ok','half_issue','issue'].includes(r.status));
    const compliant=valid.filter(r=>r.status==='ok'||r.status==='half_issue').length;
    return {code,name,targetCount:targets.length,lastRun:run,checks:rows.length,compliance:valid.length?compliant/valid.length*100:null,issues:rows.filter(r=>r.status==='issue').length};
  }),[data]);

  const commandAccount=account==='all'?'all':account;
  const command=`.\\.venv\\Scripts\\python.exe -m scraper_worker.cli --accounts ${commandAccount} --checkpoint manual --target-source cpp`;
  async function copy(){await navigator.clipboard.writeText(command);setCopied(true);setTimeout(()=>setCopied(false),1400);}

  const matrix=useMemo(()=>{
    const map=new Map<string,{target:Target|null;account:string;branch:string;sku:string;product:string;expected:number;am?:Check;pm?:Check;manual?:Check;latest?:Check}>();
    data.todayChecks.forEach(c=>{
      const key=`${c.target_id}|${c.branch_code||''}`;
      const target=data.targets.find(t=>t.target_id===c.target_id)||null;
      const row=map.get(key)||{target,account:c.account_name,branch:c.branch_name||'All',sku:c.account_sku,product:c.target_product_name||c.product_name||c.basepack_name||'',expected:Number(c.expected_price)};
      if(c.checkpoint==='am')row.am=c; else if(c.checkpoint==='pm')row.pm=c; else row.manual=c;
      row.latest=c;
      map.set(key,row);
    });
    return [...map.values()].slice(0,300);
  },[data.todayChecks,data.targets]);

  return <div className="cpp-page">
    <div className="page-head cpp-head"><div><span className="eyebrow">Price compliance</span><h1>CPP Price Intelligence</h1><p>Active CPP SKU IDs are scraped directly, compared with the approved target price, and kept as an auditable AM/PM history.</p></div><button className="button secondary compact" onClick={()=>void load()} disabled={loading}><RefreshCw size={15}/>{loading?'Loading':'Refresh'}</button></div>
    {error?<div className="alert error"><AlertTriangle size={17}/>{error}</div>:null}

    <section className="cpp-account-tabs">{[['all','All'],...SUPPORTED].map(([code,name])=><button key={code} className={account===code?'active':''} onClick={()=>setAccount(code)}>{name}</button>)}</section>

    <section className="cpp-kpis">
      <div className="cpp-kpi hero"><span>Latest compliance</span><strong>{pct(compliance)}</strong><small>OK + within tolerance / valid price checks</small></div>
      <div className={`cpp-kpi ${counts.issue?'danger':'positive'}`}><span>Real price issues</span><strong>{counts.issue}</strong><small>Live selling price above allowed threshold</small></div>
      <div className="cpp-kpi"><span>Valid checks</span><strong>{counts.valid}</strong><small>{counts.ok} OK · {counts.half_issue} within tolerance</small></div>
      <div className={`cpp-kpi ${(counts.missing+counts.error)?'warning':''}`}><span>Not price-checkable</span><strong>{counts.missing+counts.unavailable+counts.error}</strong><small>{counts.missing} missing · {counts.unavailable} unavailable · {counts.error} errors</small></div>
    </section>

    <section className="card cpp-account-health"><div className="card-head"><div><h2>Account readiness</h2><p>Active CPP targets and the latest scraper position.</p></div><ShieldCheck size={18}/></div><div className="cpp-account-grid">{byAccount.map(row=><button key={row.code} onClick={()=>setAccount(row.code)} className={account===row.code?'active':''}><span>{row.name}</span><strong>{row.targetCount}</strong><small>active targets</small><div><b>{row.lastRun?row.lastRun.status:'Not run'}</b><em>{row.compliance==null?'—':`${row.compliance.toFixed(1)}% compliant`}</em></div>{row.issues?<i>{row.issues} issue{row.issues===1?'':'s'}</i>:null}</button>)}</div></section>

    <section className="cpp-grid-two">
      <div className="card cpp-run-card"><div className="card-head"><div><h2>Run CPP now</h2><p>The worker pulls the active CPP target IDs directly from Supabase. No daily SKU Excel is required.</p></div><BadgeDollarSign size={18}/></div><div className="cpp-command"><code>{command}</code><button onClick={()=>void copy()}><Clipboard size={14}/>{copied?'Copied':'Copy'}</button></div><div className="cpp-rule-line"><span><CheckCircle2 size={14}/> Live price ≤ CPP → OK</span><span>Within configured tolerance → Within tolerance</span><span><TriangleAlert size={14}/> Above tolerance → Issue</span></div></div>
      <div className="card cpp-reference-card"><div className="card-head"><div><h2>Live reference sets</h2><p>The approved monthly price file remains the source of truth.</p></div></div><div className="cpp-ref-list">{data.references.length?data.references.map(r=><div key={r.reference_set_id}><div><strong>{r.account_name}</strong><span>{r.source_file_name||r.parser_profile||'CPP reference'}</span></div><div><b>{r.rows_scrapable}</b><small>scrapable / {r.rows_total} rows</small></div></div>):<div className="empty">No active CPP reference in this scope.</div>}</div></div>
    </section>

    <section className="card cpp-filter-card"><div className="cpp-filter-head"><div><span className="eyebrow">Latest checks</span><strong>{filtered.length} results shown</strong></div><button className="account-reset-button" onClick={()=>{setSearch('');setStatus('all')}}>Reset</button></div><div className="cpp-filter-grid"><label><span>Search</span><div className="cpp-search"><Search size={14}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="SKU, product, brand or branch"/></div></label><label><span>Status</span><select value={status} onChange={e=>setStatus(e.target.value as StatusFilter)}><option value="all">All statuses</option><option value="ok">OK</option><option value="half_issue">Within tolerance</option><option value="issue">Issue</option><option value="unavailable">Unavailable</option><option value="missing">Missing</option><option value="error">Error</option></select></label></div></section>

    <section className="card cpp-results-card"><div className="card-head"><div><h2>Latest price position</h2><p>Current selling price versus approved CPP. Unavailable/missing/error rows stay outside the price-compliance denominator.</p></div></div><div className="table-wrap"><table className="cpp-table"><thead><tr><th>Account</th><th>Product / SKU</th><th>Branch</th><th>CPP</th><th>Live price</th><th>Difference</th><th>Status</th><th>Checked</th></tr></thead><tbody>{filtered.map(row=><tr key={row.check_id}><td><strong>{row.account_name}</strong></td><td><strong>{row.target_product_name||row.product_name||row.basepack_name||'—'}</strong><small>{row.account_sku}{row.brand?` · ${row.brand}`:''}</small></td><td>{row.branch_name||'All'}</td><td><strong>{money(row.expected_price)}</strong></td><td>{money(row.actual_price)}{row.original_price!=null&&row.original_price!==row.actual_price?<small>Original {money(row.original_price)}</small>:null}</td><td className={(row.price_difference??0)>0?'cpp-positive-delta':'cpp-good-delta'}>{row.price_difference==null?'—':`${row.price_difference>0?'+':''}${money(row.price_difference)}`}</td><td><span className={`cpp-status ${row.status}`}>{label(row.status)}</span></td><td>{dt(row.checked_at)}<small>{String(row.checkpoint).toUpperCase()}{row.revision>1?` r${row.revision}`:''}</small></td></tr>)}{!filtered.length?<tr><td colSpan={8} className="empty">{loading?'Loading CPP checks…':'No CPP checks in this view yet.'}</td></tr>:null}</tbody></table></div></section>

    {matrix.length?<section className="card cpp-results-card"><div className="card-head"><div><h2>Today&apos;s AM / PM matrix</h2><p>{data.today} · manual checks remain separate from the two scheduled checkpoints.</p></div></div><div className="table-wrap"><table className="cpp-table matrix"><thead><tr><th>Account</th><th>SKU / Product</th><th>Branch</th><th>CPP</th><th>AM</th><th>PM</th><th>Manual</th></tr></thead><tbody>{matrix.map((row,index)=><tr key={`${row.sku}-${row.branch}-${index}`}><td>{row.account}</td><td><strong>{row.product||'—'}</strong><small>{row.sku}</small></td><td>{row.branch}</td><td>{money(row.expected)}</td>{(['am','pm','manual'] as const).map(slot=>{const c=row[slot];return <td key={slot}>{c?<><strong>{money(c.actual_price)}</strong><span className={`cpp-status mini ${c.status}`}>{label(c.status)}</span></>:<span className="muted">—</span>}</td>})}</tr>)}</tbody></table></div></section>:null}

    <section className="card cpp-results-card"><div className="card-head"><div><h2>Recent CPP runs</h2><p>Every rerun creates a revision; historical runs remain auditable.</p></div><Clock3 size={18}/></div><div className="table-wrap"><table className="cpp-table runs"><thead><tr><th>Date</th><th>Account</th><th>Checkpoint</th><th>Status</th><th>Observed</th><th>OK</th><th>Within tol.</th><th>Issue</th><th>Unavailable</th><th>Missing</th><th>Error</th><th>Compliance</th></tr></thead><tbody>{data.runs.map(r=><tr key={r.run_id}><td>{r.run_date}</td><td><strong>{r.account_name}</strong></td><td>{String(r.checkpoint).toUpperCase()}{r.revision>1?` r${r.revision}`:''}</td><td>{r.status}</td><td>{r.rows_observed}/{r.rows_expected}</td><td>{r.ok_count}</td><td>{r.half_issue_count}</td><td>{r.issue_count}</td><td>{r.unavailable_count}</td><td>{r.missing_count}</td><td>{r.error_count}</td><td>{pct(r.compliance_pct)}</td></tr>)}{!data.runs.length?<tr><td colSpan={12} className="empty">No CPP runs recorded yet.</td></tr>:null}</tbody></table></div></section>
  </div>;
}
