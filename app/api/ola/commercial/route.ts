import {NextResponse} from 'next/server';
import {getSupabaseAdmin} from '@/lib/supabase-admin';
import {dhakaToday} from '@/lib/ola-live-metrics';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;
const ACCOUNTS=['arogga','cartup','daraz','othoba','pandamart','shajgoj','shwapno'];
type Raw=Record<string,unknown>;
const str=(v:unknown)=>String(v??'').trim();
const norm=(v:unknown)=>str(v).toLowerCase();
const amount=(v:unknown)=>v===null||v===undefined||v===''||!Number.isFinite(Number(v))?null:Number(v);
const key=(a:unknown,s:unknown)=>`${norm(a)}|${norm(s)}`;
const branch=(v:unknown)=>norm(v).replace(/\s+/g,' ')||'all';
const db=getSupabaseAdmin;
async function read(table:string,columns:string,orders:string[],config?:(q:any)=>any,max=12000):Promise<Raw[]>{
 const c=db();const rows:Raw[]=[];
 for(let offset=0;offset<max;offset+=1000){
  let query=c.from(table).select(columns);
  if(config)query=config(query);
  for(const field of orders)query=query.order(field,{ascending:true});
  const {data,error}=await query.range(offset,offset+999);
  if(error)throw new Error(`${table}: ${error.message}`);
  const page:unknown=data??[];if(!Array.isArray(page))throw new Error(`${table}: unexpected response`);
  for(const v of page)if(v&&typeof v==='object'&&!Array.isArray(v))rows.push(v as Raw);
  if(page.length<1000)return rows;
 }
 throw new Error(`${table}: exceeds safe ${max}-row limit; the incomplete source was excluded.`);
}
export async function GET(){
 const warnings:string[]=[];
 const freshness:Record<string,string|null>={ola:null,cpp:null,sos:null,sales:null};
 try{
  const today=dhakaToday(),month=today.slice(0,7);
  const [observations,mappings,cppSource]=await Promise.all([
    read('v_ola_scraped_latest','account_code,account_sku,branch,status,observed_at,source_product', ['account_code','account_sku'],q=>q.in('account_code',ACCOUNTS),12000),
    read('v_account_mappings','account_code,account_sku,product_name,brand,business_group,status',['account_code','account_sku'],q=>q.in('account_code',ACCOUNTS).eq('status','active'),12000),
    read('v_cpp_latest_checks','account_code,account_sku,branch_code,branch_name,status,checked_at,expected_price,actual_price,price_difference',['account_code','account_sku'],q=>q.in('account_code',ACCOUNTS),12000)
      .catch(e=>{warnings.push(`CPP unavailable: ${String(e)}`);return [] as Raw[]}),
  ]);
  freshness.ola=observations.reduce<string|null>((s,v)=>str(v.observed_at)>str(s)?str(v.observed_at):s,null);
  freshness.cpp=cppSource.reduce<string|null>((s,v)=>str(v.checked_at)>str(s)?str(v.checked_at):s,null);
  const master=new Map<string,Raw>();const bad=new Set<string>();
  for(const m of mappings){if(!norm(m.account_sku))continue;
    const k=key(m.account_code,m.account_sku),old=master.get(k);
    if(old&&(str(old.product_name)!==str(m.product_name)||str(old.brand)!==str(m.brand)))bad.add(k);
    else if(!old)master.set(k,m);
  }
  if(bad.size)warnings.push(`${bad.size} conflicting master mappings were left unclassified.`);
  const cppIndex=new Map<string,Raw[]>();
  for(const p of cppSource){if(!norm(p.account_sku))continue;const k=key(p.account_code,p.account_sku);cppIndex.set(k,[...(cppIndex.get(k)??[]),p]);}
  type CommercialRow={account:string;sku:string;branch:string;product:string;brand:string;business_unit:string;
    ola_status:string;ola_observed_at:string;cpp_status:string|null;cpp_checked_at:string|null;
    cpp_expected_price:number|null;cpp_actual_price:number|null;cpp_difference:number|null;
    cpp_match:'exact-branch'|'account-only'|'none';risk:string};
  const rows:CommercialRow[]=[];
  for(const o of observations){const account=norm(o.account_code),sku=str(o.account_sku);if(!sku)continue;
    const mKey=key(account,sku),metadata=bad.has(mKey)?null:master.get(mKey)??null;
    const candidates=cppIndex.get(mKey)??[],b=branch(o.branch);
    const exact=candidates.filter(p=>branch(p.branch_name)===b||branch(p.branch_code)===b);
    const broad=candidates.filter(p=>branch(p.branch_name)==='all'&&branch(p.branch_code)==='all');
    const matchList=exact.length?exact:broad;
    const matched=matchList.length?[...matchList].sort((a,b)=>str(b.checked_at).localeCompare(str(a.checked_at)))[0]:null;
    const kind:CommercialRow['cpp_match']=exact.length?'exact-branch':broad.length?'account-only':'none';
    const os=norm(o.status),cs=matched?norm(matched.status):null;
    const risk=os==='unavailable'&&cs==='issue'?'OOS + CPP issue':os==='unavailable'?'Confirmed OOS':cs==='issue'?'CPP issue':os==='unknown'?'Unknown OLA':'No confirmed issue';
    rows.push({account,sku,branch:str(o.branch)||'All',product:str(metadata?.product_name)||str(o.source_product)||sku,
      brand:str(metadata?.brand),business_unit:str(metadata?.business_group),ola_status:os,ola_observed_at:str(o.observed_at),
      cpp_status:cs,cpp_checked_at:matched?str(matched.checked_at):null,
      cpp_expected_price:matched?amount(matched.expected_price):null,cpp_actual_price:matched?amount(matched.actual_price):null,
      cpp_difference:matched?amount(matched.price_difference):null,cpp_match:kind,risk});
  }
  const sos:{account:string;run_date:string;top_slots:number;ubl_count:number;share_pct:number|null;terms_scraped:number;terms_expected:number}[]=[];
  try{
    const runs=await read('sos_runs','id,account_id,run_date,status,started_at,terms_scraped,terms_expected',['started_at'],q=>q.in('status',['success','partial']),5000);
    const ids=await read('accounts','id,code',['code'],q=>q.in('code',ACCOUNTS),1000);
    const byId=new Map(ids.map(a=>[str(a.id),norm(a.code)]));
    const last=new Map<string,Raw>();
    for(const run of runs.sort((a,b)=>str(b.started_at).localeCompare(str(a.started_at)))){const code=byId.get(str(run.account_id));if(code&&!last.has(code))last.set(code,run);}
    for(const [account,run] of last){
      try{
        const all=await read('v_sos_keyword_metrics','top_slots,ubl_count',['top_slots'],q=>q.eq('run_id',run.id),5000);
        const slots=all.reduce((s,v)=>s+(amount(v.top_slots)??0),0),hits=all.reduce((s,v)=>s+(amount(v.ubl_count)??0),0);
        sos.push({account,run_date:str(run.run_date),top_slots:slots,ubl_count:hits,share_pct:slots?hits/slots*100:null,
          terms_scraped:amount(run.terms_scraped)??0,terms_expected:amount(run.terms_expected)??0});
      }catch(e){warnings.push(`SoS ${account}: ${String(e)}`)}
    }
    freshness.sos=sos.map(s=>s.run_date).sort().at(-1)??null;
  }catch(e){warnings.push(`SoS data unavailable: ${String(e)}`)}
  const sales:{account:string;period:string;basis:string;qty:number;sku_count:number;comparable:boolean}[]=[];
  const config=[
    {account:'daraz',table:'daraz_stock_daily',field:'stock_date',qty:'gis',cumulative:true,basis:'Latest MTD GIS snapshot'},
    {account:'pandamart',table:'pandamart_sales_daily',field:'sale_date',qty:'sold_qty',cumulative:false,basis:'Daily quantities summed within month'},
    {account:'shajgoj',table:'shajgoj_sales_cumulative',field:'period_end',qty:'sold_qty',cumulative:true,basis:'Latest cumulative MTD snapshot per SKU'},
    {account:'othoba',table:'othoba_monthly_sales',field:'period_end',qty:'sold_qty',cumulative:true,basis:'Latest cumulative MTD snapshot per SKU'},
  ];
  // Optional sales sources have a conservative cap: never show partial quantities as a complete total.
  for(const cfg of config){
    try{
      const all=await read(cfg.table,`account_sku,${cfg.field},${cfg.qty}`,[cfg.field],
        q=>q.gte(cfg.field,`${month}-01`).lte(cfg.field,today),5000);
      const latest=new Map<string,Raw>();let total=0,period='';const skus=new Set<string>();
      for(const row of [...all].reverse()){
        const sku=norm(row.account_sku);if(!sku)continue;skus.add(sku);
        const day=str(row[cfg.field]);if(day>period)period=day;
        if(cfg.cumulative){if(!latest.has(sku))latest.set(sku,row)}else total+=amount(row[cfg.qty])??0;
      }
      if(cfg.cumulative)total=[...latest.values()].reduce((s,row)=>s+(amount(row[cfg.qty])??0),0);
      if(all.length)sales.push({account:cfg.account,period,basis:cfg.basis,qty:total,sku_count:skus.size,comparable:false});
    }catch(e){warnings.push(`Sales ${cfg.account} excluded: ${String(e)}`)}
  }
  freshness.sales=sales.map(x=>x.period).sort().at(-1)??null;
  const known=rows.filter(r=>r.ola_status==='available'||r.ola_status==='unavailable');
  return NextResponse.json({rows,sos,sales,warnings,freshness,
    meta:{ola_rows:rows.length,ola_known:known.length,ola_oos:known.filter(r=>r.ola_status==='unavailable').length,
      cpp_joined:rows.filter(r=>r.cpp_status!==null).length,cpp_issues:rows.filter(r=>r.cpp_status==='issue').length,
      both_issues:rows.filter(r=>r.risk==='OOS + CPP issue').length,as_of:today,
      methodology:'OLA latest scraper SKU/branch observations. CPP is matched by exact account and SKU, respecting branch specificity. SoS and sales are optional, independently sourced; incomplete optional datasets are omitted with warnings. No inferred lost sales.'}},
    {headers:{'Cache-Control':'no-store'}});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:'Commercial intelligence unavailable'}, {status:503,headers:{'Cache-Control':'no-store'}})}
}
