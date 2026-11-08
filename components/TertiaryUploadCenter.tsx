'use client';
import {useEffect,useMemo,useState} from 'react';

type PreviewRow={account_sku:string;product_name:string;sales_qty:number;revenue:number|null;mapped_to_master:boolean};
type Preview={month:string;inputRows:number;uniqueSkuCount:number;quantityTotal:number;revenueTotal:number|null;matchedCount:number;unmatchedCount:number;revenueCoverage:number;issues:string[];canApprove:boolean;fileHash:string;preview:PreviewRow[];unmatchedPreview:PreviewRow[];note:string};
type ReportRow={month_start:string;account_name:string;account_code:string;sku_id:string;ubl_code:string|null;sku_perfect_name:string|null;source_product_name:string|null;category:string|null;brand:string|null;pack_size:string|null;format:string|null;sales_qty:number;revenue:number|null;avg_realized_price:number|null;mapped_to_master:boolean};
function csvExport(rows:ReportRow[],month:string){
 const columns:[string,(r:ReportRow)=>string|number|null][]=[['MONTH',r=>r.month_start],['ACCOUNT NAME',r=>r.account_name],['SKU ID',r=>r.sku_id],['UBL CODE',r=>r.ubl_code],['SKU PERFECT NAME',r=>r.sku_perfect_name||r.source_product_name],['CATEGORY NAME',r=>r.category],['BRAND',r=>r.brand],['PACK SIZE',r=>r.pack_size],['REVENUE',r=>r.revenue],['SALES QTY',r=>r.sales_qty],['AVG REALIZED PRICE',r=>r.avg_realized_price],['FORMAT',r=>r.format],['MAPPING STATUS',r=>r.mapped_to_master?'Matched':'Unmatched']];
 const quote=(v:string|number|null)=>`"${String(v??'').replace(/"/g,'""')}"`;
 const content='\ufeff'+[columns.map(c=>quote(c[0])).join(','),...rows.map(r=>columns.map(c=>quote(c[1](r))).join(','))].join('\r\n');
 const url=URL.createObjectURL(new Blob([content],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=`Tertiary_Sales_${month}.csv`;a.click();URL.revokeObjectURL(url);
}
const accounts=[{code:'arogga',label:'Arogga'},{code:'beauty_booth',label:'BeautyBooth'},{code:'cartup',label:'Cartup'},{code:'chaldal',label:'Chaldal'},{code:'daraz',label:'Daraz'},{code:'foodi',label:'Foodi'},{code:'meenabazar',label:'Meenabazar'},{code:'othoba',label:'Othoba'},{code:'pandamart',label:'Pandamart'},{code:'rokomari',label:'Rokomari'},{code:'shajgoj',label:'Shajgoj'},{code:'shwapno',label:'Shwapno'},{code:'ushop',label:'Ushop'}];
export default function TertiaryUploadCenter(){
 const [tab,setTab]=useState<'upload'|'report'>('upload');
 const [account,setAccount]=useState('shajgoj');const [month,setMonth]=useState('2026-09');const [file,setFile]=useState<File|null>(null);const [token,setToken]=useState('');
 const [preview,setPreview]=useState<Preview|null>(null);const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [message,setMessage]=useState('');
 const [reportMonth,setReportMonth]=useState('2026-09');const [reportAccount,setReportAccount]=useState('');const [mappingFilter,setMappingFilter]=useState<'all'|'matched'|'unmatched'>('all');const [search,setSearch]=useState('');const [rows,setRows]=useState<ReportRow[]>([]);const [loaded,setLoaded]=useState(false);
 useEffect(()=>{setPreview(null);setError('');setMessage('');},[account,month,file]);
 const shown=useMemo(()=>rows.filter(r=>(mappingFilter==='all'||(mappingFilter==='matched')===r.mapped_to_master)&&`${r.sku_id} ${r.sku_perfect_name||''} ${r.source_product_name||''} ${r.brand||''}`.toLowerCase().includes(search.toLowerCase())),[rows,mappingFilter,search]);
 const totalQty=shown.reduce((n,r)=>n+Number(r.sales_qty),0);const knownRevenue=shown.filter(r=>r.revenue!==null);const revenue=knownRevenue.reduce((n,r)=>n+Number(r.revenue),0);
 async function upload(action:'preview'|'commit'){
  if(!file){setError('Choose the monthly sales Excel template.');return;}
  setBusy(true);setError('');setMessage('');
  try{
   const form=new FormData();form.set('file',file);form.set('account',account);form.set('month',month);form.set('action',action);if(action==='commit'&&preview)form.set('fileHash',preview.fileHash);
   const response=await fetch('/api/tertiary/import',{method:'POST',headers:{'x-url-mapping-admin-token':token},body:form});const json=await response.json();if(!response.ok)throw new Error(json.error||'Import failed');
   if(action==='preview')setPreview(json);
   else{setMessage(`Saved ${json.result.rows} sales records for ${month}; ${json.unmatchedCount} unmatched SKU(s) retained in reporting.`);setPreview(null);}
  }catch(e){setError(e instanceof Error?e.message:'Upload failed');}finally{setBusy(false);}
 }
 async function load(){setBusy(true);setError('');setLoaded(false);try{
  const q=new URLSearchParams({month:reportMonth});if(reportAccount)q.set('account',reportAccount);
  const res=await fetch(`/api/tertiary/report?${q.toString()}`,{headers:{'x-url-mapping-admin-token':token}});const json=await res.json();if(!res.ok)throw new Error(json.error||'Unable to fetch sales history');setRows(json.rows||[]);setLoaded(true);
 }catch(e){setError(e instanceof Error?e.message:'Unable to load');}finally{setBusy(false);}}
 return <div className="page">
  <div className="page-head"><div><h1>Tertiary Report</h1><p>One standard sales upload per account and month. Every product sale is kept — even when its SKU is missing from Master SKU.</p></div></div>
  <div className="segment-tabs"><button className={tab==='upload'?'active':''} onClick={()=>setTab('upload')}>Monthly Sales Upload</button><button className={tab==='report'?'active':''} onClick={()=>setTab('report')}>Monthly Master & Unmatched SKUs</button></div>
  {error&&<div className="card" role="alert" style={{padding:16,color:'#b4233a',marginBottom:12}}>{error}</div>}
  {message&&<div className="card" role="status" style={{padding:16,color:'#168259',marginBottom:12}}>{message}</div>}
  {tab==='upload'?<>
   <div className="card" style={{padding:18,marginBottom:14}}><h3>Standard Monthly Sales Template</h3><p>One file per account and month. Required columns: Account SKU ID and Units Sold. Revenue, source product name, and notes are optional. Never add or manually fill Master SKU metadata.</p><p><strong>Unmatched SKU IDs are accepted.</strong> They are included in totals, history, and downloads; their brand/category/UBL fields remain blank until mapped.</p><a href="/templates/UBL_Tertiary_Monthly_Account_Sales_Upload_Template.xlsx" download style={{fontWeight:700,textDecoration:"underline"}}>Download standardized monthly sales template (.xlsx)</a></div>
   <div className="card" style={{padding:20,display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(210px,1fr))',gap:16}}>
    <label>Account<select value={account} onChange={e=>setAccount(e.target.value)}>{accounts.map(a=><option key={a.code} value={a.code}>{a.label}</option>)}</select></label>
    <label>Reporting month<input type="month" value={month} onChange={e=>setMonth(e.target.value)}/></label>
    <label>Standard sales workbook (.xlsx)<input type="file" accept=".xlsx" onChange={e=>setFile(e.target.files?.[0]||null)}/></label>
    <label>Admin access key<input type="password" autoComplete="off" value={token} onChange={e=>setToken(e.target.value)}/></label>
   </div>
   <div className="card" style={{padding:16,marginTop:14}}><p>The account and month selected above must match cells <strong>B4</strong> and <strong>B5</strong> in the Excel template. Only invalid rows or duplicate account SKU IDs block approval; missing Master SKU mappings do not.</p><button disabled={busy||!file} onClick={()=>upload('preview')}>{busy?'Checking...':'Preview & Check Sales'}</button></div>
   {preview&&<div className="card" style={{marginTop:14,padding:18}}><h3>Upload preview — {preview.month}</h3>
    <div style={{display:'flex',gap:24,flexWrap:'wrap',margin:'14px 0'}}>{[['Sales SKUs',preview.uniqueSkuCount],['Matched Master SKU',preview.matchedCount],['Unmatched — INCLUDED',preview.unmatchedCount],['Total units',preview.quantityTotal],['Revenue',preview.revenueTotal===null?'Not provided':`৳${preview.revenueTotal.toLocaleString()}`]].map(([label,value])=><div key={String(label)}><strong style={{fontSize:21}}>{value}</strong><div style={{opacity:.7,fontSize:12}}>{label}</div></div>)}</div>
    {preview.issues.length>0&&<div style={{padding:12,background:'#fff2e4',borderRadius:8}}>{preview.issues.map((issue,i)=><p key={i}>{issue}</p>)}</div>}
    <div style={{overflowX:'auto',marginTop:14}}><table style={{width:'100%'}}><thead><tr><th>SKU ID</th><th>Source product</th><th>Units</th><th>Revenue</th><th>Master mapping</th></tr></thead><tbody>{preview.preview.map((r,i)=><tr key={i}><td>{r.account_sku}</td><td>{r.product_name||'—'}</td><td>{r.sales_qty}</td><td>{r.revenue??'—'}</td><td>{r.mapped_to_master?'Matched':'Unmatched · included'}</td></tr>)}</tbody></table></div>
    <p style={{fontSize:13,opacity:.75}}>All valid sales records will be saved, including {preview.unmatchedCount} unmatched IDs. A re-upload for this account/month versions the previous snapshot instead of adding the sales twice.</p>
    <button disabled={busy||!preview.canApprove} onClick={()=>upload('commit')}>{busy?'Saving...':'Approve & Save ALL Sales'}</button>
   </div>}
  </>:<>
   <div className="card" style={{padding:16,display:'flex',gap:14,alignItems:'end',flexWrap:'wrap'}}><label>Month<input type="month" value={reportMonth} onChange={e=>{setReportMonth(e.target.value);setLoaded(false);}}/></label><label>Account<select value={reportAccount} onChange={e=>{setReportAccount(e.target.value);setLoaded(false);}}><option value="">All accounts</option>{accounts.map(a=><option value={a.code} key={a.code}>{a.label}</option>)}</select></label><label>Mapping status<select value={mappingFilter} onChange={e=>setMappingFilter(e.target.value as typeof mappingFilter)}><option value="all">All sales</option><option value="matched">Matched only</option><option value="unmatched">Unmatched only</option></select></label><button disabled={busy} onClick={load}>{busy?'Loading...':'Load sales'}</button><button disabled={!shown.length} onClick={()=>csvExport(shown,reportMonth)}>Export visible scope CSV</button></div>
   <div className="card" style={{padding:16,marginTop:14}}><label>Search SKU / product<input value={search} onChange={e=>setSearch(e.target.value)} placeholder="SKU ID or product name"/></label>
    {loaded?<><p><strong>{shown.length.toLocaleString()} product sales records</strong> · {totalQty.toLocaleString()} units sold · {knownRevenue.length?`৳${revenue.toLocaleString()} reported revenue (coverage ${knownRevenue.length}/${shown.length})`:'Revenue not supplied'} · {shown.filter(r=>!r.mapped_to_master).length} unmatched</p>
    <div style={{overflowX:'auto'}}><table style={{width:'100%'}}><thead><tr>{['Account','SKU ID','Product name','Units sold','Revenue','Avg realized price','UBL Code','Brand','Category','Mapping'].map(v=><th key={v}>{v}</th>)}</tr></thead><tbody>{shown.slice(0,500).map((r,i)=><tr key={`${r.account_code}-${r.sku_id}-${i}`}><td>{r.account_name}</td><td>{r.sku_id}</td><td>{r.sku_perfect_name||r.source_product_name||'Unnamed product'}</td><td>{r.sales_qty}</td><td>{r.revenue??'—'}</td><td>{r.avg_realized_price??'—'}</td><td>{r.ubl_code||'—'}</td><td>{r.brand||'—'}</td><td>{r.category||'—'}</td><td>{r.mapped_to_master?'Matched':'Unmatched · retained'}</td></tr>)}</tbody></table></div><p style={{opacity:.7}}>Screen displays up to 500 rows. CSV contains all rows in your selected filters. Unmatched sales always count in totals.</p></>:<p>Select a month and click Load sales.</p>}
   </div>
  </>}
 </div>;
}
