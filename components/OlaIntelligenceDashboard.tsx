'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowDownRight, ArrowUpRight, CalendarDays, Check, ChevronLeft, ChevronRight, Download, RefreshCw, Search, SlidersHorizontal } from 'lucide-react';

type Day = { date:string; ola_pct:number|null; available:number|null; unavailable:number|null; unknown:number|null; checked:number|null; status:string|null };
type Account = { code:string; label:string; kind?:string; rows:Day[]; observed_days:number; valid_days:number; avg_ola_pct:number|null };
type Overview = { month:string; dates:string[]; accounts:Account[]; methodology:string };
type AccountData = { code:string; label:string; kind?:string; days:Day[]; latest:Day|null; mean:number|null; previousMean:number|null; delta:number|null; validDays:number; possibleDays:number };
type Week = { key:string; start:string; end:string; label:string; values:Record<string,number|null>; counts:Record<string,number> };
const fmt = (v:number|null|undefined, digits=1) => v==null?'—':`${v.toFixed(digits)}%`;
const monthNow = () => { const parts=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Dhaka',year:'numeric',month:'2-digit'}).formatToParts(new Date()); return `${parts.find(p=>p.type==='year')?.value}-${parts.find(p=>p.type==='month')?.value}`; };
const monthShift = (month:string,diff:number) => { const [y,m]=month.split('-').map(Number); const dt=new Date(Date.UTC(y,m-1+diff,1)); return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth()+1).padStart(2,'0')}`; };
const utcDay=(d:string)=>new Date(`${d}T12:00:00Z`);
const dayString=(d:Date)=>d.toISOString().slice(0,10);
const offsetDays=(date:string,n:number)=>{const d=utcDay(date);d.setUTCDate(d.getUTCDate()+n);return dayString(d);};
const monday=(date:string)=>offsetDays(date,-((utcDay(date).getUTCDay()+6)%7));
const avg=(vals:number[])=> vals.length?vals.reduce((a,b)=>a+b,0)/vals.length:null;
const clean=(v:number|null|undefined)=>v==null?'':v.toFixed(2);
const COLORS=['#2563eb','#0d9488','#a855f7','#e08b2f','#db4b65','#4f75a0','#16a34a','#8b5cf6','#64748b','#c084fc'];
const colorFor=(code:string,all:AccountData[])=>COLORS[Math.max(0,all.findIndex(a=>a.code===code))%COLORS.length];
const download=(name:string,rows:(string|number|null|undefined)[][])=>{
 const s='\uFEFF'+rows.map(row=>row.map(v=>`"${String(v??'').replace(/^[=+@\-\t\r]/,m=>`'${m}`).replace(/"/g,'""')}"`).join(',')).join('\r\n');
 const blob=new Blob([s],{type:'text/csv;charset=utf-8'});const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download=name;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),500);
};
function Delta({value}:{value:number|null}){if(value===null)return <span className="olai-muted">No comparison</span>;return <span className={`olai-delta ${value>0.01?'up':value< -0.01?'down':'flat'}`}>{value>0.01?<ArrowUpRight size={14}/>:value< -0.01?<ArrowDownRight size={14}/>:null}{value>0?'+':''}{value.toFixed(1)} pp</span>}
function TrendChart({weeks,accounts}:{weeks:Week[];accounts:AccountData[]}){
 const width=850,height=260,l=45,r=14,t=16,b=38;
 const x=(i:number)=>l+(width-l-r)*(weeks.length<=1?0.5:i/(weeks.length-1));
 const y=(v:number)=>t+(height-t-b)*(1-v/100);
 return <div className="olai-chart-scroll"><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Eight-week account OLA comparison; missing weeks are omitted" className="olai-line-svg">
  {[0,25,50,75,100].map(v=><g key={v}><line x1={l} y1={y(v)} x2={width-r} y2={y(v)} stroke="#dce5ee" strokeDasharray="4 5"/><text x={l-9} y={y(v)+4} fill="#728197" fontSize="12" textAnchor="end">{v}%</text></g>)}
  {weeks.map((week,i)=><text key={week.key} x={x(i)} y={height-12} fill="#728197" fontSize="11" textAnchor="middle">{week.label}</text>)}
  {accounts.map(a=>{const segments:string[][]=[];let active:string[]=[];weeks.forEach((w,i)=>{const n=w.values[a.code];if(n===null){if(active.length)segments.push(active);active=[];}else active.push(`${x(i)},${y(n)}`);});if(active.length)segments.push(active);return <g key={a.code}>
   {segments.map((s,i)=>s.length>1?<polyline key={i} points={s.join(' ')} fill="none" stroke={colorFor(a.code,accounts)} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>:null)}
   {weeks.map((w,i)=>w.values[a.code]===null?null:<circle key={w.key} cx={x(i)} cy={y(w.values[a.code]!)} r="4.4" fill={colorFor(a.code,accounts)} stroke="white" strokeWidth="1.5"><title>{a.label} · {w.start} to {w.end}: {fmt(w.values[a.code])} ({w.counts[a.code]} observed days)</title></circle>)}
  </g>})}
 </svg></div>;
}
function ShareBar({available,unavailable,unknown}:{available:number;unavailable:number;unknown:number}){const all=available+unavailable+unknown;return <div className="olai-stackbar" role="img" aria-label={`${available} available, ${unavailable} OOS, ${unknown} unknown`}>
  {all===0?<span className="olai-stackempty"/>:<><span style={{width:`${available/all*100}%`,background:'#23a274'}}/><span style={{width:`${unavailable/all*100}%`,background:'#dc5265'}}/><span style={{width:`${unknown/all*100}%`,background:'#a6b5c9'}}/></>}
 </div>}
