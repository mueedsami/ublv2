'use client';
import {useMemo,useState} from 'react';
import Link from 'next/link';
import {ArrowLeft,ArrowRight,Download,RefreshCw,UploadCloud} from 'lucide-react';

type Counts={available:number;oos:number;unknown:number;valid:number;ola:number|null};
type Summary={account:string;branch?:string;asOf:string;prioritySkus:number;fullMtd:Counts;priorityMtd:Counts;fullLatest:Counts;priorityLatest:Counts;gapMtd:number|null;gapLatest:number|null};
type Daily={account:string;branch:string;date:string;full:Counts;priority:Counts;gap:number|null};
type Basepack={account:string;branch:string;date:string;basepack:string;businessUnit:string;category:string;brand:string;format:string;fullStatus:string;priorityStatus:string;fullSkus:string;prioritySkus:string;difference:string};
type Dim={group:string;full:Counts;priority:Counts;gap:number|null};
type Audit={account:string;sku:string;product:string;basepack:string;branch:string;date:string;status:string};
type Result={start:string;end:string;uploaded:number;duplicatesRemoved:number;overall:{full:Counts;priority:Counts;gap:number|null};accounts:Summary[];branches:Summary[];daily:Daily[];basepacks:Basepack[];dimensions:{businessUnit:Dim[];category:Dim[];brand:Dim[];format:Dim[]};audits:Audit[];
 info:{runs:number;observations:number;issues:number};description:string};
