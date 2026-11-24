'use client';

import {useCallback,useEffect,useMemo,useState} from 'react';
import {CalendarDays,Download,RefreshCw,ChevronLeft,ChevronRight,Table2,Info} from 'lucide-react';
import type {OLAAccountMatrix,DailyCell} from '@/lib/ola-monthly-basepack-matrix';
import './ola-matrix.css';

const format=(n:number|null|undefined)=>n==null?'—':`${n.toFixed(1)}%`;
const monthNow=()=>{
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Dhaka',year:'numeric',month:'2-digit'}).formatToParts(new Date());
  return `${parts.find(p=>p.type==='year')?.value}-${parts.find(p=>p.type==='month')?.value}`;
};
const monthOffset=(month:string,diff:number)=>{
  const [y,m]=month.split('-').map(Number);const d=new Date(Date.UTC(y,m-1+diff,1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}`;
};
const labelForMonth=(month:string)=>new Date(`${month}-01T12:00:00Z`).toLocaleDateString('en-US',{month:'long',year:'numeric',timeZone:'UTC'});
const weekday=(day:string)=>new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US',{weekday:'short',timeZone:'UTC'});
const colorClass=(pct:number|null|undefined)=>pct==null?'olam-na':pct>=80?'olam-good':pct>=50?'olam-mid':'olam-low';
const signal=(cell:DailyCell)=>cell.runStatus==='partial'?'Partial run':cell.runStatus==='success'?'Successful run':'No scraper run';

export default function MonthlyOlaMatrixPage(){
  const [month,setMonth]=useState(monthNow);
  const [report,setReport]=useState<OLAAccountMatrix|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [hideEmpty,setHideEmpty]=useState(false);
  const [selected,setSelected]=useState<{date:string;code:string}|null>(null);
  const load=useCallback(async()=>{
    setLoading(true);setError('');setSelected(null);
    try{
      const response=await fetch(`/api/ola/matrix?month=${encodeURIComponent(month)}`,{cache:'no-store'});
      const body=await response.json() as OLAAccountMatrix&{error?:string};
      if(!response.ok)throw new Error(body.error??'Unable to fetch the monthly basepack matrix');
      setReport(body);
    }catch(e){setError(e instanceof Error?e.message:'Unable to load OLA matrix');setReport(null);}
    finally{setLoading(false);}
  },[month]);
  useEffect(()=>{void load();},[load]);
  const accounts=useMemo(()=>report?.accounts.filter(a=>!hideEmpty||a.validDays>0)??[],[report,hideEmpty]);
  const selectedCell=selected&&report?.rows.find(r=>r.date===selected.date)?.cells[selected.code];
  const selectedName=report?.accounts.find(a=>a.code===selected?.code)?.label??'';
  const exportFile=()=>{if(!report)return;window.location.href=`/api/ola/matrix?month=${encodeURIComponent(month)}&format=xlsx`;};
  const accountsWithData=report?.accounts.filter(a=>a.validDays>0).length??0;
  const daysWithData=report?.overall.validDays??0;
  const latestDay=report?.rows.filter(r=>r.overall.ola!==null).at(-1);
  return <div className="page olam-page">
    <header className="olam-header">
      <div><div className="eyebrow">Online availability / Monthly report</div><h1>OLA Matrix</h1>
        <p>Daily, account-wise <strong>basepack OLA</strong> — one day per row, one account per column.</p></div>
      <div className="olam-controls">
        <button className="button secondary" title="Previous month" aria-label="Previous month" onClick={()=>setMonth(m=>monthOffset(m,-1))}><ChevronLeft size={17}/></button>
        <label className="olam-month"><CalendarDays size={16}/><input aria-label="Select report month" type="month" value={month} max={monthNow()} onChange={e=>{if(e.target.value)setMonth(e.target.value);}} /></label>
        <button className="button secondary" title="Next month" aria-label="Next month" disabled={month>=monthNow()} onClick={()=>setMonth(m=>monthOffset(m,1))}><ChevronRight size={17}/></button>
        <button className="button secondary" disabled={loading} onClick={()=>void load()}><RefreshCw size={16} className={loading?'olam-spin':''}/> Refresh</button>
        <button className="button" disabled={loading||!report} onClick={exportFile}><Download size={16}/> Export Excel</button>
      </div>
    </header>

    {error&&<section className="olam-alert olam-error"><Info size={17}/><span>{error}</span></section>}
    <section className="olam-kpis">
      <div className="olam-kpi"><span>Reporting month</span><strong>{labelForMonth(month)}</strong><small>Asia/Dhaka calendar dates</small></div>
      <div className="olam-kpi"><span>Accounts with measured OLA</span><strong>{loading?'…':`${accountsWithData} / ${report?.accounts.length??0}`}</strong><small>Mapped basepacks only</small></div>
      <div className="olam-kpi"><span>Days with measured OLA</span><strong>{loading?'…':`${daysWithData} / ${report?.dates.length??0}`}</strong><small>Missing days excluded</small></div>
      <div className="olam-kpi"><span>Latest portfolio OLA</span><strong className={colorClass(latestDay?.overall.ola)}>{loading?'…':format(latestDay?.overall.ola)}</strong><small>{latestDay?.date??'No measured date'}</small></div>
    </section>

    <section className="card olam-card">
      <div className="olam-card-head"><div><h2><Table2 size={19}/> Daily OLA matrix — {labelForMonth(month)}</h2><p>Click a percentage to see available, OOS, unknown and branch counts. Missing data is shown as —, never 0%.</p></div>
        <label className="olam-checkbox"><input type="checkbox" checked={hideEmpty} onChange={e=>setHideEmpty(e.target.checked)}/> Hide accounts without data</label></div>
      <div className="olam-legend"><span><i className="olam-sw olam-good"/> 80–100%</span><span><i className="olam-sw olam-mid"/> 50–79.9%</span><span><i className="olam-sw olam-low"/> Below 50%</span><span><i className="olam-sw olam-na"/> No measured data</span></div>
      <div className="olam-scroll"><table className="olam-table">
        <thead><tr><th className="olam-date">Date</th>{accounts.map(a=><th key={a.code}>{a.label}<small>{a.validDays} measured days</small></th>)}<th className="olam-overall">Portfolio OLA</th></tr></thead>
        <tbody>{report?.rows.map(row=><tr key={row.date}>
          <th className="olam-date"><span>{row.date.slice(8)}</span><small>{weekday(row.date)}</small></th>
          {accounts.map(a=>{const cell=row.cells[a.code];const isSelected=selected?.date===row.date&&selected?.code===a.code;return <td key={a.code} className={colorClass(cell.ola)}>
            <button className={`olam-cell ${isSelected?'olam-selected':''}`} title={`${a.label} · ${row.date}\n${signal(cell)}\nAvailable ${cell.available} | OOS ${cell.oos} | Unknown ${cell.unknown}\nBranches ${cell.branches}`} onClick={()=>setSelected({date:row.date,code:a.code})}>{format(cell.ola)}{cell.runStatus==='partial'&&<sup>†</sup>}</button>
          </td>;})}
          <td className={`olam-overall ${colorClass(row.overall.ola)}`} title={`Available: ${row.overall.available}, OOS: ${row.overall.oos}, Unknown: ${row.overall.unknown}`}><strong>{format(row.overall.ola)}</strong></td>
        </tr>)}</tbody>
        <tfoot><tr><th className="olam-date">Monthly average</th>{accounts.map(a=><th key={a.code} className={colorClass(a.avgOla)}>{format(a.avgOla)}</th>)}<th className={colorClass(report?.overall.avgDailyOla)}>{format(report?.overall.avgDailyOla)}</th></tr></tfoot>
      </table>
      {loading&&<div className="olam-loading">Loading read-only daily basepack observations…</div>}
      {!loading&&!error&&report?.diagnostics.runs===0&&<div className="olam-loading">No scraper runs were found for this month. Every day remains blank rather than reporting 0%.</div>}
      </div>
    </section>
    {selected&&selectedCell&&<section className="olam-inspector card">
      <div><strong>{selectedName} · {selected.date}</strong><span>{signal(selectedCell)}</span></div>
      <div className="olam-inspector-grid"><div><span>OLA</span><strong>{format(selectedCell.ola)}</strong></div><div><span>Available basepacks</span><strong>{selectedCell.available}</strong></div><div><span>Out of stock</span><strong>{selectedCell.oos}</strong></div><div><span>Unknown</span><strong>{selectedCell.unknown}</strong></div><div><span>Branches observed</span><strong>{selectedCell.branches}</strong></div><div><span>Observed SKU cells</span><strong>{selectedCell.skus}</strong></div></div>
      <button type="button" className="button secondary compact" onClick={()=>setSelected(null)}>Close details</button>
    </section>}
    <p className="olam-method"><Info size={15}/> <span>{report?.methodology??'Data is pulled from historical daily scraper observations and mapped account SKUs. No database writes.'} {report?.diagnostics.partialRuns?`† ${report.diagnostics.partialRuns} selected snapshots were partial runs; these may underrepresent catalog coverage.`:''}</span></p>
  </div>;
}