export default function OlaIntelligenceDashboard(){
 const[month,setMonth]=useState(monthNow);const[response,setResponse]=useState<{current:Overview;previous:Overview;earlier:Overview}|null>(null);const[loading,setLoading]=useState(true);const[error,setError]=useState('');const[chosen,setChosen]=useState<string[]>([]);const[initialized,setInitialized]=useState(false);const[query,setQuery]=useState('');const[showCatalog,setShowCatalog]=useState(false);
 const load=useCallback(async()=>{setLoading(true);setError('');try{
  const months=[month,monthShift(month,-1),monthShift(month,-2)];const result=await Promise.all(months.map(async m=>{const r=await fetch(`/api/ola/overview?month=${m}`,{cache:'no-store'});const body=await r.json();if(!r.ok)throw new Error(body.error||`Could not load OLA for ${m}`);return body as Overview;}));setResponse({current:result[0],previous:result[1],earlier:result[2]});
 }catch(e){setError(e instanceof Error?e.message:'Cannot load OLA information');setResponse(null);}finally{setLoading(false)}},[month]);
 useEffect(()=>{void load()},[load]);
 const localParts=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Dhaka',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
 const todayDhaka=`${localParts.find(p=>p.type==='year')?.value}-${localParts.find(p=>p.type==='month')?.value}-${localParts.find(p=>p.type==='day')?.value}`;
 const periodEnd=month===monthNow()?todayDhaka:offsetDays(`${monthShift(month,1)}-01`,-1);
 const monthStart=`${month}-01`;
 const previousMonthStart=`${monthShift(month,-2)}-01`;
 const accounts=useMemo<AccountData[]>(()=>{
  if(!response)return [];
  return response.current.accounts.map(acc=>{
   const p=response.previous.accounts.find(x=>x.code===acc.code);
   const earlier=response.earlier.accounts.find(x=>x.code===acc.code);
   const days=[...(earlier?.rows??[]),...(p?.rows??[]),...acc.rows].filter(d=>d.date<=periodEnd&&d.date>=previousMonthStart).sort((a,b)=>a.date.localeCompare(b.date));
   const validMonth=acc.rows.filter(d=>d.date<=periodEnd&&d.ola_pct!==null).map(d=>Number(d.ola_pct));
   const lastMonth=(p?.rows??[]).filter(d=>d.ola_pct!==null).map(d=>Number(d.ola_pct));
   const mean=avg(validMonth),previousMean=avg(lastMonth);
   const latest=[...acc.rows].filter(x=>x.date<=periodEnd&&x.status!==null).sort((a,b)=>b.date.localeCompare(a.date))[0]??null;
   const possibleDays=Math.max(0,Number(periodEnd.slice(8)));
   return {code:acc.code,label:acc.label,kind:acc.kind,days,latest,mean,previousMean,delta:mean!==null&&previousMean!==null?mean-previousMean:null,validDays:validMonth.length,possibleDays};
  });
 },[response,periodEnd,previousMonthStart]);
 useEffect(()=>{if(!response||initialized)return;setChosen(accounts.filter(a=>a.kind!=='catalog'&&a.days.some(d=>d.ola_pct!==null)).map(a=>a.code));setInitialized(true);},[response,accounts,initialized]);
 const visible=accounts.filter(a=>(showCatalog||a.kind!=='catalog')&&(chosen.includes(a.code)));
 const selectable=accounts.filter(a=>showCatalog||a.kind!=='catalog');
 const weeks=useMemo<Week[]>(()=>{
  const end=monday(periodEnd);const starts=Array.from({length:8},(_,i)=>offsetDays(end,(i-7)*7));
  return starts.map(start=>{const stop=offsetDays(start,6);const values:Record<string,number|null>={};const counts:Record<string,number>={};for(const a of accounts){const valid=a.days.filter(d=>d.date>=start&&d.date<=stop&&d.date<=periodEnd&&d.ola_pct!==null).map(d=>d.ola_pct!);values[a.code]=avg(valid);counts[a.code]=valid.length;}return {key:start,start,end:stop,label:new Date(start+'T12:00:00Z').toLocaleDateString('en-US',{month:'short',day:'numeric',timeZone:'UTC'}),values,counts};});
 },[accounts,periodEnd]);
 const display=visible.filter(a=>a.label.toLowerCase().includes(query.toLowerCase()));
 const ranked=[...display].sort((a,b)=>(b.mean??-1)-(a.mean??-1));
 const latestStatus=display.reduce((s,a)=>{s.available+=Math.max(0,a.latest?.available??0);s.unavailable+=Math.max(0,a.latest?.unavailable??0);s.unknown+=Math.max(0,a.latest?.unknown??0);return s;},{available:0,unavailable:0,unknown:0});
 const known=latestStatus.available+latestStatus.unavailable;
 const reportAvg=avg(display.map(a=>a.mean).filter((v):v is number=>v!==null));
 const prevAvg=avg(display.filter(a=>a.mean!==null&&a.previousMean!==null).map(a=>a.previousMean!));
 const pairedCurrentAvg=avg(display.filter(a=>a.mean!==null&&a.previousMean!==null).map(a=>a.mean!));
 const coverage=display.reduce((s,a)=>s+a.validDays,0),possible=display.reduce((s,a)=>s+a.possibleDays,0);
 const populated=display.filter(a=>a.mean!==null).length;
 const exportWeekly=()=>download(`UBL_OLA_Weekly_${month}.csv`,[['Week start','Week end','Account','Source','Average OLA (%)','Observed days'],...weeks.flatMap(w=>display.map(a=>[w.start,w.end,a.label,a.kind==='catalog'?'Catalog':'Mapped',clean(w.values[a.code]),w.counts[a.code]]))]);
 const exportDaily=()=>download(`UBL_OLA_Daily_${month}.csv`,[['Date','Account','Source','OLA (%)','Available','Out of stock','Unknown','Checked','Run status'],...display.flatMap(a=>a.days.filter(d=>d.date>=monthStart&&d.date<=periodEnd).map(d=>[d.date,a.label,a.kind==='catalog'?'Catalog':'Mapped',clean(d.ola_pct),d.available,d.unavailable,d.unknown,d.checked,d.status]))]);
 const exportSummary=()=>download(`UBL_OLA_Accounts_${month}.csv`,[['Account','Source','MTD average (%)','Previous month average (%)','Change (pp)','Valid days','Calendar days','Latest observed date','Available','Out of stock','Unknown'],...ranked.map(a=>[a.label,a.kind==='catalog'?'Catalog':'Mapped',clean(a.mean),clean(a.previousMean),a.delta===null?'':a.delta.toFixed(2),a.validDays,a.possibleDays,a.latest?.date,a.latest?.available,a.latest?.unavailable,a.latest?.unknown])]);
 const monthLabel=new Date(monthStart+'T12:00:00Z').toLocaleDateString('en-US',{month:'long',year:'numeric',timeZone:'UTC'});
 return <div className="olai-root">
  <section className="olai-toolbar"><div><div className="olai-eyebrow">DIGITAL SHELF / AVAILABILITY INTELLIGENCE</div><h2>OLA performance overview</h2><p>Account trends, week-on-week movement and confirmed stock status from independent OLA scrapes.</p></div><div className="olai-toolbar-actions"><Link className="olai-btn" href="/ola/segments">Brand &amp; BU intelligence</Link><Link className="olai-btn" href="/ola/skus">SKU Intelligence</Link><Link className="olai-btn" href="/ola/branches">PandaMart Branches</Link><Link className="olai-btn" href="/ola/commercial">Commercial Intelligence</Link><button className="olai-btn" aria-label="Previous month" onClick={()=>setMonth(v=>monthShift(v,-1))}><ChevronLeft size={18}/></button><label className="olai-month"><CalendarDays size={16}/><input type="month" aria-label="Analysis month" value={month} max={monthNow()} onChange={e=>e.target.value&&setMonth(e.target.value)}/></label><button className="olai-btn" aria-label="Next month" disabled={month>=monthNow()} onClick={()=>setMonth(v=>monthShift(v,1))}><ChevronRight size={18}/></button><button className="olai-btn" onClick={()=>void load()} disabled={loading}><RefreshCw size={16} className={loading?'olai-spin':''}/>Refresh</button></div></section>
  {error?<div className="olai-error" role="alert">{error}. The existing account pages are unchanged.</div>:null}
  {loading&&!response?<div className="olai-loading">Loading availability history…</div>:null}
  <section className="olai-card olai-filters"><div className="olai-filter-heading"><SlidersHorizontal size={18}/><strong>Account selection</strong><span>{visible.length} selected</span></div><div className="olai-filter-controls"><label className="olai-search"><Search size={15}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Filter account names"/></label><label className="olai-toggle"><input type="checkbox" checked={showCatalog} onChange={e=>setShowCatalog(e.target.checked)}/> Include catalog-only accounts</label><button className="olai-linkbutton" onClick={()=>setChosen(selectable.map(a=>a.code))}>Select all</button><button className="olai-linkbutton" onClick={()=>setChosen([])}>Clear</button></div><div className="olai-chips">{selectable.map(a=><button key={a.code} onClick={()=>setChosen(v=>v.includes(a.code)?v.filter(c=>c!==a.code):[...v,a.code])} aria-pressed={chosen.includes(a.code)} className={`olai-chip ${chosen.includes(a.code)?'selected':''}`}><span style={{background:colorFor(a.code,accounts)}} className="olai-dot"/>{a.label}{chosen.includes(a.code)?<Check size={13}/>:null}{a.kind==='catalog'?<small>Catalog</small>:null}</button>)}</div><p className="olai-footnote">Catalog-only accounts are excluded by default to avoid mixing their catalog availability with mapped SKU availability. Turn them on for a separate, clearly labeled comparison.</p></section>
  <section className="olai-kpis"><article className="olai-kpi"><span>Account-average OLA</span><strong>{fmt(reportAvg)}</strong><small>Equal-weight mean of selected account MTD daily averages</small></article><article className="olai-kpi"><span>Month-on-month change</span><strong>{pairedCurrentAvg!==null&&prevAvg!==null?`${pairedCurrentAvg-prevAvg>0?'+':''}${(pairedCurrentAvg-prevAvg).toFixed(1)} pp`:'—'}</strong><small>vs previous full month · same accounts with valid data</small></article><article className="olai-kpi"><span>Latest confirmed OOS</span><strong>{latestStatus.unavailable.toLocaleString()}</strong><small>{known.toLocaleString()} confirmed observations across latest account snapshots</small></article><article className="olai-kpi"><span>Daily data coverage</span><strong>{possible?fmt(coverage/possible*100):'—'}</strong><small>{coverage} observed account-days / {possible} possible · {populated}/{display.length} accounts with data</small></article></section>
  <section className="olai-grid-wide"><div className="olai-card olai-trend"><div className="olai-sectionhead"><div><div className="olai-eyebrow">HISTORICAL PERFORMANCE</div><h3>Weekly account comparison</h3><p>Eight Monday–Sunday weeks; each point is an average of observed daily OLA, not a weekly stock snapshot.</p></div><button className="olai-btn" disabled={!display.length} onClick={exportWeekly}><Download size={15}/> CSV</button></div>{weeks.length&&display.length?<TrendChart weeks={weeks} accounts={display}/>:<div className="olai-empty">Select an account to view the trend.</div>}<div className="olai-legend">{display.map(a=><span key={a.code}><i style={{background:colorFor(a.code,display)}}/>{a.label}</span>)}</div></div>
  <div className="olai-card"><div className="olai-sectionhead"><div><div className="olai-eyebrow">DATA QUALITY</div><h3>Latest stock status</h3><p>Each account's latest snapshot in the selected month.</p></div></div><div className="olai-bigstat"><strong>{known?fmt(known/(known+latestStatus.unknown)*100):'—'}</strong><span>Confirmed-status coverage</span></div><ShareBar {...latestStatus}/><div className="olai-statuses"><div><i className="green"/><span>Available</span><strong>{latestStatus.available.toLocaleString()}</strong></div><div><i className="red"/><span>Out of stock</span><strong>{latestStatus.unavailable.toLocaleString()}</strong></div><div><i className="gray"/><span>Unknown</span><strong>{latestStatus.unknown.toLocaleString()}</strong></div></div><p className="olai-footnote">Unknown is never counted as OOS. Counts are from different accounts' latest observed days, not a synchronized portfolio snapshot.</p></div></section>
  <section className="olai-card"><div className="olai-sectionhead"><div><div className="olai-eyebrow">ACCOUNT BENCHMARKING</div><h3>Performance leaderboard — {monthLabel}</h3><p>Sorted by average daily OLA. Month-to-month movement is in percentage points.</p></div><div className="olai-actions"><button className="olai-btn" disabled={!ranked.length} onClick={exportSummary}><Download size={15}/> Account CSV</button><button className="olai-btn" disabled={!display.length} onClick={exportDaily}><Download size={15}/> Daily CSV</button></div></div><div className="olai-tablewrap"><table className="olai-table"><thead><tr><th>Account</th><th>MTD OLA</th><th>Performance</th><th>vs previous month</th><th>Valid days</th><th>Latest observed</th><th>OOS</th><th>Unknown</th></tr></thead><tbody>{ranked.map(a=><tr key={a.code}><td><Link href={`/ola/${a.code}`}>{a.label}</Link>{a.kind==='catalog'?<small className="olai-source">Catalog only</small>:null}</td><td className="olai-numeric"><strong>{fmt(a.mean)}</strong></td><td><div className="olai-meter"><span style={{width:`${a.mean??0}%`,background:a.mean===null?'#cbd5e1':a.mean>=80?'#16a085':a.mean>=60?'#e5a23b':'#dc5265'}}/></div></td><td><Delta value={a.delta}/></td><td>{a.validDays}/{a.possibleDays}</td><td>{a.latest?.date??'—'}</td><td className="olai-numeric">{a.latest?.unavailable??'—'}</td><td className="olai-numeric">{a.latest?.unknown??'—'}</td></tr>)}</tbody></table>{!ranked.length?<div className="olai-empty">No accounts selected or matched the search.</div>:null}</div></section>
  <section className="olai-card"><div className="olai-sectionhead"><div><div className="olai-eyebrow">WEEK-ON-WEEK</div><h3>Weekly change matrix</h3><p>Account weekly averages. A dash means there were no confirmed OLA values that week.</p></div></div><div className="olai-tablewrap"><table className="olai-table olai-matrix"><thead><tr><th>Account</th>{weeks.map(w=><th key={w.key} title={`${w.start} to ${w.end}`}>{w.label}</th>)}</tr></thead><tbody>{display.map(a=><tr key={a.code}><td><Link href={`/ola/${a.code}`}>{a.label}</Link></td>{weeks.map(w=>{const value=w.values[a.code];return <td key={w.key} title={`${w.counts[a.code]} valid observed days`} className={value===null?'olai-missing':value>=80?'olai-good':value>=60?'olai-mid':'olai-bad'}>{fmt(value)}</td>})}</tr>)}</tbody></table></div></section>
  <p className="olai-method">Methodology: Daily OLA excludes Unknown from its denominator. Latest successful account snapshot is preferred for each day; otherwise the API selects the latest partial snapshot. Weekly/monthly figures are equal-weight averages of valid daily percentages. Missing dates are never treated as zero. Catalog-only and SKU-mapped account metrics have different coverage definitions. No Sales &amp; Stock uploads are mixed into this view.</p>
 </div>;
}
