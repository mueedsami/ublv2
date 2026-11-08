'use client';
import {useCallback,useEffect,useMemo,useState} from 'react';
import Link from 'next/link';
import {CalendarDays,Download,RefreshCw,TrendingUp} from 'lucide-react';

type Day = {date:string;ola_pct:number|null;available:number|null;unavailable:number|null;unknown:number|null;checked:number|null;status:string|null};
type Account = {code:string;label:string;kind?:string;rows:Day[];observed_days:number;valid_days:number;avg_ola_pct:number|null;min_ola_pct:number|null;max_ola_pct:number|null};
type Overview={month:string;dates:string[];accounts:Account[];total_runs:number;selected_snapshots:number;methodology:string};
const fmt=(x:number|null|undefined)=>x==null?'—':`${x.toFixed(1)}%`;
const currentMonth=()=>{const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Dhaka',year:'numeric',month:'2-digit'}).formatToParts(new Date());return `${parts.find(x=>x.type==='year')?.value}-${parts.find(x=>x.type==='month')?.value}`;};
const shift=(month:string,diff:number)=>{const [y,m]=month.split('-').map(Number);const d=new Date(Date.UTC(y,m-1+diff,1));return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}`;};
function downloadCsv(filename:string,rows:(string|number|null|undefined)[][]){const quote=(x:string|number|null|undefined)=>`"${String(x??'').replaceAll('"','""')}"`;const content='\uFEFF'+rows.map(r=>r.map(quote).join(',')).join('\r\n');const blob=new Blob([content],{type:'text/csv;charset=utf-8'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=filename;a.click();URL.revokeObjectURL(url);}
function Trend({rows}:{rows:Day[]}){
 const w=480,h=155,left=30,right=12,top=12,bottom=26;
 const x=(i:number)=>left+(w-left-right)*(rows.length<=1?0:i/(rows.length-1));
 const y=(v:number)=>top+(h-top-bottom)*(1-v/100);
 let segments:string[][]=[];let current:string[]=[];
 rows.forEach((r,i)=>{if(r.ola_pct===null){if(current.length)segments.push(current);current=[];}else current.push(`${x(i).toFixed(1)},${y(r.ola_pct).toFixed(1)}`)});if(current.length)segments.push(current);
 return <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Daily OLA percentage trend across selected month" style={{width:'100%',height:165,display:'block'}}>
  {[0,25,50,75,100].map(p=><g key={p}><line x1={left} x2={w-right} y1={y(p)} y2={y(p)} stroke="#dce5ee" strokeDasharray="3 4"/><text x={left-6} y={y(p)+4} fill="#728096" fontSize="10" textAnchor="end">{p}</text></g>)}
  {segments.map((pts,i)=>pts.length>=2?<polyline key={i} points={pts.join(' ')} fill="none" stroke="#2563eb" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"/>:null)}
  {rows.map((r,i)=>r.ola_pct===null?null:<circle key={r.date} cx={x(i)} cy={y(r.ola_pct)} r="3.5" fill="#2563eb"><title>{r.date}: {fmt(r.ola_pct)}</title></circle>)}
  {[0,Math.floor((rows.length-1)/2),rows.length-1].map((i,j)=><text key={j} x={x(i)} y={h-5} fill="#728096" fontSize="11" textAnchor={j===0?'start':j===2?'end':'middle'}>{rows[i]?.date.slice(8)}</text>)}
 </svg>;
}
export default function OlaMonthlyOverview(){
 const[month,setMonth]=useState(currentMonth);const[data,setData]=useState<Overview|null>(null);const[loading,setLoading]=useState(true);const[error,setError]=useState('');
 const load=useCallback(async()=>{setLoading(true);setError('');try{const r=await fetch(`/api/ola/overview?month=${encodeURIComponent(month)}`,{cache:'no-store'});const json=await r.json();if(!r.ok)throw new Error(json.error??'Unable to fetch OLA history');setData(json);}catch(e){setError(e instanceof Error?e.message:'Unable to fetch OLA');setData(null);}finally{setLoading(false)}},[month]);
 useEffect(()=>{void load();},[load]);
 const accounts=data?.accounts??[];
 const byDay=useMemo(()=>new Map(accounts.map(a=>[a.code,new Map(a.rows.map(r=>[r.date,r]))])),[accounts]);
 const populated=accounts.filter(a=>a.valid_days>0).length;
 const period=new Date(`${month}-01T12:00:00Z`).toLocaleDateString('en-US',{month:'long',year:'numeric',timeZone:'UTC'});
 const exportMatrix=()=>{if(!data)return;downloadCsv(`OLA_Monthly_Account_Matrix_${month}.csv`,[['Date',...accounts.map(a=>a.label)],...data.dates.map(d=>[d,...accounts.map(a=>byDay.get(a.code)?.get(d)?.ola_pct)]),['Monthly Average',...accounts.map(a=>a.avg_ola_pct)]]);};
 return <div style={{display:'grid',gap:22}}>
  <section className="card" style={{padding:20,display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:12}}>
   <div><strong style={{fontSize:18}}>Monthly OLA comparison</strong><div style={{color:'#64748b',marginTop:5,fontSize:13}}>Select a month to view all days, each account's availability and its trend.</div></div>
   <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
    <button className="button secondary compact" onClick={()=>setMonth(x=>shift(x,-1))} aria-label="Previous month">←</button>
    <label style={{display:'flex',alignItems:'center',gap:7,fontSize:13}}><CalendarDays size={16}/><input aria-label="Report month" type="month" value={month} min="2020-01" max="2100-12" onChange={e=>e.target.value&&setMonth(e.target.value)} style={{padding:'9px 10px',border:'1px solid #cbd5e1',borderRadius:8}}/></label>
    <button className="button secondary compact" onClick={()=>setMonth(x=>shift(x,1))} aria-label="Next month">→</button>
    <button className="button secondary compact" disabled={loading} onClick={()=>void load()}><RefreshCw size={15}/> Refresh</button>
    <button className="button secondary compact" disabled={!data} onClick={exportMatrix}><Download size={15}/> Export matrix</button>
   </div>
  </section>
  {error?<section className="card" style={{padding:18,color:'#b91c1c'}}>{error}</section>:null}
  <section style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:12}}>
   {[['Report month',period],['Accounts with data',`${populated} / ${accounts.length}`],['Days in month',`${data?.dates.length??'—'}`],['Scrape snapshots',`${data?.selected_snapshots??'—'}`]].map(([label,value])=><div key={label} className="card" style={{padding:16}}><div style={{fontSize:12,color:'#64748b'}}>{label}</div><strong style={{fontSize:22}}>{value}</strong></div>)}
  </section>
  <section className="card" style={{padding:20}}>
   <div style={{display:'flex',justifyContent:'space-between',gap:12,flexWrap:'wrap',marginBottom:12}}><div><h2 style={{margin:0,fontSize:19}}>Daily OLA matrix — {period}</h2><p style={{fontSize:13,color:'#64748b',marginTop:5}}>Each row is one day; each column is one account. Blank (—) means no confirmed percentage, not 0%.</p></div></div>
   <div style={{overflowX:'auto',maxHeight:720,overflowY:'auto'}}><table style={{width:'100%',borderCollapse:'separate',borderSpacing:0,fontSize:13,minWidth:820}}><thead><tr><th style={{position:'sticky',top:0,left:0,zIndex:3,background:'#f1f5f9',textAlign:'left',padding:'11px 12px',borderBottom:'1px solid #dbe4ee'}}>Date</th>{accounts.map(a=><th key={a.code} style={{position:'sticky',top:0,zIndex:2,background:'#f1f5f9',padding:'11px 10px',textAlign:'center',borderBottom:'1px solid #dbe4ee'}}><Link href={`/ola/${a.code}`} style={{color:'inherit'}}>{a.label}</Link>{a.kind==='catalog'?<div style={{fontSize:10,fontWeight:400,color:'#64748b'}}>Catalog</div>:null}</th>)}</tr></thead>
    <tbody>{data?.dates.map((d,i)=><tr key={d}><th style={{position:'sticky',left:0,zIndex:1,background:i%2?'#f8fafc':'#fff',textAlign:'left',padding:'9px 12px',borderBottom:'1px solid #edf2f7',whiteSpace:'nowrap'}}>{d.slice(8)} {new Date(d+'T12:00:00Z').toLocaleDateString('en-US',{weekday:'short',timeZone:'UTC'})}</th>{accounts.map(a=>{const v=byDay.get(a.code)?.get(d)?.ola_pct;return <td key={a.code} title={`${a.label} ${d}: ${fmt(v)}`} style={{padding:'9px 8px',textAlign:'center',borderBottom:'1px solid #edf2f7',background:v==null?(i%2?'#f8fafc':'#fff'):v>=80?'#e5f6ed':v>=50?'#fff5db':'#fee9e7',color:v==null?'#94a3b8':v>=80?'#166534':v>=50?'#92400e':'#991b1b',fontWeight:v==null?400:650}}>{fmt(v)}</td>})}</tr>)}</tbody>
    <tfoot><tr><th style={{position:'sticky',left:0,background:'#e9eef7',padding:'13px 12px',textAlign:'left'}}>Monthly average</th>{accounts.map(a=><th key={a.code} style={{background:'#e9eef7',padding:'13px 8px',textAlign:'center'}}>{fmt(a.avg_ola_pct)}</th>)}</tr></tfoot>
   </table></div>
  </section>
  <section><div style={{display:'flex',alignItems:'center',gap:8,marginBottom:12}}><TrendingUp size={19}/><h2 style={{fontSize:20,margin:0}}>Account trends — {period}</h2></div>
   <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(min(100%,410px),1fr))',gap:15}}>{accounts.map(a=><div className="card" key={a.code} style={{padding:18}}><div style={{display:'flex',justifyContent:'space-between',alignItems:'start',gap:10}}><div><Link href={`/ola/${a.code}`} style={{fontWeight:700,fontSize:17,color:'inherit'}}>{a.label}</Link><div style={{fontSize:12,color:'#64748b',marginTop:4}}>{a.valid_days} confirmed day(s){a.kind==='catalog'?' · catalog-based':''}</div></div><div style={{textAlign:'right'}}><strong style={{fontSize:23}}>{fmt(a.avg_ola_pct)}</strong><div style={{fontSize:11,color:'#64748b'}}>Monthly avg</div></div></div>
    {a.valid_days>0?<Trend rows={a.rows}/>:<div style={{height:165,display:'grid',placeItems:'center',color:'#64748b'}}>No confirmed OLA data this month</div>}
    <div style={{display:'flex',justifyContent:'space-between',fontSize:12,color:'#64748b'}}><span>Min {fmt(a.min_ola_pct)}</span><span>Max {fmt(a.max_ola_pct)}</span><Link href={`/ola/${a.code}`}>View daily records</Link></div></div>)}</div>
  </section>
  <p style={{fontSize:12,color:'#64748b'}}>Method: {data?.methodology??'Daily OLA counts only confirmed available and unavailable observations. Missing days are not zero.'} All figures are displayed month by month and day by day.</p>
 </div>;
}
