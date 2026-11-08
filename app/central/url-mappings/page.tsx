'use client';
import { useCallback,useMemo,useState } from 'react';
import Link from 'next/link';

type Master={account_sku:string;packsize:string;product_name:string};
type Existing={account_sku:string;product_url:string;updated_at?:string};
type Preview={sku:string;url:string;old:string;name:string;basepack:string;type:'new'|'change'|'unchanged'|'unmatched'|'conflict'|'invalid'};
const aliases=['sku','skuid','accountsku','productsku','itemsku'];
const urls=['producturl','url','link','productlink','websiteurl'];
function norm(s:unknown){return String(s??'').trim();}
function header(s:unknown){return norm(s).toLowerCase().replace(/[^a-z0-9]/g,'');}
function exportCsv(rows:Record<string,string>[],filename:string){
 const headers=Object.keys(rows[0]||{SKU:'',URL:''});
 const csv=[headers.join(','),...rows.map(r=>headers.map(k=>'"'+String(r[k]??'').replace(/"/g,'""')+'"').join(','))].join('\r\n');
 const u=URL.createObjectURL(new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=u;a.download=filename;a.click();URL.revokeObjectURL(u);
}
export default function URLMappingPage(){
 const [account,setAccount]=useState('shajgoj');const [token,setToken]=useState('');
 const [master,setMaster]=useState<Master[]>([]);const [existing,setExisting]=useState<Existing[]>([]);
 const [raw,setRaw]=useState<{sku:string;url:string}[]>([]);const [error,setError]=useState('');const [message,setMessage]=useState('');const [busy,setBusy]=useState(false);const [filter,setFilter]=useState('all');
 const load=useCallback(async()=>{
  if(!token){setError('Enter the admin access key');return;}
  setBusy(true);setError('');setMessage('');
  try{const response=await fetch('/api/central/url-mappings?account='+encodeURIComponent(account),{headers:{'x-url-mapping-admin-token':token},cache:'no-store'});const json=await response.json();if(!response.ok)throw new Error(json.error);setMaster(json.master||[]);setExisting(json.current||[]);setRaw([]);setMessage(`Loaded ${json.master.length} master mappings and ${json.current.length} saved URLs`);}catch(e){setError(e instanceof Error?e.message:'Could not load');}finally{setBusy(false);}
 },[account,token]);
 const preview=useMemo(()=>{
  const m=new Map(master.map(r=>[norm(r.account_sku),r]));const prev=new Map(existing.map(r=>[norm(r.account_sku),r.product_url]));
  const seen=new Map<string,Set<string>>();for(const r of raw){if(!seen.has(r.sku))seen.set(r.sku,new Set());seen.get(r.sku)?.add(r.url);}
  return raw.map(r=>{const item=m.get(r.sku);const old=prev.get(r.sku)||'';let type:Preview['type']='new';
    if(!item)type='unmatched';else if((seen.get(r.sku)?.size??0)>1)type='conflict';
    else {try{const u=new URL(r.url);if(u.protocol!=='https:'||u.username||u.password||u.port||u.hash||(account==='shajgoj'&&u.hostname!=='shop.shajgoj.com'))type='invalid';else type=old===u.toString()?'unchanged':old?'change':'new';}catch{type='invalid';}}
    return {sku:r.sku,url:r.url,old,name:item?.product_name||'',basepack:item?.packsize||'',type};
  });
 },[raw,master,existing,account]);
 const counts=useMemo(()=>preview.reduce((a,r)=>({...a,[r.type]:(a[r.type]||0)+1}),{} as Record<string,number>),[preview]);
 const accepted=useMemo(()=>{const seen=new Set<string>();return preview.filter(r=>{if(!['new','change','unchanged'].includes(r.type)||seen.has(r.sku))return false;seen.add(r.sku);return r.type!=='unchanged';});},[preview]);
 async function fileChosen(f:File|undefined){if(!f)return;setError('');setMessage('');
  try{const ExcelJS=(await import('exceljs')).default;const wb=new ExcelJS.Workbook();await wb.xlsx.load(await f.arrayBuffer() as any);const sheet=wb.worksheets[0];if(!sheet)throw new Error('No worksheet found');
   const out:{sku:string;url:string}[]=[];let skuCol=0,urlCol=0;const head=sheet.getRow(1);
   head.eachCell((cell,i)=>{const h=header(cell.text);if(aliases.includes(h))skuCol=i;if(urls.includes(h))urlCol=i;});
   if(!skuCol||!urlCol)throw new Error('Headers must contain SKU ID and Product URL (or equivalent)');
   sheet.eachRow((row,index)=>{if(index===1)return;const sku=norm(row.getCell(skuCol).text);const url=norm(row.getCell(urlCol).text);if(sku||url)out.push({sku,url});});
   if(out.length>5000)throw new Error('Upload maximum is 5,000 rows');setRaw(out);setMessage(`${out.length} rows parsed; review before applying`);
  }catch(e){setError(e instanceof Error?e.message:'Cannot read Excel');}
 }
 async function apply(){if(!accepted.length)return;setBusy(true);setError('');try{
  const old=new Map(existing.map(r=>[r.account_sku,r.product_url]));const rows=accepted.map(r=>({account_sku:r.sku,product_url:r.url}));const expected=Object.fromEntries(rows.map(r=>[r.account_sku,old.get(r.account_sku)||'']));
  const res=await fetch('/api/central/url-mappings',{method:'POST',headers:{'Content-Type':'application/json','x-url-mapping-admin-token':token},body:JSON.stringify({account,rows,expected})});const json=await res.json();if(!res.ok)throw new Error(json.error);setMessage(`Saved ${json.changed} mappings. Batch ${json.batch_id}. Rerun ${account} scraper to apply URLs.`);setExisting(old=>{const map=new Map(old.map(r=>[r.account_sku,r]));for(const r of rows)map.set(r.account_sku,{account_sku:r.account_sku,product_url:r.product_url});return [...map.values()];});setRaw([]);
 }catch(e){setError(e instanceof Error?e.message:'Save failed');}finally{setBusy(false);}}
 const shown=preview.filter(r=>filter==='all'||r.type===filter).slice(0,500);
 return <main style={{maxWidth:1180,margin:'0 auto',padding:'32px 24px',color:'#17202c'}}>
  <Link href="/" style={{color:'#355d85'}}>← Central Availability</Link>
  <h1 style={{fontSize:28,fontWeight:750,margin:'14px 0 6px'}}>Account SKU–URL Mapping Manager</h1>
  <p style={{color:'#69758a'}}>Permanent, account-specific verified URLs. Upload any larger Excel catalog; only existing Master SKU IDs may be updated.</p>
  <section style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))',gap:12,marginTop:24}}>
   <label>Account<input value={account} onChange={e=>{setAccount(e.target.value.trim().toLowerCase());setMaster([]);setExisting([]);setRaw([]);}} placeholder="shajgoj" style={{display:'block',width:'100%',padding:12,border:'1px solid #ccd5e0',borderRadius:9}}/></label>
   <label>Admin access key<input type="password" value={token} autoComplete="off" onChange={e=>setToken(e.target.value)} placeholder="URL_MAPPING_ADMIN_TOKEN" style={{display:'block',width:'100%',padding:12,border:'1px solid #ccd5e0',borderRadius:9}}/></label>
   <button disabled={busy} onClick={load} style={{alignSelf:'end',padding:13,borderRadius:9,background:'#162c49',color:'white',cursor:'pointer'}}>Load account mappings</button>
  </section>
  <section style={{display:'flex',gap:18,flexWrap:'wrap',marginTop:22,alignItems:'center'}}>
   <strong>Active Master SKUs: {new Set(master.map(r=>r.account_sku)).size}</strong><strong>Verified URLs: {existing.length}</strong><strong>Unmapped: {Math.max(0,new Set(master.map(r=>r.account_sku)).size-existing.length)}</strong>
   <button onClick={()=>exportCsv([{ 'SKU ID':'13822','Product URL':'https://shop.shajgoj.com/product/replace-with-real-slug'}],'sku_url_template.csv')} style={{border:'1px solid #ccd5e0',padding:'9px 12px',borderRadius:8}}>Download CSV template</button>
  </section>
  <section style={{marginTop:24,border:'1px solid #d7e0e9',borderRadius:14,padding:20}}>
   <h2 style={{fontSize:19,marginTop:0}}>1. Upload SKU–URL workbook</h2>
   <p style={{fontSize:13,color:'#657285'}}>Excel .xlsx file with columns such as “SKU ID” and “Product URL”. Extra columns and SKUs outside this account are ignored.</p>
   <input type="file" accept=".xlsx" onChange={e=>fileChosen(e.target.files?.[0])} disabled={!master.length||busy}/>
   <div style={{display:'flex',flexWrap:'wrap',gap:12,marginTop:18}}>{['new','change','unchanged','unmatched','conflict','invalid'].map(type=><button key={type} onClick={()=>setFilter(type)} style={{padding:'10px 13px',borderRadius:9,border:'1px solid #d7e0e9',background:filter===type?'#e5eefc':'white'}}>{type}: {counts[type]||0}</button>)}<button onClick={()=>setFilter('all')} style={{padding:'10px 13px'}}>All ({raw.length})</button></div>
   {error&&<p role="alert" style={{color:'#b42318'}}>{error}</p>}{message&&<p style={{color:'#166534'}}>{message}</p>}
   {raw.length>0&&<><div style={{overflowX:'auto',marginTop:16}}><table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}><thead><tr>{['SKU','Master product','Old URL','New URL','Result'].map(x=><th key={x} style={{padding:10,borderBottom:'1px solid #d7e0e9',textAlign:'left'}}>{x}</th>)}</tr></thead><tbody>{shown.map((r,i)=><tr key={r.sku+'-'+i}><td style={{padding:9,borderBottom:'1px solid #e8edf3'}}>{r.sku}</td><td>{r.name}</td><td style={{wordBreak:'break-all'}}>{r.old}</td><td style={{wordBreak:'break-all'}}>{r.url}</td><td>{r.type}</td></tr>)}</tbody></table></div><p style={{fontSize:12,color:'#64748b'}}>Showing first {shown.length} matching rows. Unmatched and conflicting rows will never be saved.</p><button onClick={()=>exportCsv(preview.map(r=>({SKU:r.sku,URL:r.url,Status:r.type,OldURL:r.old})),`${account}_url_preview.csv`)} style={{padding:12,border:'1px solid #ccd5e0',borderRadius:8,marginRight:10}}>Export audit CSV</button><button disabled={busy||!accepted.length} onClick={apply} style={{padding:12,background:'#166534',color:'#fff',borderRadius:8,opacity:(busy||!accepted.length) ? 0.6 : 1}}>Approve & save {accepted.length} URLs</button></>}
  </section>
 </main>;
}
