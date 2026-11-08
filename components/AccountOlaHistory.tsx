'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Download, RefreshCw } from 'lucide-react';
import { exportCsv } from '@/lib/csv-export';

type Daily = {run_id:string; observation_date:string; run_status:string; checked_rows:number; available_rows:number; unavailable_rows:number; unknown_rows:number; ola_pct:number|null; branches_observed:number;finished_at:string|null};
type Monthly = {month:string; observed_days:number;valid_days:number;avg_ola_pct:number|null;min_ola_pct:number|null;max_ola_pct:number|null;first_date:string;last_date:string;unknown_rows:number};
type LegacyDaily = {stock_date:string;expected_basepacks:number;available_basepacks:number;unavailable_basepacks:number;ola_pct:number|null};
type LegacyMonthly = {month_start:string;days_with_data:number;avg_ola_pct:number|null;min_ola_pct:number|null;max_ola_pct:number|null;first_stock_date:string;last_stock_date:string};
const legacyPaths:Record<string,string>={daraz:'/api/daraz',shajgoj:'/api/shajgoj',pandamart:'/api/pandamart',othoba:'/api/othoba',foodi:'/api/foodi'};
const pct=(x:number|null|undefined)=>x==null?'—':`${Number(x).toFixed(2)}%`;
const n=(x:number|null|undefined)=>x==null?'—':Number(x).toLocaleString();
const date=(x:string|null|undefined)=>x?new Date(x.slice(0,10)+'T12:00:00').toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}):'—';
export default function AccountOlaHistory({account,label}:{account:string,label:string}){
 const[mode,setMode]=useState<'scraped'|'legacy'>('scraped');
 const[tab,setTab]=useState<'daily'|'monthly'>('daily');
 const[loading,setLoading]=useState(true),[error,setError]=useState('');
 const[daily,setDaily]=useState<Daily[]>([]),[monthly,setMonthly]=useState<Monthly[]>([]);
 const[legacyDaily,setLegacyDaily]=useState<LegacyDaily[]>([]),[legacyMonthly,setLegacyMonthly]=useState<LegacyMonthly[]>([]);
 const[search,setSearch]=useState('');
 const[month,setMonth]=useState('');
 async function load(){setLoading(true);setError('');try{
  const r=await fetch(`/api/ola/history?account=${encodeURIComponent(account)}`,{cache:'no-store'});
  const body=await r.json();if(!r.ok)throw new Error(body.error??'Failed to load scraped OLA');
  setDaily(body.daily??[]);setMonthly(body.monthly??[]);setMonth(prev=>prev||body.daily?.[0]?.observation_date?.slice(0,7)||new Date().toISOString().slice(0,7));
  if(legacyPaths[account]){
   const lr=await fetch(legacyPaths[account],{cache:'no-store'});
   if(lr.ok){const lb=await lr.json();setLegacyDaily(lb.daily??[]);setLegacyMonthly(lb.monthly??[]);}
  }
 }catch(e){setError(e instanceof Error?e.message:'Failed to load OLA')}finally{setLoading(false)}}
 useEffect(()=>{void load()},[account]);
 const selectedDaily=mode==='scraped'?daily.map(x=>({date:x.observation_date,available:x.available_rows,unavailable:x.unavailable_rows,unknown:x.unknown_rows,total:x.checked_rows,ola:x.ola_pct,status:x.run_status,branches:x.branches_observed})):legacyDaily.map(x=>({date:x.stock_date,available:x.available_basepacks,unavailable:x.unavailable_basepacks,unknown:null as number|null,total:x.expected_basepacks,ola:x.ola_pct,status:'uploaded',branches:null as number|null}));
 const selectedMonthly=mode==='scraped'?monthly.map(x=>({month:x.month,days:x.observed_days,valid:x.valid_days,avg:x.avg_ola_pct,min:x.min_ola_pct,max:x.max_ola_pct,start:x.first_date,end:x.last_date})):legacyMonthly.map(x=>({month:x.month_start?.slice(0,7),days:x.days_with_data,valid:x.days_with_data,avg:x.avg_ola_pct,min:x.min_ola_pct,max:x.max_ola_pct,start:x.first_stock_date,end:x.last_stock_date}));
 const months=useMemo(()=>[...new Set(selectedDaily.map(x=>x.date?.slice(0,7)).filter(Boolean))].sort().reverse(),[daily,legacyDaily,mode]);
 const filteredDaily=selectedDaily.filter(x=>x.date?.startsWith(month)&&(!search||x.date?.includes(search)));
 const filteredMonthly=selectedMonthly.filter(x=>x.month===month&&(!search||x.month?.includes(search)));
 const latest=selectedDaily.find(x=>x.date?.startsWith(month));const currentMonth=selectedMonthly.find(x=>x.month===month);
 const exportRows=()=>{if(tab==='daily')exportCsv(`${account}-${mode}-ola-daily`,filteredDaily.map(x=>({Date:x.date,Available:x.available,Unavailable:x.unavailable,Unknown:x.unknown,Total:x.total,OLA_pct:x.ola,Run_Status:x.status,Branches:x.branches})));else exportCsv(`${account}-${mode}-ola-monthly`,filteredMonthly.map(x=>({Month:x.month,Observed_Days:x.days,Valid_Days:x.valid,Average_OLA_pct:x.avg,Minimum_OLA_pct:x.min,Maximum_OLA_pct:x.max,From:x.start,Through:x.end})));};
 return <div className="account-intelligence-page pandamart-dashboard">
  <section className="account-command-card"><div className="account-command-top"><div className="pandamart-tabs account-tabs-heavy"><button className={mode==='scraped'?'active':''} onClick={()=>{setMode('scraped');setMonth(daily[0]?.observation_date?.slice(0,7)||'');}}>Scraped OLA</button>{legacyPaths[account]?<button className={mode==='legacy'?'active':''} onClick={()=>{setMode('legacy');setMonth(legacyDaily[0]?.stock_date?.slice(0,7)||'');}}>Historical uploaded OLA</button>:null}</div><button className="button secondary compact" onClick={()=>void load()} disabled={loading}><RefreshCw size={15}/>{loading?'Loading…':'Refresh'}</button></div>
  <div className="account-command-note"><span>{mode==='scraped'?'Source: independent marketplace scrapes. Latest successful run per observed day.':'Source: legacy sales/stock uploads, retained for reference. Does not influence scraped OLA.'}</span></div></section>
  {error?<div className="card" style={{padding:20,color:'#b91c1c'}}>{error}</div>:null}
  <section className="account-kpi-grid"><div className="account-kpi"><span>Latest observed OLA</span><strong>{pct(latest?.ola)}</strong><small>{latest?date(latest.date):'No observations yet'}</small></div><div className="account-kpi positive"><span>Available</span><strong>{n(latest?.available)}</strong><small>Confirmed in stock</small></div><div className="account-kpi warning"><span>Unavailable</span><strong>{n(latest?.unavailable)}</strong><small>Confirmed out of stock</small></div><div className="account-kpi"><span>Monthly average OLA</span><strong>{pct(currentMonth?.avg)}</strong><small>{currentMonth?`${currentMonth.days} observed day(s) · ${currentMonth.month}`:'No monthly history yet'}</small></div></section>
  {mode==='scraped'&&latest?<p style={{color:'var(--muted, #64748b)',fontSize:13}}>Latest unknown: <strong>{n(latest.unknown)}</strong>. Unknown results are not counted as out of stock or included in the confirmed-status OLA denominator.</p>:null}
  <section className="card account-filter-card"><div className="account-filter-head"><div><span className="eyebrow">{label} availability history</span><strong>{tab==='daily'?'Daily observations':'Monthly averages'}</strong></div><button className="button secondary compact" onClick={exportRows} disabled={tab==='daily'?!filteredDaily.length:!filteredMonthly.length}><Download size={15}/>Export CSV</button></div>
   <div className="account-filter-grid three"><div><label>View</label><select value={tab} onChange={e=>setTab(e.target.value as 'daily'|'monthly')}><option value="daily">Daily OLA</option><option value="monthly">Monthly OLA</option></select></div><div><label>Month</label><select value={month} onChange={e=>setMonth(e.target.value)}>{months.map(x=><option key={x} value={x}>{x}</option>)}</select></div><div><label>Search date / month</label><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="YYYY-MM"/></div></div>
  </section>

  <section className="card" style={{padding:20,marginTop:16}}><h2 style={{fontSize:18,margin:'0 0 5px'}}>Daily OLA trend — {month}</h2><p style={{color:'#64748b',fontSize:12,marginTop:0}}>Only observed days are plotted. Gaps mean no confirmed OLA for that day.</p><svg viewBox="0 0 700 180" role="img" aria-label="Daily OLA trend" style={{width:'100%',height:200}}>{[0,25,50,75,100].map(p=><g key={p}><line x1="37" x2="690" y1={145-p*1.25} y2={145-p*1.25} stroke="#e2e8f0" strokeDasharray="3 4"/><text x="30" y={149-p*1.25} fill="#64748b" fontSize="11" textAnchor="end">{p}</text></g>)}{(()=>{const days=filteredDaily.filter(d=>d.date).sort((a,b)=>a.date.localeCompare(b.date));const count=new Date(Number(month.slice(0,4)),Number(month.slice(5,7)),0).getDate()||31;const dayMap=new Map(days.map(r=>[Number(r.date.slice(8)),r]));const pts=Array.from({length:count},(_,i)=>{const r=dayMap.get(i+1);return !r||r.ola==null?null:{x:37+i*653/Math.max(count-1,1),y:145-Number(r.ola)*1.25,label:r.date,ola:r.ola};});const paths:string[][]=[];let seg:string[]=[];pts.forEach(p=>{if(!p){if(seg.length)paths.push(seg);seg=[];}else{seg.push(`${p.x},${p.y}`)}});if(seg.length)paths.push(seg);return <>{paths.map((ps,i)=>ps.length>1?<polyline key={i} points={ps.join(' ')} fill="none" stroke="#2563eb" strokeWidth="3"/>:null)}{pts.map((p,i)=>p?<circle key={i} cx={p.x} cy={p.y} r="4" fill="#2563eb"><title>{p.label}: {pct(Number(p.ola))}</title></circle>:null)}</>})()}<text x="37" y="173" fontSize="11" fill="#64748b">Day 1</text><text x="690" y="173" fontSize="11" textAnchor="end" fill="#64748b">End of month</text></svg></section>
  <section className="card account-table-card"><div className="card-head"><div><h2>{tab==='daily'?'Daily OLA records':'Monthly average OLA'}</h2><p>{mode==='scraped'?'Daily OLA = available ÷ (available + unavailable); monthly OLA is the arithmetic average of days with confirmed statuses.':'Original uploaded-stock OLA history; preserved separately from scraped availability.'}</p></div></div>
   <div className="table-wrap"><table className="account-rich-table"><thead>{tab==='daily'?<tr><th>Date</th><th>Available</th><th>Out</th><th>Unknown</th><th>Observed rows</th><th>OLA</th><th>Run status</th></tr>:<tr><th>Month</th><th>Observed days</th><th>Days with OLA</th><th>Average OLA</th><th>Min</th><th>Max</th><th>Window</th></tr>}</thead>
   <tbody>{tab==='daily'?filteredDaily.map((x,i)=><tr key={`${x.date}-${i}`}><td><strong>{date(x.date)}</strong></td><td>{n(x.available)}</td><td>{n(x.unavailable)}</td><td>{n(x.unknown)}</td><td>{n(x.total)}</td><td><strong>{pct(x.ola)}</strong></td><td>{x.status}</td></tr>):filteredMonthly.map((x,i)=><tr key={`${x.month}-${i}`}><td><strong>{x.month}</strong></td><td>{x.days}</td><td>{x.valid}</td><td><strong>{pct(x.avg)}</strong></td><td>{pct(x.min)}</td><td>{pct(x.max)}</td><td>{date(x.start)} – {date(x.end)}</td></tr>)}</tbody></table></div>
   {!(tab==='daily'?filteredDaily:filteredMonthly).length?<div className="empty">No OLA observations available for this period.</div>:null}
  </section><p style={{color:'var(--muted, #64748b)',fontSize:13}}>For account-level sales and inventory, visit <Link href={['daraz','pandamart','shajgoj','foodi','othoba'].includes(account)?`/${account}`:'/dashboard-report'}>Sales &amp; Stock</Link>. Central Availability continues to use the independent scraped source.</p>
 </div>;
}