const labels:Record<string,string>={arogga:'Arogga',cartup:'Cartup',daraz:'Daraz',othoba:'Othoba',pandamart:'PandaMart',shajgoj:'Shajgoj',shwapno:'Shwapno'};
const pct=(n:number|null)=>n===null?'—':`${(n*100).toFixed(2)}%`;
const delta=(n:number|null)=>n===null?'—':`${n>0?'+':''}${(n*100).toFixed(2)} pp`;
const dhakaDate=()=>{const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Dhaka',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());return `${parts.find(p=>p.type==='year')?.value}-${parts.find(p=>p.type==='month')?.value}-${parts.find(p=>p.type==='day')?.value}`;};
const controls={padding:'10px 12px',border:'1px solid #d9e2ef',borderRadius:8,background:'white',width:'100%'} as const;
const button={display:'inline-flex',alignItems:'center',justifyContent:'center',gap:8,padding:'11px 15px',borderRadius:9,border:'1px solid #cdd8e5',cursor:'pointer',fontWeight:650} as const;

export default function BasepackComparisonPage(){
 const [file,setFile]=useState<File|null>(null);
 const [start,setStart]=useState(()=>`${dhakaDate().slice(0,7)}-01`);
 const [end,setEnd]=useState(()=>dhakaDate());
 const [scope,setScope]=useState<'all'|'priority'>('all');
 const [busy,setBusy]=useState<'preview'|'download'|null>(null);
 const [error,setError]=useState('');
 const [result,setResult]=useState<Result|null>(null);
 const [account,setAccount]=useState('all');
 const [term,setTerm]=useState('');
 const [onlyGaps,setOnlyGaps]=useState(false);
 const [dimension,setDimension]=useState<keyof Result['dimensions']>('businessUnit');
 const [page,setPage]=useState(0);
 const visibleBasepacks=useMemo(()=>{
  const q=term.trim().toLowerCase();
  return (result?.basepacks??[]).filter(x=>(account==='all'||x.account===account)&&(!onlyGaps||x.difference==='Portfolio IS / Priority OOS')&&
   (!q||[x.account,x.branch,x.basepack,x.brand,x.businessUnit,x.category,x.fullSkus,x.prioritySkus,x.difference].some(v=>v.toLowerCase().includes(q))));
 },[result,account,term,onlyGaps]);
 async function run(mode:'preview'|'download'){
  if(!file){setError('Upload your priority SKU Excel file first.');return;}
  if(!start||!end||start>end){setError('Choose a valid start and end date.');return;}
  setBusy(mode);setError('');
  try{
   const form=new FormData();form.append('file',file);form.append('start',start);form.append('end',end);form.append('accountScope',scope);form.append('mode',mode);
   const response=await fetch('/api/central/basepack-compare',{method:'POST',body:form,cache:'no-store'});
   if(!response.ok){const json=await response.json().catch(()=>null) as {error?:string}|null;throw new Error(json?.error??`Report failed (${response.status}).`);}
   if(mode==='preview'){setResult(await response.json() as Result);setPage(0);setAccount('all');}
   else {const blob=await response.blob(),url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`UBL_Full_vs_Priority_Basepack_OLA_${start}_${end}.xlsx`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);}
  }catch(e){setError(e instanceof Error?e.message:'Failed to calculate OLA.');}finally{setBusy(null);}
 }
 return <div className="page" style={{maxWidth:1470,paddingBottom:40}}>
  <div className="page-head" style={{display:'flex',alignItems:'start',justifyContent:'space-between',gap:12,flexWrap:'wrap'}}>
   <div><div style={{fontSize:12,letterSpacing:1,textTransform:'uppercase',color:'#315d9c',fontWeight:700,marginBottom:8}}>Central Availability / Basepack Intelligence</div>
    <h1>Basepack OLA Checker</h1><p>Compare the full portfolio with your priority SKUs — both mapped to basepacks and calculated from the same daily OLA observations.</p>
   </div><Link href="/central/priority-ola" className="button secondary"><ArrowLeft size={15}/> Priority SKU OLA</Link>
  </div>
  <section style={{border:'1px solid #e0e7f1',background:'white',borderRadius:13,padding:20,marginBottom:17}}>
   <div style={{display:'flex',alignItems:'center',gap:9,marginBottom:12}}><UploadCloud size={20} color="#315d9c"/><h2 style={{margin:0,fontSize:18}}>Define the priority scope</h2></div>
   <p style={{fontSize:13,color:'#576a80',margin:'0 0 16px'}}>Upload Account Name, SKU ID, Product Name (.xlsx). All non-priority SKUs remain part of the full portfolio but do not affect priority basepack OLA.</p>
   <div style={{display:'grid',gridTemplateColumns:'minmax(230px,2fr) minmax(145px,1fr) minmax(145px,1fr) minmax(190px,1.1fr)',gap:12,alignItems:'end'}}>
    <label style={{display:'grid',gap:6,fontSize:12,fontWeight:700}}>Priority SKUs (.xlsx)<input type="file" accept=".xlsx" aria-label="Priority SKU list" style={controls} onChange={e=>{setFile(e.target.files?.[0]??null);setResult(null);setError('');}}/></label>
    <label style={{display:'grid',gap:6,fontSize:12,fontWeight:700}}>From<input type="date" style={controls} value={start} max={end} onChange={e=>{setStart(e.target.value);setResult(null);}}/></label>
    <label style={{display:'grid',gap:6,fontSize:12,fontWeight:700}}>To<input type="date" style={controls} value={end} min={start} max={dhakaDate()} onChange={e=>{setEnd(e.target.value);setResult(null);}}/></label>
    <label style={{display:'grid',gap:6,fontSize:12,fontWeight:700}}>Full portfolio scope<select style={controls} value={scope} onChange={e=>{setScope(e.target.value as 'all'|'priority');setResult(null);}}>
      <option value="all">All 7 mapped OLA accounts</option><option value="priority">Accounts in uploaded list</option>
    </select></label>
   </div>
   <div style={{display:'flex',gap:10,marginTop:16,flexWrap:'wrap'}}>
    <button style={{...button,background:'#173765',color:'white',opacity:busy?0.6:1}} disabled={!!busy} onClick={()=>void run('preview')}><RefreshCw size={16}/>{busy==='preview'?'Checking…':'Check Both Basepack OLAs'}</button>
    <button style={{...button,background:'white',color:'#173765',opacity:busy?0.6:1}} disabled={!!busy} onClick={()=>void run('download')}><Download size={16}/>{busy==='download'?'Exporting…':'Download Comparison (.xlsx)'}</button>
    <Link className="button secondary" href="/"><ArrowRight size={15}/> Central Availability</Link>
   </div>
   <p style={{fontSize:12,color:'#66758d',margin:'13px 0 0'}}>Read-only Supabase queries. Priority upload stays in memory; never saved to the database. Maximum reporting period: 62 days.</p>
  </section>
  {error&&<div role="alert" className="alert error" style={{marginBottom:15}}>{error}</div>}
  {result&&<>
   <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:12,marginBottom:17}}>
    {[
     ['Full basepack MTD',pct(result.overall.full.ola)],['Priority basepack MTD',pct(result.overall.priority.ola)],
     ['Priority vs Full',delta(result.overall.gap)],['Uploaded priority SKUs',result.uploaded.toLocaleString()],
     ['Full valid basepack-days',result.overall.full.valid.toLocaleString()],['Priority valid basepack-days',result.overall.priority.valid.toLocaleString()]
    ].map(([name,val])=><div key={name} style={{padding:'14px 15px',border:'1px solid #e0e7f1',borderRadius:12,background:'white'}}><div style={{fontSize:12,color:'#66758d'}}>{name}</div><div style={{fontSize:23,fontWeight:750,color:'#142f53',marginTop:7}}>{val}</div></div>)}
   </div>
   <p style={{fontSize:12,color:'#5a6d85',marginBottom:17}}>MTD is weighted by valid account × branch × basepack × day observations. Unknown and missing dates are excluded. Latest comparison uses the same observation day for both scopes in each branch.</p>
   <section style={{border:'1px solid #e0e7f1',borderRadius:12,background:'white',padding:18,marginBottom:16}}>
    <h2 style={{fontSize:18,margin:'0 0 12px'}}>Account-wise comparison</h2>
    <div className="table-wrap"><table className="central-summary-table"><thead><tr><th>Account</th><th>Priority SKUs</th><th>Full MTD</th><th>Priority MTD</th><th>Gap</th><th>Full Latest</th><th>Priority Latest</th><th>Latest Gap</th><th>Latest Date</th></tr></thead><tbody>
     {result.accounts.map(x=><tr key={x.account}><td><strong>{labels[x.account]??x.account}</strong></td><td>{x.prioritySkus}</td><td>{pct(x.fullMtd.ola)}</td><td>{pct(x.priorityMtd.ola)}</td><td>{delta(x.gapMtd)}</td><td>{pct(x.fullLatest.ola)}</td><td>{pct(x.priorityLatest.ola)}</td><td>{delta(x.gapLatest)}</td><td>{x.asOf||'—'}</td></tr>)}
    </tbody></table></div>
   </section>
   <section style={{border:'1px solid #e0e7f1',borderRadius:12,background:'white',padding:18,marginBottom:16}}>
    <h2 style={{fontSize:18,margin:'0 0 12px'}}>Branch-wise OLA</h2><p style={{fontSize:12,color:'#526884',margin:'0 0 12px'}}>PandaMart locations are kept separate; other accounts use the All branch.</p>
    <div className="table-wrap"><table className="central-summary-table"><thead><tr><th>Account</th><th>Branch</th><th>Date</th><th>Full Latest</th><th>Priority Latest</th><th>Gap</th><th>Full MTD</th><th>Priority MTD</th></tr></thead><tbody>
     {result.branches.map(x=><tr key={`${x.account}|${x.branch}`}><td>{labels[x.account]??x.account}</td><td>{x.branch}</td><td>{x.asOf}</td><td>{pct(x.fullLatest.ola)}</td><td>{pct(x.priorityLatest.ola)}</td><td>{delta(x.gapLatest)}</td><td>{pct(x.fullMtd.ola)}</td><td>{pct(x.priorityMtd.ola)}</td></tr>)}
    </tbody></table></div>
   </section>
   <section style={{border:'1px solid #e0e7f1',borderRadius:12,background:'white',padding:18,marginBottom:16}}>
    <div style={{display:'flex',justifyContent:'space-between',gap:12,flexWrap:'wrap',alignItems:'end',marginBottom:14}}><h2 style={{fontSize:18,margin:0}}>Business breakdowns</h2><label style={{display:'grid',gap:5,fontSize:12,fontWeight:600}}>Group by<select style={{...controls,minWidth:170}} value={dimension} onChange={e=>setDimension(e.target.value as keyof Result['dimensions'])}><option value="businessUnit">Business Unit</option><option value="category">Category</option><option value="brand">Brand</option><option value="format">Format</option></select></label></div>
    <div className="table-wrap"><table className="central-summary-table"><thead><tr><th>Group</th><th>Full MTD</th><th>Priority MTD</th><th>Gap</th><th>Full valid cells</th><th>Priority valid cells</th></tr></thead><tbody>
     {result.dimensions[dimension].map(x=><tr key={x.group}><td>{x.group}</td><td>{pct(x.full.ola)}</td><td>{pct(x.priority.ola)}</td><td>{delta(x.gap)}</td><td>{x.full.valid}</td><td>{x.priority.valid}</td></tr>)}
    </tbody></table></div>
   </section>
   <section style={{border:'1px solid #e0e7f1',borderRadius:12,background:'white',padding:18,marginBottom:16}}>
    <h2 style={{fontSize:18,margin:'0 0 12px'}}>Daily basepack OLA trend</h2>
    <div className="table-wrap"><table className="central-summary-table"><thead><tr><th>Date</th><th>Account</th><th>Branch</th><th>Full basepack OLA</th><th>Priority basepack OLA</th><th>Gap</th><th>Full valid cells</th><th>Priority valid cells</th></tr></thead><tbody>
     {result.daily.slice(-90).reverse().map(x=><tr key={`${x.date}|${x.account}|${x.branch}`}><td>{x.date}</td><td>{labels[x.account]??x.account}</td><td>{x.branch}</td><td>{pct(x.full.ola)}</td><td>{pct(x.priority.ola)}</td><td>{delta(x.gap)}</td><td>{x.full.valid}</td><td>{x.priority.valid}</td></tr>)}
    </tbody></table></div>
    <p style={{fontSize:12,color:'#66758d',margin:'11px 0 0'}}>Showing the 90 most recent account/branch/day rows. Download the report for complete daily history.</p>
   </section>
   <section style={{border:'1px solid #e0e7f1',borderRadius:12,background:'white',padding:18,marginBottom:16}}>
    <h2 style={{fontSize:18,margin:'0 0 10px'}}>Priority SKU → basepack mapping audit</h2>
    <p style={{fontSize:12,color:'#526884',margin:'0 0 12px'}}>The master SKU mapping determines the basepack. Uploaded SKUs missing a mapping or observation remain visible and never become automatic OOS.</p>
    <div className="table-wrap"><table className="central-summary-table"><thead><tr><th>Account</th><th>SKU ID</th><th>Uploaded product</th><th>Mapped basepack</th><th>Branch</th><th>Latest observation</th><th>Status</th></tr></thead><tbody>
     {result.audits.slice(0,70).map((x,i)=><tr key={`${x.account}|${x.sku}|${x.branch}|${i}`}><td>{labels[x.account]??x.account}</td><td>{x.sku}</td><td>{x.product}</td><td>{x.basepack||'Unmapped'}</td><td>{x.branch||'—'}</td><td>{x.date||'—'}</td><td>{x.status}</td></tr>)}
    </tbody></table></div>
    <p style={{fontSize:12,color:'#66758d',margin:'11px 0 0'}}>Showing {Math.min(70,result.audits.length)} of {result.audits.length} mapping/branch rows. All rows are included in the Excel audit.</p>
   </section>
   <section style={{border:'1px solid #e0e7f1',borderRadius:12,background:'white',padding:18}}>
    <div style={{display:'flex',alignItems:'end',justifyContent:'space-between',gap:12,flexWrap:'wrap',marginBottom:12}}>
     <div><h2 style={{fontSize:18,margin:0}}>Latest basepack status checker</h2><p style={{fontSize:12,color:'#526884',margin:'8px 0 0'}}>Find priority basepacks that are OOS even when other portfolio SKUs are available.</p></div>
     <div style={{display:'flex',gap:10,alignItems:'end',flexWrap:'wrap'}}>
      <label style={{fontSize:12,display:'grid',gap:4}}>Account<select style={{...controls,minWidth:140}} value={account} onChange={e=>{setAccount(e.target.value);setPage(0);}}><option value="all">All accounts</option>{result.accounts.map(a=><option key={a.account} value={a.account}>{labels[a.account]??a.account}</option>)}</select></label>
      <label style={{fontSize:12,display:'grid',gap:4}}>Search<input style={{...controls,minWidth:240}} value={term} placeholder="Basepack, SKU, brand, branch…" onChange={e=>{setTerm(e.target.value);setPage(0);}}/></label>
      <label style={{fontSize:12,display:'flex',alignItems:'center',gap:6,paddingBottom:10}}><input type="checkbox" checked={onlyGaps} onChange={e=>{setOnlyGaps(e.target.checked);setPage(0);}}/> Only priority availability gaps</label>
     </div>
    </div>
    <div className="table-wrap"><table className="central-summary-table"><thead><tr><th>Account</th><th>Branch</th><th>Basepack</th><th>Brand</th><th>Full</th><th>Priority</th><th>Priority SKUs</th><th>Finding</th></tr></thead><tbody>
     {visibleBasepacks.slice(page*50,(page+1)*50).map(x=><tr key={`${x.account}|${x.branch}|${x.basepack}`}><td>{labels[x.account]??x.account}</td><td>{x.branch}</td><td>{x.basepack}</td><td>{x.brand}</td><td>{x.fullStatus}</td><td>{x.priorityStatus}</td><td>{x.prioritySkus||'—'}</td><td>{x.difference}</td></tr>)}
     {!visibleBasepacks.length&&<tr><td colSpan={8}>No matching basepacks in this scope.</td></tr>}
    </tbody></table></div>
    <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:10,marginTop:12}}><span style={{fontSize:12,color:'#586d83'}}>Showing {visibleBasepacks.length?page*50+1:0}–{Math.min((page+1)*50,visibleBasepacks.length)} of {visibleBasepacks.length}</span><div style={{display:'flex',gap:8}}><button style={button} disabled={!page} onClick={()=>setPage(p=>p-1)}>Previous</button><button style={button} disabled={(page+1)*50>=visibleBasepacks.length} onClick={()=>setPage(p=>p+1)}>Next</button></div></div>
   </section>
   <p style={{fontSize:12,color:'#586d83',marginTop:13}}>The Excel export includes daily comparisons, BU, category, brand and format breakdowns, all latest mapped basepacks, and an audit of the uploaded priority SKUs. No data is written to Supabase.</p>
  </>}
 </div>;
}
