'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Search, Upload } from 'lucide-react';

type Product = {
  id:string; ubl_code:string; name:string; status:string; brand:string|null; basepack_id:string; packsize:string;
  business_group:string|null; category:string|null; sub_category:string|null; product_type:string|null; retail_type:string|null; variant:string|null;
};
type Mapping = { product_id:string; account_code:string; account_name:string; account_sku:string };

export default function MasterView() {
  const [products,setProducts]=useState<Product[]>([]); const [mappings,setMappings]=useState<Mapping[]>([]); const [latestImport,setLatestImport]=useState<any>(null);
  const [search,setSearch]=useState(''); const [account,setAccount]=useState('all'); const [error,setError]=useState('');

  useEffect(()=>{fetch('/api/master',{cache:'no-store'}).then(async(r)=>{const j=await r.json();if(!r.ok)throw new Error(j.error||'Failed to load master.');setProducts(j.products||[]);setMappings(j.mappings||[]);setLatestImport(j.latestImport||null);}).catch((e)=>setError(e.message));},[]);

  const accountNames=useMemo(()=>[...new Map(mappings.map((m)=>[m.account_code,m.account_name])).entries()].sort((a,b)=>a[1].localeCompare(b[1])),[mappings]);
  const mappingMap=useMemo(()=>{const map=new Map<string,Mapping[]>();for(const m of mappings){const arr=map.get(m.product_id)??[];arr.push(m);map.set(m.product_id,arr);}return map;},[mappings]);
  const filtered=products.filter((p)=>{const q=search.toLowerCase().trim();if(q&&!`${p.ubl_code} ${p.name} ${p.brand??''} ${p.packsize??''} ${p.business_group??''} ${p.category??''} ${p.sub_category??''}`.toLowerCase().includes(q))return false;if(account!=='all'&&!(mappingMap.get(p.id)??[]).some((m)=>m.account_code===account))return false;return true;});
  const basepackCount=new Set(products.map((p)=>p.basepack_id)).size;

  return <div className="page">
    <div className="page-head"><div><span className="eyebrow">Source of truth</span><h1>Master Data</h1><p>Packsize is the basepack. UBL Codes are SKUs under that basepack. All hierarchy fields come directly from the uploaded master.</p></div><Link href="/uploads?tab=master" className="button"><Upload size={16}/>Upload new master</Link></div>
    {error&&<div className="alert error">{error}</div>}
    <section className="kpi-grid">
      <div className="kpi"><span>Basepacks</span><strong>{basepackCount}</strong><small>unique Packsize values</small></div>
      <div className="kpi"><span>UBL SKUs</span><strong>{products.length}</strong><small>{products.filter((p)=>p.status==='active').length} active</small></div>
      <div className="kpi"><span>Account mappings</span><strong>{mappings.length}</strong><small>blank account cells = not listed</small></div>
    </section>
    <section className="card">
      <div className="toolbar"><div className="search-box"><Search size={17}/><input value={search} onChange={(e)=>setSearch(e.target.value)} placeholder="Search UBL code, product, basepack, brand or hierarchy"/></div><select value={account} onChange={(e)=>setAccount(e.target.value)}><option value="all">All accounts</option>{accountNames.map(([code,name])=><option key={code} value={code}>{name}</option>)}</select></div>
      <div className="table-wrap"><table><thead><tr><th>UBL Code / SKU</th><th>Basepack (Packsize)</th><th>Business Group</th><th>Category / Sub Category</th><th>Brand</th><th>Type / Retail Type</th><th>{account==='all'?'Mapped accounts':'Account SKU'}</th></tr></thead><tbody>
        {filtered.map((p)=>{const ms=mappingMap.get(p.id)??[];const scoped=account==='all'?ms:ms.filter((m)=>m.account_code===account);return <tr key={p.id}><td><strong>{p.name}</strong><small>{p.ubl_code} · {p.status}</small></td><td className="mono">{p.packsize}</td><td>{p.business_group||'—'}</td><td><strong>{p.category||'—'}</strong><small>{p.sub_category||'—'} · {p.variant||'—'}</small></td><td>{p.brand||'—'}</td><td><strong>{p.product_type||'—'}</strong><small>{p.retail_type||'—'}</small></td><td>{account==='all'?`${new Set(ms.map((m)=>m.account_code)).size} accounts`:scoped.map((m)=>m.account_sku).join(' | ')||'—'}</td></tr>;})}
      </tbody></table></div>
    </section>
    {latestImport&&<p className="muted">Latest master: {latestImport.file_name} · {latestImport.basepack_count??basepackCount} basepacks · {new Date(latestImport.imported_at).toLocaleString('en-GB')}</p>}
  </div>;
}
