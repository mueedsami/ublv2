'use client';

import {useMemo,useState} from 'react';
import Link from 'next/link';
import {AlertCircle,ArrowLeft,Download,FileSpreadsheet,RefreshCw,UploadCloud} from 'lucide-react';

type BranchRow={account:string;branch:string;date:string;basepacks:number;available:number;oos:number;unknown:number;ola:number|null;observedDays:number;averageDailyOla:number|null};
type AccountRow={account:string;prioritySkus:number;branches:number;available:number;oos:number;unknown:number;ola:number|null};
type PriorityDetail={account:string;sku:string;productName:string;basepack:string;branch:string;latestDate:string;observedDays:number;status:string};
type Result={priorityDetails:PriorityDetail[];filename:string;start:string;end:string;uploaded:number;duplicatesRemoved:number;ignoredEmptyRows:number;observedPrioritySkus:number;notObservedPrioritySkus:number;ola:number|null;available:number;oos:number;unknown:number;accountSummary:AccountRow[];branches:BranchRow[];message:string;info:{runs:number;issues:number}};
const labels:Record<string,string>={arogga:'Arogga',cartup:'Cartup',daraz:'Daraz',othoba:'Othoba',pandamart:'PandaMart',shajgoj:'Shajgoj',shwapno:'Shwapno',beauty_booth:'BeautyBooth',ushop:'Ushop',foodi:'Foodi'};
function dhakaDate(){const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Dhaka',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());return `${parts.find(p=>p.type==='year')?.value}-${parts.find(p=>p.type==='month')?.value}-${parts.find(p=>p.type==='day')?.value}`;}
const formatPct=(value:number|null)=>value===null?'—':`${(value*100).toFixed(2)}%`;
const buttonStyle={display:'inline-flex',alignItems:'center',justifyContent:'center',gap:8,padding:'11px 16px',borderRadius:9,border:'1px solid #d9e2ef',fontWeight:650,cursor:'pointer'} as const;

export default function PriorityOlaPage(){
 const [file,setFile]=useState<File|null>(null);
 const [end,setEnd]=useState(()=>dhakaDate());
 const [start,setStart]=useState(()=>`${dhakaDate().slice(0,7)}-01`);
 const [busy,setBusy]=useState<'preview'|'download'|null>(null);
 const [result,setResult]=useState<Result|null>(null);
 const [error,setError]=useState('');
 const [skuSearch,setSkuSearch]=useState('');
 const [skuPage,setSkuPage]=useState(0);
 const filteredSku=useMemo(()=>{const query=skuSearch.toLowerCase().trim();return (result?.priorityDetails??[]).filter(r=>!query||[r.account,r.sku,r.productName,r.basepack,r.branch,r.status].some(v=>v.toLowerCase().includes(query)));},[result,skuSearch]);
 const available=useMemo(()=>result?.accountSummary.reduce((sum,row)=>sum+row.available,0)??0,[result]);
 const oos=useMemo(()=>result?.accountSummary.reduce((sum,row)=>sum+row.oos,0)??0,[result]);
 async function run(mode:'preview'|'download'){
  if(!file){setError('Choose an Excel file with Account Name, SKU ID, and Product Name.');return;}
  if(start>end){setError('Start date must be before or equal to end date.');return;}
  setError('');setBusy(mode);
  try{
   const form=new FormData();form.append('file',file);form.append('start',start);form.append('end',end);form.append('mode',mode);
   const response=await fetch('/api/central/priority-ola',{method:'POST',body:form,cache:'no-store'});
   if(!response.ok){const payload=await response.json().catch(()=>null) as {error?:string}|null;throw new Error(payload?.error??`Report request failed (${response.status})`);}
   if(mode==='preview'){
    setResult(await response.json() as Result);setSkuPage(0);
   }else{
    const blob=await response.blob(),url=URL.createObjectURL(blob);
    const link=document.createElement('a');link.href=url;link.download=`UBL_Priority_Basepack_OLA_${start}_${end}.xlsx`;
    document.body.appendChild(link);link.click();link.remove();window.setTimeout(()=>URL.revokeObjectURL(url),1000);
   }
  }catch(err){setError(err instanceof Error?err.message:'Unable to generate report.');}
  finally{setBusy(null);}
 }
 return <div className="page" style={{maxWidth:1420,paddingBottom:42}}>
  <div className="page-head" style={{display:'flex',justifyContent:'space-between',alignItems:'start',gap:16}}>
   <div><div style={{marginBottom:8,fontSize:12,letterSpacing:1,textTransform:'uppercase',color:'#315d9c',fontWeight:700}}>Central Availability / Priority Intelligence</div>
    <h1>Priority SKU OLA</h1>
    <p>Track only the account SKUs on your uploaded priority list. Analyze daily availability by account, basepack and PandaMart branch.</p>
   </div>
   <Link href="/" className="button secondary"><ArrowLeft size={15}/> Central Availability</Link>
  </div>
  <section style={{border:'1px solid #e0e7f1',borderRadius:14,background:'white',padding:22,marginBottom:18}}>
   <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:16}}><UploadCloud size={22} color="#275e9f"/><h2 style={{fontSize:18,margin:0}}>Upload priority SKU list</h2></div>
   <p style={{margin:'0 0 16px',color:'#58677d',fontSize:13}}>Upload an .xlsx workbook with exactly these identifiers: <strong>Account Name</strong>, <strong>SKU ID</strong>, and <strong>Product Name</strong>. Rows from different accounts can be mixed; the report groups them automatically. SKU IDs are matched as text.</p>
   <div style={{display:'grid',gridTemplateColumns:'minmax(250px,2fr) repeat(2,minmax(150px,1fr))',gap:14,alignItems:'end'}}>
    <label style={{display:'grid',gap:7,fontSize:12,fontWeight:700}}>Priority list (.xlsx)
     <input aria-label="Priority SKU Excel workbook" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" style={{padding:10,border:'1px solid #d9e2ef',borderRadius:8,width:'100%'}} onChange={e=>{setFile(e.target.files?.[0]??null);setResult(null);setError('');}}/>
    </label>
    <label style={{display:'grid',gap:7,fontSize:12,fontWeight:700}}>From
     <input aria-label="Start date" type="date" value={start} max={end} onChange={e=>{setStart(e.target.value);setResult(null);}} style={{padding:10,border:'1px solid #d9e2ef',borderRadius:8}}/>
    </label>
    <label style={{display:'grid',gap:7,fontSize:12,fontWeight:700}}>To
     <input aria-label="End date" type="date" value={end} max={dhakaDate()} min={start} onChange={e=>{setEnd(e.target.value);setResult(null);}} style={{padding:10,border:'1px solid #d9e2ef',borderRadius:8}}/>
    </label>
   </div>
   <div style={{display:'flex',gap:10,flexWrap:'wrap',marginTop:18}}>
    <button style={{...buttonStyle,background:'#173765',borderColor:'#173765',color:'white',opacity:busy?0.6:1}} disabled={!!busy} onClick={()=>void run('preview')}>
     {busy==='preview'?<RefreshCw size={16}/>:<FileSpreadsheet size={16}/>} {busy==='preview'?'Calculating...':'Check Priority OLA'}
    </button>
    <button style={{...buttonStyle,background:'white',color:'#173765',opacity:busy?0.6:1}} disabled={!!busy} onClick={()=>void run('download')}>
     <Download size={16}/>{busy==='download'?'Generating workbook...':'Download Full Basepack Report (.xlsx)'}
    </button>
   </div>
   <div style={{fontSize:12,color:'#66758d',marginTop:14}}>Upload is processed for this request only. No Excel file or priority list is saved in Supabase, and no database records are modified. A maximum 62-day date range is supported.</div>
  </section>
  {error&&<div className="alert error" role="alert" style={{marginBottom:14,display:'flex',gap:10,alignItems:'center'}}><AlertCircle size={17}/>{error}</div>}
  {result&&<>
   <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(170px,1fr))',gap:12,marginBottom:18}}>
    {[
      ['Latest scope OLA',formatPct(result.ola)],
      ['Priority SKUs',result.uploaded.toLocaleString()],
      ['SKUs with observations',result.observedPrioritySkus.toLocaleString()],
      ['No observations',result.notObservedPrioritySkus.toLocaleString()],
      ['Available basepacks',available.toLocaleString()],
      ['OOS basepacks',oos.toLocaleString()],
    ].map(([label,value])=><div key={label} style={{border:'1px solid #e0e7f1',borderRadius:12,background:'white',padding:'15px 17px'}}>
      <div style={{fontSize:12,color:'#566a80'}}>{label}</div><div style={{fontSize:23,fontWeight:750,marginTop:6,color:'#152b4d'}}>{value}</div>
    </div>)}
   </div>
   <section style={{border:'1px solid #e0e7f1',borderRadius:14,background:'white',padding:20,marginBottom:16}}>
    <h2 style={{fontSize:18,margin:'0 0 6px'}}>Account-wise Priority OLA</h2>
    <p style={{fontSize:12,color:'#526884',margin:'0 0 14px'}}>The percentages below use each account/branch&apos;s latest observed day in the selected date range. Unknown and missing observations are excluded from the denominator.</p>
    <div className="table-wrap"><table className="central-summary-table"><thead><tr><th>Account</th><th>Priority SKUs</th><th>Branches</th><th>Available</th><th>OOS</th><th>Unknown</th><th>Priority OLA</th></tr></thead>
     <tbody>{result.accountSummary.map(r=><tr key={r.account}><td><strong>{labels[r.account]??r.account}</strong></td><td>{r.prioritySkus}</td><td>{r.branches||'—'}</td><td>{r.available}</td><td>{r.oos}</td><td>{r.unknown}</td><td><strong>{formatPct(r.ola)}</strong></td></tr>)}</tbody>
    </table></div>
   </section>
   <section style={{border:'1px solid #e0e7f1',borderRadius:14,background:'white',padding:20}}>
    <h2 style={{fontSize:18,margin:'0 0 12px'}}>Latest coverage by branch</h2>
    <div className="table-wrap"><table className="central-summary-table"><thead><tr><th>Account</th><th>Branch</th><th>Latest observation</th><th>Available</th><th>OOS</th><th>Unknown</th><th>OLA</th></tr></thead>
     <tbody>{result.branches.map(r=><tr key={`${r.account}:${r.branch}`}><td>{r.account}</td><td>{r.branch}</td><td>{r.date}</td><td>{r.available}</td><td>{r.oos}</td><td>{r.unknown}</td><td>{formatPct(r.ola)}</td></tr>)}
     {!result.branches.length&&<tr><td colSpan={7}>No observed priority SKUs in the selected period. You can still download the workbook to review the uploaded scope and missing mappings.</td></tr>}</tbody></table></div>
   </section>
   <section style={{border:'1px solid #e0e7f1',borderRadius:14,background:'white',padding:20,marginTop:16}}>
    <div style={{display:'flex',justifyContent:'space-between',gap:12,alignItems:'center',flexWrap:'wrap',marginBottom:12}}>
      <h2 style={{fontSize:18,margin:0}}>Priority SKU audit</h2>
      <input aria-label="Search priority SKUs" value={skuSearch} onChange={e=>{setSkuSearch(e.target.value);setSkuPage(0);}} placeholder="Search SKU ID, product, account, branch..." style={{padding:'9px 12px',minWidth:280,border:'1px solid #d9e2ef',borderRadius:8}}/>
    </div>
    <p style={{fontSize:12,color:'#526884',margin:'0 0 12px'}}>Each priority SKU is shown with its latest observed status and mapped basepack. PandaMart appears branch-wise. Unobserved SKUs are explicitly listed.</p>
    <div className="table-wrap"><table className="central-summary-table"><thead><tr><th>Account</th><th>SKU ID</th><th>Product Name</th><th>Basepack</th><th>Branch</th><th>Latest Date</th><th>Status</th></tr></thead>
      <tbody>{filteredSku.slice(skuPage*50,(skuPage+1)*50).map((r,i)=><tr key={`${r.account}|${r.sku}|${r.branch}|${i}`}>
        <td>{labels[r.account]??r.account}</td><td style={{whiteSpace:'nowrap'}}>{r.sku}</td><td>{r.productName}</td><td>{r.basepack||'—'}</td><td>{r.branch||'—'}</td><td>{r.latestDate||'—'}</td><td>{r.status}</td>
      </tr>)}
      {!filteredSku.length&&<tr><td colSpan={7}>No matching priority SKUs.</td></tr>}</tbody>
    </table></div>
    <div style={{display:'flex',gap:10,alignItems:'center',justifyContent:'space-between',marginTop:12}}>
      <span style={{color:'#526884',fontSize:12}}>Showing {filteredSku.length?skuPage*50+1:0}–{Math.min((skuPage+1)*50,filteredSku.length)} of {filteredSku.length}</span>
      <div style={{display:'flex',gap:8}}><button style={buttonStyle} disabled={skuPage===0} onClick={()=>setSkuPage(p=>p-1)}>Previous</button><button style={buttonStyle} disabled={(skuPage+1)*50>=filteredSku.length} onClick={()=>setSkuPage(p=>p+1)}>Next</button></div>
    </div>
   </section>
   {result.duplicatesRemoved>0&&<p style={{fontSize:12,color:'#526884',marginTop:12}}>Duplicate Account + SKU ID rows removed: {result.duplicatesRemoved}.</p>}
  </>}
 </div>;
}
