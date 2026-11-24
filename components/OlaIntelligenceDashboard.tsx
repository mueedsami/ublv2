'use client';

import Link from 'next/link';
import {useCallback,useEffect,useMemo,useState} from 'react';
import {ArrowDownToLine,ArrowLeft,ArrowRight,BarChart3,CalendarDays,RefreshCw,Search,TrendingDown} from 'lucide-react';
import type {OlaMonthAccount,OlaDay,OlaOverview} from '@/lib/ola-live-metrics';

type Previous={month:string;accounts:Array<{code:string;avg_ola_pct:number|null;valid_days:number}>};
type Payload=OlaOverview&{previous:Previous};
type Chosen={code:string;date:string}|null;
const group=['arogga','cartup','daraz','othoba','pandamart','shajgoj','shwapno'];
const percent=(n:number|null|undefined)=>n===null||n===undefined?'—':`${n.toFixed(1)}%`;
const comma=(n:number|null|undefined)=>n===null||n===undefined?'—':n.toLocaleString('en-US');
const todayMonth=()=>{const p=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Dhaka',year:'numeric',month:'2-digit'}).formatToParts(new Date());const f=(key:string)=>p.find(a=>a.type===key)?.value??'';return `${f('year')}-${f('month')}`;};
const shift=(month:string,amount:number)=>{const[y,m]=month.split('-').map(Number);const x=new Date(Date.UTC(y,m-1+amount,1));return `${x.getUTCFullYear()}-${String(x.getUTCMonth()+1).padStart(2,'0')}`;};
const labelMonth=(m:string)=>new Date(`${m}-01T12:00:00Z`).toLocaleString('en-US',{month:'long',year:'numeric',timeZone:'UTC'});
const labelDay=(d:string)=>new Date(`${d}T12:00:00Z`).toLocaleString('en-US',{day:'numeric',weekday:'short',timeZone:'UTC'});
const tone=(v:number|null)=>v===null?'none':v>=80?'good':v>=60?'warn':'bad';
function saveCSV(filename:string,rows:Array<Array<string|number|null|undefined>>){
  const csv='\uFEFF'+rows.map(row=>row.map(value=>{
    let text=String(value??'');if(/^[\s]*[=+@\-\t\r]/.test(text))text=`'${text}`;
    return `"${text.replaceAll('"','""')}"`;
  }).join(',')).join('\r\n');
  const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
  const link=document.createElement('a');link.href=url;link.download=filename;document.body.appendChild(link);link.click();link.remove();
  window.setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function Graph({data}:{data:OlaDay[]}){
  const W=800,H=180,L=38,R=13,T=16,B=29;
  const x=(i:number)=>L+(W-L-R)*(i/Math.max(1,data.length-1));
  const y=(v:number)=>T+(H-T-B)*(100-v)/100;
  let segment:Array<string>=[];const paths:Array<string[]>=[];
  const values=data.map((day,i)=>{
    if(day.ola_pct===null){if(segment.length)paths.push(segment);segment=[];return null;}
    const pt={x:x(i),y:y(day.ola_pct),d:day.date,v:day.ola_pct};segment.push(`${pt.x},${pt.y}`);return pt;
  });
  if(segment.length)paths.push(segment);
  return <svg viewBox={`0 0 ${W} ${H}`} className="olan-chart" aria-label="Daily availability line chart" role="img">
    {[0,25,50,75,100].map(v=><g key={v}><line x1={L} x2={W-R} y1={y(v)} y2={y(v)} stroke="#dce4f1" strokeDasharray="3 5"/><text x={L-7} y={y(v)+4} fill="#718096" fontSize="10" textAnchor="end">{v}</text></g>)}
    {paths.map((points,i)=>points.length>1?<polyline key={i} fill="none" stroke="#2563eb" strokeLinecap="round" strokeWidth="3" points={points.join(' ')}/>:null)}
    {values.map((p,i)=>p?<circle key={i} cx={p.x} cy={p.y} r="4" fill="#2563eb" stroke="white" strokeWidth="1.5"><title>{p.d} · {percent(p.v)}</title></circle>:null)}
    <text x={L} y={H-4} fill="#718096" fontSize="11">1 {data[0]?.date.slice(0,7)}</text><text x={W-R} y={H-4} textAnchor="end" fill="#718096" fontSize="11">{data.length} days</text>
  </svg>;
}
export default function OlaIntelligenceDashboard(){
  const[month,setMonth]=useState(todayMonth);
  const[data,setData]=useState<Payload|null>(null);
  const[busy,setBusy]=useState(true);
  const[error,setError]=useState('');
  const[version,setVersion]=useState(0);
  const[selected,setSelected]=useState<string[]>(group);
  const[showCatalog,setShowCatalog]=useState(false);
  const[search,setSearch]=useState('');
  const[focused,setFocused]=useState('daraz');
  const[detail,setDetail]=useState<Chosen>(null);
  useEffect(()=>{
    const abort=new AbortController();
    setBusy(true);setError('');setData(null);setDetail(null);
    fetch(`/api/ola/overview?month=${encodeURIComponent(month)}`,{signal:abort.signal,cache:'no-store'})
      .then(async response=>{
        const body=await response.json().catch(()=>({error:'The API did not return JSON.'}));
        if(!response.ok)throw new Error(`${body.error??'OLA API unavailable'}${body.hint?` — ${body.hint}`:''}`);
        if(!Array.isArray(body.accounts)||!Array.isArray(body.dates))throw new Error('The OLA API returned an incomplete report.');
        setData(body as Payload);
      })
      .catch(err=>{if(!abort.signal.aborted)setError(err instanceof Error?err.message:'Unable to fetch monthly OLA.');})
      .finally(()=>{if(!abort.signal.aborted)setBusy(false)});
    return ()=>abort.abort();
  },[month,version]);
  const all=data?.accounts??[];
  const available=all.filter(a=>showCatalog||!a.kind);
  const list=available.filter(a=>a.label.toLowerCase().includes(search.toLowerCase()));
  const displayed=list.filter(a=>selected.includes(a.code));
  const previous=new Map(data?.previous?.accounts.map(a=>[a.code,a.avg_ola_pct])??[]);
  const summary=useMemo(()=>[...displayed].sort((a,b)=>(b.avg_ola_pct??-1)-(a.avg_ola_pct??-1)),[displayed]);
  const sampled=displayed.filter(a=>a.avg_ola_pct!==null);
  const average=sampled.length?sampled.reduce((s,a)=>s+(a.avg_ola_pct??0),0)/sampled.length:null;
  const latestOos=displayed.reduce((s,a)=>s+(a.latest_unavailable??0),0);
  const validDays=displayed.reduce((s,a)=>s+a.valid_days,0);
  const eligibleDays=displayed.length*(data?.dates.filter(d=>d<=(data?.as_of??'')).length??0);
  const selectedCell=detail?all.find(a=>a.code===detail.code)?.rows.find(r=>r.date===detail.date):null;
  const graphAccount=displayed.find(a=>a.code===focused)??displayed[0];
  const graphData=graphAccount?.rows.filter(d=>d.date<=(data?.as_of??''))??[];
  const toggle=(code:string)=>setSelected(old=>old.includes(code)?old.filter(x=>x!==code):[...old,code]);
  const exportMatrix=()=>{
    if(!data)return;
    saveCSV(`UBL_OLA_Monthly_Matrix_${month}.csv`,[
      ['Date',...displayed.map(a=>a.label)],
      ...data.dates.map(date=>[date,...displayed.map(a=>a.rows.find(r=>r.date===date)?.ola_pct??null)]),
      ['Monthly mean (%)',...displayed.map(a=>a.avg_ola_pct)],
      ['Monthly weighted (%)',...displayed.map(a=>a.weighted_ola_pct)],
    ]);
  };
  const exportDetail=()=>{
    if(!data)return;
    saveCSV(`UBL_OLA_Daily_Audit_${month}.csv`,[
      ['Date','Account','Source','Available','OOS','Unknown','Checked','OLA (%)','Scrape status','Branches'],
      ...displayed.flatMap(a=>a.rows.filter(d=>d.status!==null).map(d=>[d.date,a.label,a.kind?'Catalog':'SKU observations',d.available,d.unavailable,d.unknown,d.checked,d.ola_pct,d.status,d.branches])),
    ]);
  };
  return <div className="olan-root">
    <header className="olan-head">
      <div><span className="olan-eyebrow">UBL · DIGITAL SHELF INTELLIGENCE</span><h1>Monthly Online Availability</h1><p>Daily account snapshots, OOS exceptions and month-to-date performance. Read directly from scraped OLA run history.</p></div>
      <div className="olan-actions"><button className="olan-icon" aria-label="Previous month" onClick={()=>setMonth(m=>shift(m,-1))}><ArrowLeft size={17}/></button>
        <label className="olan-month"><CalendarDays size={16}/><input aria-label="Report month" type="month" value={month} max={todayMonth()} onChange={(e:{target:{value:string}})=>e.target.value&&setMonth(e.target.value)}/></label>
        <button className="olan-icon" aria-label="Next month" disabled={month>=todayMonth()} onClick={()=>setMonth(m=>shift(m,1))}><ArrowRight size={17}/></button>
        <button className="olan-btn" disabled={busy} onClick={()=>setVersion(v=>v+1)}><RefreshCw size={15}/>{busy?'Loading':'Refresh'}</button>
      </div>
    </header>
    <nav className="olan-shortcuts" aria-label="OLA intelligence sections">
      <Link href="/ola/segments">Brand &amp; BU</Link><Link href="/ola/skus">SKU Intelligence</Link><Link href="/ola/branches">PandaMart Branches</Link><Link href="/ola/commercial">Commercial Intelligence</Link>
      <Link href="/central/basepack-compare">Basepack comparison</Link>
    </nav>
    {error&&<section className="olan-alert" role="alert"><strong>Couldn't load {labelMonth(month)}.</strong><p>{error}</p><button className="olan-btn" onClick={()=>setVersion(v=>v+1)}>Retry fetching</button></section>}
    {busy&&<section className="olan-loading">Reading daily OLA history from Supabase…</section>}
    {data&&<>
      <div className="olan-meta"><span>Reporting: <strong>{labelMonth(month)}</strong></span><span>Last day in source: <strong>{data.last_observation_date??'No data'}</strong></span><span>Checked through: {data.as_of} (BDT)</span><span>{data.selected_snapshots} selected account-day runs</span></div>
      <section className="olan-kpis">
        <article><span>Average account MTD OLA</span><strong>{percent(average)}</strong><small>Equal-weight mean of selected accounts</small></article>
        <article><span>Accounts reporting</span><strong>{sampled.length}<i> / {displayed.length}</i></strong><small>Accounts with confirmed OLA this month</small></article>
        <article><span>Latest observed OOS</span><strong>{comma(latestOos)}</strong><small>Sum of each selected account's last snapshot</small></article>
        <article><span>Account-day coverage</span><strong>{eligibleDays?percent(validDays/eligibleDays*100):'—'}</strong><small>{validDays} valid account-days of {eligibleDays} possible</small></article>
      </section>
      <section className="olan-card">
        <div className="olan-card-title"><div><span className="olan-eyebrow">REPORT CONTROLS</span><h2>Compare your accounts</h2><p>Choose the account columns. Catalog accounts are shown separately when enabled.</p></div><div className="olan-search"><Search size={15}/><input aria-label="Search accounts" value={search} onChange={(e:{target:{value:string}})=>setSearch(e.target.value)} placeholder="Find an account"/></div></div>
        <div className="olan-toggles"><label><input type="checkbox" checked={showCatalog} onChange={(e:{target:{checked:boolean}})=>setShowCatalog(e.target.checked)}/> Include catalog-only platforms</label><button onClick={()=>setSelected(available.map(a=>a.code))}>Select all</button><button onClick={()=>setSelected([])}>Clear</button></div>
        <div className="olan-pills">{list.map(a=><button key={a.code} aria-pressed={selected.includes(a.code)} className={selected.includes(a.code)?'active':''} onClick={()=>toggle(a.code)}>{a.label}{a.kind?<small>Catalog</small>:null}</button>)}</div>
      </section>
      <section className="olan-card">
        <div className="olan-card-title"><div><span className="olan-eyebrow">DAILY ACCOUNT MATRIX</span><h2>Availability — {labelMonth(month)}</h2><p>Rows are calendar days. Colors indicate confirmed OLA. Missing scrapes never count as zero.</p></div>
          <div className="olan-actions"><button className="olan-btn" disabled={!displayed.length} onClick={exportMatrix}><ArrowDownToLine size={16}/> Matrix CSV</button><button className="olan-btn" disabled={!displayed.length} onClick={exportDetail}><ArrowDownToLine size={16}/> Audit CSV</button></div></div>
        <div className="olan-tablewrap"><table className="olan-matrix"><thead><tr><th className="olan-first">Date</th>{displayed.map(a=><th key={a.code}><Link href={`/ola/${a.code}`}>{a.label}</Link></th>)}</tr></thead><tbody>{data.dates.map(date=><tr key={date}>
          <th className="olan-first">{labelDay(date)}<small>{date}</small></th>
          {displayed.map(a=>{const r=a.rows.find(row=>row.date===date);const p=r?.ola_pct??null;const selectedNow=detail?.code===a.code&&detail?.date===date;return <td key={a.code}><button className={`olan-cell ${tone(p)} ${selectedNow?'chosen':''}`} onClick={()=>setDetail({code:a.code,date})} title={`${a.label} · ${date} · ${percent(p)} · ${r?.status??'No scrape'}`}>
            {p===null?'—':percent(p)}{r?.status==='partial'?<small>partial</small>:null}
          </button></td>})}</tr>)}</tbody>
          <tfoot><tr><th className="olan-first">Monthly mean</th>{displayed.map(a=><th key={a.code} className="olan-footer">{percent(a.avg_ola_pct)}</th>)}</tr></tfoot>
        </table></div>
        {detail&&<div className="olan-detail"><strong>{all.find(a=>a.code===detail.code)?.label} · {detail.date}</strong><span>OLA: {percent(selectedCell?.ola_pct)}</span><span>Available: {comma(selectedCell?.available)}</span><span>OOS: {comma(selectedCell?.unavailable)}</span><span>Unknown: {comma(selectedCell?.unknown)}</span><span>Scrape: {selectedCell?.status??'No run'}</span><button onClick={()=>setDetail(null)} aria-label="Close details">Close</button></div>}
        {!displayed.length&&<div className="olan-empty">Select at least one account to display the matrix.</div>}
      </section>
      <section className="olan-grid">
        <div className="olan-card"><div className="olan-card-title"><div><span className="olan-eyebrow">DAY-BY-DAY TREND</span><h2>Availability trend</h2></div><select className="olan-select" value={graphAccount?.code??''} onChange={(e:{target:{value:string}})=>setFocused(e.target.value)}>{displayed.map(a=><option key={a.code} value={a.code}>{a.label}</option>)}</select></div>
          {graphData.length?<Graph data={graphData}/>:<div className="olan-empty">No selected account with plotted data.</div>}
          <p className="olan-note">Daily gaps mean no confirmed availability percentage. No interpolation.</p>
        </div>
        <div className="olan-card"><div className="olan-card-title"><div><span className="olan-eyebrow">DATA QUALITY</span><h2>Latest account snapshots</h2></div></div><div className="olan-quality">{displayed.map(a=><div key={a.code}><Link href={`/ola/${a.code}`}>{a.label}</Link><strong>{a.latest_date??'No run'}</strong><span>{a.valid_days}/{a.observed_days} valid days</span></div>)}</div></div>
      </section>
      <section className="olan-card"><div className="olan-card-title"><div><span className="olan-eyebrow">ACCOUNT BENCHMARKING</span><h2>Monthly performance</h2><p>Daily averages are not the same as weighted MTD OLA.</p></div></div>
      <div className="olan-tablewrap"><table className="olan-report"><thead><tr><th>Account</th><th>Daily mean</th><th>Weighted MTD</th><th>Previous month</th><th>Change</th><th>Valid days</th><th>Last observed</th><th>OOS (latest)</th></tr></thead><tbody>{summary.map(a=>{const prev=previous.get(a.code)??null;const delta=a.avg_ola_pct!==null&&prev!==null?a.avg_ola_pct-prev:null;return <tr key={a.code}>
        <td><Link href={`/ola/${a.code}`}>{a.label}</Link>{a.kind?<small>Catalog only</small>:null}</td><td><strong>{percent(a.avg_ola_pct)}</strong></td><td>{percent(a.weighted_ola_pct)}</td><td>{percent(prev)}</td><td className={delta!==null&&delta<0?'olan-down':'olan-up'}>{delta===null?'—':`${delta>0?'+':''}${delta.toFixed(1)} pp`}</td><td>{a.valid_days}/{a.observed_days}</td><td>{a.latest_date??'—'}</td><td>{comma(a.latest_unavailable)}</td>
      </tr>})}</tbody></table></div>{!summary.length&&<div className="olan-empty">Select accounts to see their performance.</div>}</section>
      <p className="olan-method"><BarChart3 size={16}/> {data.methodology} For the basepack aggregation, use the separate Basepack OLA Checker.</p>
    </>}
  </div>;
}
